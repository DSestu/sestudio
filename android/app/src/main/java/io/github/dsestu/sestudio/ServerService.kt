package io.github.dsestu.sestudio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.os.PowerManager
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

        val runtime = Runtime(this)
        writeFirstConfig(runtime)
        val downloads = getExternalFilesDir(Environment.DIRECTORY_MOVIES)!!.apply { mkdirs() }
        // sestudio-dev builds main afresh on every start (same URL, new code: hence the refresh);
        // a build from source has no default TMDB key, so posters need one in Settings.
        val source = if (BuildConfig.FROM_MAIN) {
            arrayOf("--refresh-package", "sestudio", "--from", MAIN_ARCHIVE, "sestudio")
        } else {
            arrayOf("sestudio@latest")
        }
        process = runtime.command(
            "uvx", *source,
            "--http_port", "${BuildConfig.HTTP_PORT}", "--https_port", "${BuildConfig.HTTPS_PORT}",
            binds = listOf(downloads.path to DOWNLOADS),
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
        server?.destroy() // proot's --kill-on-exit takes the server down with it
        wakeLock?.release()
        wifiLock?.release()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "io.github.dsestu.sestudio.STOP"
        private const val ACTION_REPOST = "io.github.dsestu.sestudio.REPOST"
        private const val CHANNEL = "server"
        private const val NOTIFICATION_ID = 1

        /** Whether the server process is up (it may still be starting). */
        @Volatile var running = false
            private set

        private const val MAIN_ARCHIVE = "https://github.com/DSestu/sestudio/archive/refs/heads/main.zip"

        /** Where downloads appear inside Debian: the app's Movies folder on the phone. */
        const val DOWNLOADS = "/downloads"

        fun logFile(context: Context) = File(context.filesDir, "server.log")

        fun start(context: Context) {
            context.startForegroundService(Intent(context, ServerService::class.java))
        }
    }
}
