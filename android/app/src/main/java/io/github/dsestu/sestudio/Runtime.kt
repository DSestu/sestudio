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
import java.util.concurrent.TimeUnit

/**
 * The Linux sestudio runs in: proot over a Debian root filesystem, with uv.
 * Downloaded and unpacked once, on first launch; everything lives in filesDir.
 */
class Runtime(private val context: Context) {
    val rootfs = File(context.filesDir, "debian")
    private val readyMark = File(context.filesDir, "runtime.ready")
    private val libDir = File(context.applicationInfo.nativeLibraryDir)
    // Android names the native library folder after the ABI it picked: arm64, arm or x86_64.
    private val arch = Arch.of(libDir.name)

    val isReady get() = readyMark.exists()

    /**
     * Sets everything up. [progress] gets the step ([STEP_LINUX], [STEP_UV],
     * [STEP_PACKAGES]) and its bytes so far out of its total (-1 when unknown).
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
            File(uv, "uv-${arch.uv}/$name").copyTo(target, overwrite = true)
            Os.chmod(target.path, "755".toInt(8))
        }
        uv.deleteRecursively()
        if (arch.packages.isNotEmpty()) {
            progress(STEP_PACKAGES, -1, -1)
            aptInstall(arch.packages)
        }
        readyMark.writeText("1")
    }

    /**
     * Installs Chromium, which the music station draws the TV picture with, when it is
     * missing: a large download, so off the main thread, and not in [install] to keep setup quick.
     */
    fun addChromium() = synchronized(Runtime::class.java) {
        if (isReady && !File(rootfs, "usr/bin/chromium").exists()) aptInstall(listOf("chromium"))
    }

    private fun aptInstall(packages: List<String>) {
        // proot's fake root can't drop to apt's sandbox user.
        val apt = command(
            "sh", "-c",
            "export DEBIAN_FRONTEND=noninteractive; apt-get -o APT::Sandbox::User=root update && " +
                "apt-get -o APT::Sandbox::User=root install -y --no-install-recommends ${packages.joinToString(" ")}",
        ).start()
        val log = apt.inputStream.bufferedReader().readText()
        check(apt.waitFor() == 0) { "Installing ${packages.joinToString()} failed:\n" + log.takeLast(1500) }
    }

    /**
     * A process running [args] inside Debian, stdout and stderr merged. [binds]
     * are extra (phone path, Debian path) folders to show inside.
     */
    fun command(vararg args: String, binds: List<Pair<String, String>> = emptyList()): ProcessBuilder =
        proot(args.toList(), binds).apply {
            if (!seccompWorks()) environment()["PROOT_NO_SECCOMP"] = "1"
        }

    /**
     * Whether proot's seccomp mode works on this kernel. Some kernels break it and
     * every syscall then fails with ENOSYS; without it proot is slower but works.
     */
    private fun seccompWorks(): Boolean = seccomp ?: run {
        val probe = proot(listOf("true")).redirectOutput(File("/dev/null")).start()
        val works = probe.waitFor(30, TimeUnit.SECONDS) && probe.exitValue() == 0
        if (!works) probe.destroy()
        works.also { seccomp = it }
    }

    private fun proot(args: List<String>, binds: List<Pair<String, String>> = emptyList()): ProcessBuilder {
        val tmp = File(context.cacheDir, "proot").apply { mkdirs() }
        val argv = listOf(
            File(libDir, "libproot.so").path, "--kill-on-exit", "--link2symlink",
            "-r", rootfs.path, "-0", "-w", "/root",
            "-b", "/dev", "-b", "/proc", "-b", "/sys",
        ) + binds.flatMap { (outside, inside) -> listOf("-b", "$outside:$inside") } + listOf(
            // Android's own environment means nothing inside Debian.
            "/usr/bin/env", "-i", "HOME=/root", "PATH=/usr/local/bin:/usr/bin:/bin",
            "TERM=dumb", "LANG=C.UTF-8",
            // Only uv's own Linux Python: anything else on the path may report Android.
            "UV_PYTHON_PREFERENCE=only-managed", "UV_LINK_MODE=copy",
        ) + arch.env + args
        return ProcessBuilder(argv).redirectErrorStream(true).apply {
            environment()["PROOT_LOADER"] = File(libDir, "libproot-loader.so").path
            environment()["PROOT_TMP_DIR"] = tmp.path
            // proot's libtalloc and libandroid-shmem sit beside it.
            environment()["LD_LIBRARY_PATH"] = libDir.path
        }
    }

    /**
     * The registry token and this phone's layers (digest, size) of Debian's
     * slim image, from Docker Hub as proot-distro does.
     */
    private fun debianLayers(): Pair<String, List<Pair<String, Long>>> {
        val token = JSONObject(read(open(TOKEN_URL).inputStream)).getString("token")
        val index = JSONObject(read(open("$REGISTRY/manifests/stable-slim", token, INDEX_TYPES).inputStream))
        val manifests = index.getJSONArray("manifests")
        val image = (0 until manifests.length()).map(manifests::getJSONObject).first {
            val platform = it.getJSONObject("platform")
            platform.optString("architecture") == arch.docker &&
                (arch.variant == null || platform.optString("variant") == arch.variant)
        }
        val manifest = JSONObject(read(open("$REGISTRY/manifests/${image.getString("digest")}", token, MANIFEST_TYPES).inputStream))
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

    /**
     * A CPU architecture: its Docker platform, its uv build, and what it needs
     * beyond Debian and uv. [env] goes to every command inside Debian.
     */
    private class Arch(
        val docker: String,
        val variant: String?,
        val uv: String,
        val packages: List<String> = emptyList(),
        val env: List<String> = emptyList(),
    ) {
        companion object {
            fun of(abi: String) = when (abi) {
                "arm64" -> Arch("arm64", null, "aarch64-unknown-linux-musl")
                "x86_64" -> Arch("amd64", null, "x86_64-unknown-linux-musl")
                // 32-bit ARM: PyPI lacks wheels for several dependencies. piwheels has most,
                // gcc builds the rest (psutil), and ffmpeg comes from Debian, not imageio-ffmpeg.
                "arm" -> Arch(
                    "arm", "v7", "armv7-unknown-linux-musleabihf",
                    packages = listOf("ffmpeg", "gcc", "libc6-dev"),
                    env = listOf("UV_EXTRA_INDEX_URL=https://www.piwheels.org/simple", "UV_INDEX_STRATEGY=unsafe-best-match"),
                )
                else -> error("Unsupported CPU: $abi")
            }
        }
    }

    companion object {
        const val STEP_LINUX = 0
        const val STEP_UV = 1
        const val STEP_PACKAGES = 2

        @Volatile private var seccomp: Boolean? = null

        private const val REGISTRY = "https://registry-1.docker.io/v2/library/debian"
        private const val TOKEN_URL = "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/debian:pull"
        private const val INDEX_TYPES = "application/vnd.oci.image.index.v1+json,application/vnd.docker.distribution.manifest.list.v2+json"
        private const val MANIFEST_TYPES = "application/vnd.oci.image.manifest.v1+json,application/vnd.docker.distribution.manifest.v2+json"
        private const val UV_URL = "https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-unknown-linux-musl.tar.gz"
    }
}
