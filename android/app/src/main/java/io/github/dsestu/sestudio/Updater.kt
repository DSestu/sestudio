package io.github.dsestu.sestudio

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.widget.Toast
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Updates the APK from GitHub Releases: on launch, at most once a day, offers the latest
 * release when it is newer, then downloads its sestudio.apk and installs it. Android itself
 * refuses an APK signed with another key, so only our own releases ever install.
 */
object Updater {
    private const val LATEST = "https://api.github.com/repos/DSestu/sestudio/releases/latest"
    private const val DAY = 24 * 60 * 60 * 1000L

    private class Release(val version: String, val code: Int, val apk: String)

    fun checkDaily(activity: Activity) {
        // sestudio-dev is another package, which the release APK can't update.
        if (BuildConfig.DEBUG) return
        val prefs = activity.getSharedPreferences("settings", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (now - prefs.getLong("update_checked", 0) < DAY) return
        thread(name = "update-check") {
            val release = runCatching { latest() }.getOrNull() ?: return@thread // offline: next launch
            prefs.edit().putLong("update_checked", now).apply()
            if (release.code <= BuildConfig.VERSION_CODE) return@thread
            activity.runOnUiThread {
                if (activity.isFinishing) return@runOnUiThread
                AlertDialog.Builder(activity)
                    .setTitle("sestudio ${release.version} is available")
                    .setMessage("The app closes while it updates, then its server starts again.")
                    .setPositiveButton("Update") { _, _ ->
                        val context = activity.applicationContext
                        Toast.makeText(context, "Downloading the update…", Toast.LENGTH_SHORT).show()
                        thread(name = "update") { install(context, release.apk) }
                    }
                    .setNegativeButton("Later", null)
                    .show()
            }
        }
    }

    /** The latest release, or null when it has no APK (yet: the APK is attached after the release). */
    private fun latest(): Release? {
        val json = JSONObject(get(LATEST).inputStream.bufferedReader().use { it.readText() })
        val (major, minor, patch) = Regex("""(\d+)\.(\d+)\.(\d+)""").find(json.getString("tag_name"))?.destructured ?: return null
        val assets = json.getJSONArray("assets")
        val apk = (0 until assets.length()).map(assets::getJSONObject).firstOrNull { it.getString("name") == "sestudio.apk" } ?: return null
        // The same versionCode as build.gradle.kts gives a release.
        val code = major.toInt() * 10000 + minor.toInt() * 100 + patch.toInt()
        return Release("$major.$minor.$patch", code, apk.getString("browser_download_url"))
    }

    private fun get(url: String) = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15_000
        readTimeout = 30_000
    }

    private fun install(context: Context, url: String) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        // Once sestudio has installed itself, Android 12+ lets later updates skip the confirmation.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val id = installer.createSession(params)
        try {
            installer.openSession(id).use { session ->
                get(url).inputStream.use { input ->
                    session.openWrite("sestudio.apk", 0, -1).use { out ->
                        input.copyTo(out)
                        session.fsync(out)
                    }
                }
                val mutable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
                val done = PendingIntent.getBroadcast(
                    context, id, Intent(context, InstallReceiver::class.java), mutable or PendingIntent.FLAG_UPDATE_CURRENT,
                )
                session.commit(done.intentSender)
            }
        } catch (e: Exception) {
            installer.abandonSession(id)
            InstallReceiver.failed(context, e.message)
        }
    }
}

/** Android's answers about an update: confirm it, it failed, or it is installed (start the server again). */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            // Only where setup was done; otherwise opening the app runs setup first.
            if (Runtime(context).isReady && ServerService.storageAccess(context)) ServerService.start(context)
            return
        }
        when (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                @Suppress("DEPRECATION")
                val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
                context.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            PackageInstaller.STATUS_SUCCESS -> Unit
            else -> failed(context, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        }
    }

    companion object {
        fun failed(context: Context, why: String?) = android.os.Handler(context.mainLooper).post {
            Toast.makeText(context, "Update failed" + (why?.let { ": $it" } ?: ""), Toast.LENGTH_LONG).show()
        }
    }
}
