package io.github.dsestu.sestudio

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.util.Rational
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * The video playing in the page, seen from Android: lock-screen and
 * notification controls (a MediaSession), and picture-in-picture. The page
 * reports through [media]; the app drives it through [control].
 */
class Playback(private val activity: Activity, private val web: WebView) {
    private val session = MediaSession(activity, "sestudio").apply {
        setCallback(object : MediaSession.Callback() {
            override fun onPlay() = control("play")
            override fun onPause() = control("pause")
            override fun onFastForward() = control("seek", 10.0)
            override fun onRewind() = control("seek", -10.0)
            override fun onSeekTo(pos: Long) = control("to", pos / 1000.0)
        })
    }
    private val notifications = activity.getSystemService(NotificationManager::class.java)
    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.getStringExtra(EXTRA_COMMAND)) {
                "toggle" -> control(if (playing) "pause" else "play")
                "back" -> control("seek", -10.0)
                "forward" -> control("seek", 10.0)
            }
        }
    }

    /** Whether a video is playing now: keeps the web view running in the background. */
    @Volatile var playing = false
        private set
    private var aspect = Rational(16, 9)

    init {
        notifications.createNotificationChannel(
            NotificationChannel(CHANNEL, "Playback", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Controls for the video playing in sestudio"
            },
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            activity.registerReceiver(receiver, IntentFilter(ACTION), Context.RECEIVER_NOT_EXPORTED)
        } else {
            @Suppress("UnspecifiedRegisterReceiverFlag")
            activity.registerReceiver(receiver, IntentFilter(ACTION))
        }
        web.addJavascriptInterface(this, "SestudioApp")
    }

    /** Hooks the page's videos; run on every page load. */
    fun inject() = web.evaluateJavascript(PAGE_SCRIPT, null)

    /** The page's report: `{}` when it has no video, else its state. */
    @JavascriptInterface
    fun media(json: String) {
        val state = JSONObject(json)
        activity.runOnUiThread { update(state) }
    }

    /** The Server log's Stop: the notification's Stop, then the app closes, as nothing is left to show. */
    @JavascriptInterface
    fun stopServer() = activity.runOnUiThread {
        activity.startService(Intent(activity, ServerService::class.java).setAction(ServerService.ACTION_STOP))
        activity.finishAndRemoveTask()
    }

    fun control(command: String, value: Double = 0.0) = activity.runOnUiThread {
        web.evaluateJavascript("window.__sestudioControl && __sestudioControl('$command', $value)", null)
    }

    /** Shows only the video while the app is a picture-in-picture window. */
    fun pictureInPicture(active: Boolean) =
        web.evaluateJavascript("document.documentElement.classList.toggle('sestudio-pip', $active)", null)

    fun params(): PictureInPictureParams = PictureInPictureParams.Builder()
        .setAspectRatio(aspect)
        .setActions(listOf(action("back", android.R.drawable.ic_media_rew, "Back 10 s"), toggleAction(), action("forward", android.R.drawable.ic_media_ff, "Forward 10 s")))
        .apply { if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) setAutoEnterEnabled(playing) }
        .build()

    private fun update(state: JSONObject) {
        if (!state.has("playing")) {
            playing = false
            session.isActive = false
            notifications.cancel(NOTIFICATION_ID)
            activity.setPictureInPictureParams(params())
            return
        }
        playing = state.getBoolean("playing")
        val width = state.optInt("width")
        val height = state.optInt("height")
        // Android refuses picture-in-picture shapes beyond 2.39:1 either way.
        if (width > 0 && height > 0) aspect = Rational(width, height).let {
            when {
                it.toFloat() > 2.39f -> Rational(239, 100)
                it.toFloat() < 1 / 2.39f -> Rational(100, 239)
                else -> it
            }
        }
        val title = state.optString("title").ifEmpty { "sestudio" }
        session.setMetadata(
            MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, (state.optDouble("duration") * 1000).toLong())
                .build(),
        )
        session.setPlaybackState(
            PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                        PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND,
                )
                .setState(
                    if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    (state.optDouble("position") * 1000).toLong(),
                    if (playing) 1f else 0f,
                )
                .build(),
        )
        session.isActive = true
        notifications.notify(NOTIFICATION_ID, notification(title))
        activity.setPictureInPictureParams(params())
    }

    private fun notification(title: String): Notification {
        val open = PendingIntent.getActivity(activity, 0, Intent(activity, activity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return Notification.Builder(activity, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentIntent(open)
            .setOngoing(playing)
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0, 1, 2))
            .addAction(notificationAction("back", android.R.drawable.ic_media_rew, "Back 10 s"))
            .addAction(
                if (playing) {
                    notificationAction("toggle", android.R.drawable.ic_media_pause, "Pause")
                } else {
                    notificationAction("toggle", android.R.drawable.ic_media_play, "Play")
                },
            )
            .addAction(notificationAction("forward", android.R.drawable.ic_media_ff, "Forward 10 s"))
            .build()
    }

    private fun intent(command: String, code: Int) = PendingIntent.getBroadcast(
        activity, code,
        Intent(ACTION).setPackage(activity.packageName).putExtra(EXTRA_COMMAND, command),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun requestCode(command: String) = listOf("back", "toggle", "forward").indexOf(command) + 10

    private fun notificationAction(command: String, icon: Int, label: String) =
        Notification.Action.Builder(Icon.createWithResource("android", icon), label, intent(command, requestCode(command))).build()

    private fun action(command: String, icon: Int, label: String) =
        RemoteAction(Icon.createWithResource("android", icon), label, label, intent(command, requestCode(command)))

    private fun toggleAction() = if (playing) {
        action("toggle", android.R.drawable.ic_media_pause, "Pause")
    } else {
        action("toggle", android.R.drawable.ic_media_play, "Play")
    }

    fun release() {
        activity.unregisterReceiver(receiver)
        notifications.cancel(NOTIFICATION_ID)
        session.release()
    }

    private companion object {
        const val CHANNEL = "playback"
        const val NOTIFICATION_ID = 2
        const val ACTION = "io.github.dsestu.sestudio.PLAYBACK"
        const val EXTRA_COMMAND = "command"

        /**
         * Reports the page's videos to the app (media events do not bubble, but
         * a capturing listener on the document sees them all), lets the app drive
         * the current one, and styles picture-in-picture: the video alone.
         */
        val PAGE_SCRIPT = """
            (() => {
              if (window.__sestudioApp) return;
              window.__sestudioApp = true;
              const report = () => {
                const videos = [...document.querySelectorAll('video')];
                const v = videos.find(x => !x.paused) || videos[0];
                window.__sestudioVideo = v;
                if (!v) { SestudioApp.media('{}'); return; }
                const heading = document.querySelector('main h1, main h2');
                SestudioApp.media(JSON.stringify({
                  playing: !v.paused && !v.ended,
                  position: v.currentTime || 0,
                  duration: isFinite(v.duration) ? v.duration : 0,
                  width: v.videoWidth, height: v.videoHeight,
                  title: (heading && heading.textContent.trim()) || document.title,
                }));
              };
              ['play', 'pause', 'ended', 'loadedmetadata', 'seeked', 'emptied']
                .forEach(e => document.addEventListener(e, report, true));
              window.__sestudioControl = (command, value) => {
                const v = window.__sestudioVideo;
                if (!v) return;
                if (command === 'play') v.play();
                else if (command === 'pause') v.pause();
                else if (command === 'seek') v.currentTime = Math.max(0, v.currentTime + value);
                else if (command === 'to') v.currentTime = value;
              };
              const style = document.createElement('style');
              // Sized in % of the window, not vw/vh: the web view updates those late when PiP shrinks it.
              style.textContent = 'html.sestudio-pip, html.sestudio-pip body { overflow: hidden !important; background: #000 !important } ' +
                'html.sestudio-pip * { visibility: hidden !important } ' +
                'html.sestudio-pip video { visibility: visible !important; position: fixed !important; ' +
                'inset: 0 !important; width: 100% !important; height: 100% !important; ' +
                'max-width: none !important; max-height: none !important; transform: none !important; ' +
                'z-index: 2147483647 !important; background: #000 !important; object-fit: contain !important }';
              document.head.appendChild(style);
            })();
        """.trimIndent()
    }
}
