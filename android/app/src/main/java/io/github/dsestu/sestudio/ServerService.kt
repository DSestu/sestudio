package io.github.dsestu.sestudio

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.os.PowerManager
import android.os.storage.StorageManager
import android.system.Os
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.concurrent.thread

/**
 * Runs the sestudio server for as long as the user wants it, screen off or
 * not: a foreground service, whose notification is the way to stop it.
 */
class ServerService : Service() {
    private var process: Process? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            // Swiped away (Android 14+ allows it even here): it is the only Stop button, so it comes back.
            ACTION_REPOST -> if (process != null) getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
            ACTION_RESTART -> restart()
            else -> start()
        }
        return START_STICKY
    }

    private fun start() {
        if (process != null) return
        running = true
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Server", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Shown while sestudio's server runs"
            },
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification())
        }
        wakeLock = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "sestudio:server").apply { acquire() }
        // Streaming to a TV over Wi-Fi with the screen off.
        @Suppress("DEPRECATION")
        wifiLock = getSystemService(WifiManager::class.java)
            .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "sestudio:server").apply { acquire() }

        launch()
    }

    /** The server again, on the source [nightly] now picks, once the old one has let go of its ports. */
    private fun restart() {
        val old = process ?: return start()
        process = null // so its watcher does not stop the service
        killServer()
        thread(name = "server-restart") {
            old.waitFor()
            launch()
        }
    }

    /**
     * Kills the server. proot ignores SIGTERM (Process.destroy), and a SIGKILL to
     * proot alone leaves its children running untraced; so every other process of
     * this app goes, which is proot and everything the server spawned.
     */
    private fun killServer() {
        val me = android.os.Process.myPid()
        File("/proc").listFiles().orEmpty().mapNotNull { it.name.toIntOrNull() }
            .filter { it != me && runCatching { Os.stat("/proc/$it").st_uid == Os.getuid() }.getOrDefault(false) }
            .forEach { android.os.Process.killProcess(it) }
    }

    private fun launch() {
        val runtime = Runtime(this)
        // Failing (offline, say) only leaves music casting without a picture; the next start tries again.
        thread(name = "chromium") { runCatching { runtime.addChromium() } }
        writeFirstConfig(runtime)
        val downloads = getExternalFilesDir(Environment.DIRECTORY_MOVIES)!!.apply { mkdirs() }
        // Nightly builds main afresh on every start (same URL, new code: hence the refresh);
        // a build from source has no default TMDB key, so posters need one in Settings.
        val source = if (nightly(this)) {
            arrayOf("--refresh-package", "sestudio", "--from", MAIN_ARCHIVE, "sestudio")
        } else {
            arrayOf("sestudio@latest")
        }
        val storage = storageRoots()
        writeStorage(runtime, storage)
        process = runtime.command(
            "uvx", *source,
            "--http_port", "${BuildConfig.HTTP_PORT}", "--https_port", "${BuildConfig.HTTPS_PORT}",
            // Shared storage at the same paths inside, so they match what Android shows.
            binds = listOf(downloads.path to DOWNLOADS) + storage.map { it.second to it.second },
        )
            .redirectOutput(logFile(this))
            .start()
            .also { started ->
                // The server ending on its own (a crash, a failed update) ends the service too.
                thread(name = "server-watch") {
                    started.waitFor()
                    if (process === started) stopSelf()
                }
            }
    }

    /**
     * The phone's shared storage (label, path) the server may use: the internal one and each
     * mounted SD card. Empty without [storageAccess], which the user may have refused.
     */
    private fun storageRoots(): List<Pair<String, String>> {
        if (!storageAccess(this)) return emptyList()
        val cards = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getSystemService(StorageManager::class.java).storageVolumes
                .filter { !it.isPrimary && it.state == Environment.MEDIA_MOUNTED }
                .mapNotNull { it.directory?.path }
        } else {
            // <card>/Android/data/<package>/files: the card is what comes before "/Android".
            getExternalFilesDirs(null).drop(1).filterNotNull().map { it.path.substringBefore("/Android/") }
        }
        val phone = "Phone" to Environment.getExternalStorageDirectory().path
        return (listOf(phone) + cards.mapIndexed { i, path -> (if (i == 0) "SD card" else "SD card ${i + 1}") to path })
            .filter { File(it.second).isDirectory }
    }

    /** What the server finds out about the storage: the roots to browse, and the standard music folders in them. */
    private fun writeStorage(runtime: Runtime, storage: List<Pair<String, String>>) {
        fun entry(label: String, path: String) = JSONObject().put("label", label).put("path", path)
        val folders = storage.flatMap { (label, root) ->
            MUSIC_FOLDERS.filter { File(root, it).isDirectory }.map { entry("$label · $it", "$root/$it") }
        }
        val file = File(runtime.rootfs, "root/.config/sestudio/android_storage.json")
        file.parentFile!!.mkdirs()
        file.writeText(
            JSONObject()
                .put("roots", JSONArray(storage.map { entry(it.first, it.second) }))
                .put("folders", JSONArray(folders))
                .toString(),
        )
    }

    /** sestudio's settings on first start: downloads in the app's Movies folder, no AI frames. */
    private fun writeFirstConfig(runtime: Runtime) {
        val config = File(runtime.rootfs, "root/.config/sestudio/config.json")
        if (config.exists()) return
        config.parentFile!!.mkdirs()
        // The phone's GPU is out of reach from proot.
        config.writeText("""{"output_root": "$DOWNLOADS", "frame_interpolation": false}""")
    }

    private fun notification(): Notification {
        val flags = PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), flags)
        val stop = PendingIntent.getService(this, 1, Intent(this, ServerService::class.java).setAction(ACTION_STOP), flags)
        val repost = PendingIntent.getService(this, 2, Intent(this, ServerService::class.java).setAction(ACTION_REPOST), flags)
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("sestudio is running")
            .setContentText("Open it, or stop it to save battery.")
            .setOngoing(true)
            .setContentIntent(open)
            .setDeleteIntent(repost)
            .addAction(Notification.Action.Builder(null, "Stop", stop).build())
            .build()
    }

    override fun onDestroy() {
        val server = process
        process = null
        running = false
        if (server != null) killServer()
        wakeLock?.release()
        wifiLock?.release()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "io.github.dsestu.sestudio.STOP"
        private const val ACTION_REPOST = "io.github.dsestu.sestudio.REPOST"
        private const val ACTION_RESTART = "io.github.dsestu.sestudio.RESTART"
        private const val CHANNEL = "server"
        private const val NOTIFICATION_ID = 1

        /** Whether the server process is up (it may still be starting). */
        @Volatile var running = false
            private set

        private const val MAIN_ARCHIVE = "https://github.com/DSestu/sestudio/archive/refs/heads/main.zip"

        /** Where downloads appear inside Debian: the app's Movies folder on the phone. */
        const val DOWNLOADS = "/downloads"

        /** The standard folders that become libraries by themselves (not Ringtones, Notifications, Alarms). */
        private val MUSIC_FOLDERS = listOf("Music", "Download", "Podcasts", "Recordings")

        /** The runtime permissions for the phone's storage before Android 11; from 11 it is all files access. */
        val STORAGE_PERMISSIONS = arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE)

        /** Whether the server, a Linux process, may read and write the phone's folders by path. */
        fun storageAccess(context: Context): Boolean = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            STORAGE_PERMISSIONS.all { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
        }

        fun logFile(context: Context) = File(context.filesDir, "server.log")

        fun start(context: Context) {
            context.startForegroundService(Intent(context, ServerService::class.java))
        }

        private fun prefs(context: Context) = context.getSharedPreferences("settings", Context.MODE_PRIVATE)

        /** Whether the server runs main instead of the latest release: off by default, on in sestudio-dev. */
        fun nightly(context: Context) = prefs(context).getBoolean("nightly", BuildConfig.FROM_MAIN)

        /** Switches [nightly] and restarts the server on it. */
        fun setNightly(context: Context, on: Boolean) {
            prefs(context).edit().putBoolean("nightly", on).apply()
            context.startService(Intent(context, ServerService::class.java).setAction(ACTION_RESTART))
        }
    }
}
