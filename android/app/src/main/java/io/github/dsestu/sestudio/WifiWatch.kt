package io.github.dsestu.sestudio

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.FileObserver
import org.json.JSONObject
import java.io.File

/**
 * Tells the server which Wi-Fi the phone is on (SPEC-storage §10): the storages
 * a bridge opened are remembered by it. Only the app can read the Wi-Fi name, and
 * only with the location permission, so it writes `network.json` beside the
 * server's config. When the server wants the name without that permission it
 * leaves `network_wanted`, and this asks the user once, through a notification.
 */
class WifiWatch(private val context: Context, private val dir: File) {
    private val connectivity = context.getSystemService(ConnectivityManager::class.java)
    private var callback: ConnectivityManager.NetworkCallback? = null
    private var observer: FileObserver? = null

    fun start() {
        dir.mkdirs()
        write(currentSsid())
        val request = NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI).build()
        val cb = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            object : ConnectivityManager.NetworkCallback(FLAG_INCLUDE_LOCATION_INFO) {
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) =
                    write(clean((caps.transportInfo as? WifiInfo)?.ssid))
                override fun onLost(network: Network) = write(null)
            }
        } else {
            object : ConnectivityManager.NetworkCallback() {
                override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = write(currentSsid())
                override fun onLost(network: Network) = write(null)
            }
        }
        connectivity.registerNetworkCallback(request, cb)
        callback = cb
        @Suppress("DEPRECATION") // FileObserver(File) is Android 10+
        observer = object : FileObserver(dir.path, CREATE or CLOSE_WRITE) {
            override fun onEvent(event: Int, path: String?) {
                if (path != WANTED) return
                File(dir, WANTED).delete()
                if (!allowed(context)) askByNotification()
            }
        }.apply { startWatching() }
    }

    /** After the permission was given: the name can be read now. */
    fun refresh() = write(currentSsid())

    fun stop() {
        callback?.let { runCatching { connectivity.unregisterNetworkCallback(it) } }
        callback = null
        observer?.stopWatching()
        observer = null
    }

    @Suppress("DEPRECATION") // the only way before Android 12; still answers with the permission
    private fun currentSsid(): String? = clean(context.getSystemService(WifiManager::class.java).connectionInfo?.ssid)

    private fun write(ssid: String?) {
        runCatching {
            File(dir, FILE).writeText(
                JSONObject().put("wifi", ssid ?: JSONObject.NULL).put("permission", allowed(context)).toString(),
            )
        }
    }

    private fun askByNotification() {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "Wi-Fi name", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "When a storage needs the name of the Wi-Fi this phone is on"
            },
        )
        val open = PendingIntent.getActivity(
            context, 3,
            Intent(context, MainActivity::class.java)
                .putExtra(EXTRA_ASK, true)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        manager.notify(
            NOTIFICATION_ID,
            Notification.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setContentTitle("Allow sestudio to read the Wi-Fi name")
                .setContentText("Your other sestudio opens the storages you saved for this Wi-Fi.")
                .setContentIntent(open)
                .setAutoCancel(true)
                .build(),
        )
    }

    companion object {
        const val FILE = "network.json"
        const val WANTED = "network_wanted"
        const val EXTRA_ASK = "io.github.dsestu.sestudio.ASK_LOCATION"
        private const val CHANNEL = "wifi"
        private const val NOTIFICATION_ID = 2

        /** What Android asks for before it says the Wi-Fi name. */
        val PERMISSIONS = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)

        fun allowed(context: Context) =
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

        /** Android hides the name without the permission; quotes come around a readable one. */
        fun clean(ssid: String?): String? =
            ssid?.removeSurrounding("\"")?.takeIf { it.isNotEmpty() && it != WifiManager.UNKNOWN_SSID }
    }
}
