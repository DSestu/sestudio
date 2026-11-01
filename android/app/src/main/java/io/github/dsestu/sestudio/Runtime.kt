package io.github.dsestu.sestudio

import android.content.Context
import android.system.Os
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import org.json.JSONObject
import java.io.File
import java.io.FilterInputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * The Linux sestudio runs in: proot over a Debian root filesystem, with uv.
 * Downloaded and unpacked once, on first launch; everything lives in filesDir.
 */
class Runtime(private val context: Context) {
    val rootfs = File(context.filesDir, "debian")
    private val readyMark = File(context.filesDir, "runtime.ready")
    private val libDir = File(context.applicationInfo.nativeLibraryDir)

    val isReady get() = readyMark.exists()

    /**
     * Sets everything up. [progress] gets the step ([STEP_LINUX], [STEP_UV]) and
     * its bytes so far out of its total (-1 when unknown), as they arrive.
     */
    fun install(progress: (step: Int, done: Long, total: Long) -> Unit) {
        if (isReady) return
        rootfs.deleteRecursively()
        rootfs.mkdirs()
        val (token, layers) = debianLayers()
        val total = layers.sumOf { it.second }
        var before = 0L
        for ((digest, size) in layers) {
            val layer = open("$REGISTRY/blobs/$digest", token).inputStream
            unpack(counted(layer) { progress(STEP_LINUX, before + it, total) }, rootfs)
            before += size
        }
        // Container images leave DNS to the container engine; here there is none.
        File(rootfs, "etc/resolv.conf").writeText("nameserver 1.1.1.1\nnameserver 8.8.8.8\n")
        val uv = File(context.cacheDir, "uv").apply { deleteRecursively(); mkdirs() }
        val download = open(UV_URL)
        unpack(counted(download.inputStream) { progress(STEP_UV, it, download.contentLengthLong) }, uv)
        val bin = File(rootfs, "usr/local/bin").apply { mkdirs() }
        for (name in listOf("uv", "uvx")) {
            val target = File(bin, name)
            File(uv, "uv-aarch64-unknown-linux-musl/$name").copyTo(target, overwrite = true)
            Os.chmod(target.path, "755".toInt(8))
        }
        uv.deleteRecursively()
        readyMark.writeText("1")
    }

    /** A process running [args] inside Debian, stdout and stderr merged. */
    fun command(vararg args: String): ProcessBuilder {
        val tmp = File(context.cacheDir, "proot").apply { mkdirs() }
        val argv = listOf(
            File(libDir, "libproot.so").path, "--kill-on-exit", "--link2symlink",
            "-r", rootfs.path, "-0", "-w", "/root",
            "-b", "/dev", "-b", "/proc", "-b", "/sys",
            // Android's own environment means nothing inside Debian.
            "/usr/bin/env", "-i", "HOME=/root", "PATH=/usr/local/bin:/usr/bin:/bin",
            "TERM=dumb", "LANG=C.UTF-8",
            // Only uv's own Linux Python: anything else on the path may report Android.
            "UV_PYTHON_PREFERENCE=only-managed", "UV_LINK_MODE=copy",
        ) + args
        return ProcessBuilder(argv).redirectErrorStream(true).apply {
            environment()["PROOT_LOADER"] = File(libDir, "libproot-loader.so").path
            environment()["PROOT_TMP_DIR"] = tmp.path
        }
    }

    /**
     * The registry token and the arm64 layers (digest, size) of Debian's slim
     * image, from Docker Hub as proot-distro does.
     */
    private fun debianLayers(): Pair<String, List<Pair<String, Long>>> {
        val token = JSONObject(read(open(TOKEN_URL).inputStream)).getString("token")
        val index = JSONObject(read(open("$REGISTRY/manifests/stable-slim", token, INDEX_TYPES).inputStream))
        val manifests = index.getJSONArray("manifests")
        val arm64 = (0 until manifests.length()).map(manifests::getJSONObject).first {
            it.getJSONObject("platform").optString("architecture") == "arm64"
        }
        val manifest = JSONObject(read(open("$REGISTRY/manifests/${arm64.getString("digest")}", token, MANIFEST_TYPES).inputStream))
        val layers = manifest.getJSONArray("layers")
        return token to (0 until layers.length()).map {
            val layer = layers.getJSONObject(it)
            layer.getString("digest") to layer.getLong("size")
        }
    }

    /**
     * Unpacks a .tar.gz into [root]. Android forbids hard links, so those become
     * copies; paths that would land outside [root] stop the install.
     */
    private fun unpack(input: InputStream, root: File) {
        val base = root.canonicalPath + File.separator
        TarArchiveInputStream(GzipCompressorInputStream(input.buffered())).use { tar ->
            while (true) {
                val entry = tar.nextEntry ?: break
                val name = safe(entry.name)
                if (name.isEmpty() || name == ".") continue // the archive's own root
                val dest = File(root, name)
                // Its folder, resolved: a symlink unpacked earlier must not lead outside.
                val parent = dest.parentFile!!.canonicalPath + File.separator
                check(parent.startsWith(base)) { "Archive path outside the target: ${entry.name}" }
                val mode = entry.mode and "777".toInt(8)
                when {
                    entry.isDirectory -> {
                        dest.mkdirs()
                        Os.chmod(dest.path, mode or "700".toInt(8))
                    }
                    entry.isSymbolicLink -> {
                        dest.parentFile?.mkdirs()
                        dest.delete()
                        Os.symlink(entry.linkName, dest.path)
                    }
                    entry.isLink -> {
                        val target = File(root, safe(entry.linkName))
                        target.copyTo(dest, overwrite = true)
                        Os.chmod(dest.path, mode)
                    }
                    entry.isFile -> {
                        dest.parentFile?.mkdirs()
                        dest.delete()
                        dest.outputStream().use { tar.copyTo(it) }
                        Os.chmod(dest.path, mode)
                    }
                    // Device files and fifos: proot binds the real /dev instead.
                    else -> Unit
                }
            }
        }
    }

    /** An archive path, relative and without "..": anything else is refused. */
    private fun safe(name: String): String {
        val path = name.removePrefix("./")
        check(!path.startsWith("/") && path.split('/').none { it == ".." }) { "Unsafe archive path: $name" }
        return path
    }

    private fun open(url: String, token: String? = null, accept: String? = null): HttpURLConnection {
        var target = URL(url)
        // Follow redirects by hand: the blob's CDN rejects Docker Hub's Authorization header.
        repeat(5) {
            val conn = target.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 30_000
            conn.readTimeout = 60_000
            if (token != null && target.host.endsWith("docker.io")) conn.setRequestProperty("Authorization", "Bearer $token")
            if (accept != null) conn.setRequestProperty("Accept", accept)
            when (conn.responseCode) {
                in 300..399 -> target = URL(target, conn.getHeaderField("Location"))
                in 200..299 -> return conn
                else -> error("HTTP ${conn.responseCode} for $target")
            }
        }
        error("Too many redirects for $url")
    }

    private fun read(input: InputStream) = input.use { it.readBytes().decodeToString() }

    /** [input], telling [onBytes] the running total as it is read. */
    private fun counted(input: InputStream, onBytes: (Long) -> Unit): InputStream =
        object : FilterInputStream(input) {
            private var bytes = 0L
            private var shown = -1L

            override fun read(b: ByteArray, off: Int, len: Int): Int =
                super.read(b, off, len).also { if (it > 0) count(it.toLong()) }

            override fun read(): Int = super.read().also { if (it >= 0) count(1) }

            private fun count(n: Long) {
                bytes += n
                // Every 256 KB is plenty for a progress bar.
                if (bytes / 262_144 != shown) {
                    shown = bytes / 262_144
                    onBytes(bytes)
                }
            }
        }

    companion object {
        const val STEP_LINUX = 0
        const val STEP_UV = 1

        private const val REGISTRY = "https://registry-1.docker.io/v2/library/debian"
        private const val TOKEN_URL = "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/debian:pull"
        private const val INDEX_TYPES = "application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json"
        private const val MANIFEST_TYPES = "application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"
        private const val UV_URL = "https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-unknown-linux-musl.tar.gz"
    }
}
