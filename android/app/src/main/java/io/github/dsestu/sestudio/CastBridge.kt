package io.github.dsestu.sestudio

import android.app.Activity
import android.view.ContextThemeWrapper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.mediarouter.app.MediaRouteChooserDialog
import com.google.android.gms.cast.MediaInfo
import com.google.android.gms.cast.MediaLoadRequestData
import com.google.android.gms.cast.MediaMetadata
import com.google.android.gms.cast.MediaSeekOptions
import com.google.android.gms.cast.MediaStatus
import com.google.android.gms.cast.MediaTrack
import com.google.android.gms.cast.framework.CastContext
import com.google.android.gms.cast.framework.CastSession
import com.google.android.gms.cast.framework.SessionManagerListener
import com.google.android.gms.cast.framework.media.RemoteMediaClient
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * Chromecast for the web UI inside the app. Google's web Cast library only runs
 * in Chrome, so the page gets a stand-in for the part of it the web UI uses
 * ([PAGE_SCRIPT]), and this class does the work with Android's Cast library.
 * Calls that answer later carry an id; the page is told through
 * `__sestudioCast.resolve(id, error)`, and of any state change through
 * `__sestudioCast.state(json)`.
 */
class CastBridge(private val activity: Activity, private val web: WebView) {
    private var cast: CastContext? = null
    private var pendingSession: String? = null

    private val sessions = object : SessionManagerListener<CastSession> {
        override fun onSessionStarted(session: CastSession, sessionId: String) = sessionReady(session)
        override fun onSessionResumed(session: CastSession, wasSuspended: Boolean) = sessionReady(session)
        override fun onSessionStartFailed(session: CastSession, error: Int) = settle(pendingSession, "session_error")
        override fun onSessionEnded(session: CastSession, error: Int) = push()
        override fun onSessionStarting(session: CastSession) = Unit
        override fun onSessionEnding(session: CastSession) = Unit
        override fun onSessionResuming(session: CastSession, sessionId: String) = Unit
        override fun onSessionResumeFailed(session: CastSession, error: Int) = Unit
        override fun onSessionSuspended(session: CastSession, reason: Int) = push()
    }

    private val media = object : RemoteMediaClient.Callback() {
        override fun onStatusUpdated() = push()
        override fun onMetadataUpdated() = push()
    }

    /** Once a second while something plays: the position, for the web UI's progress bar. */
    private val progress = RemoteMediaClient.ProgressListener { _, _ -> push() }

    init {
        web.addJavascriptInterface(this, "SestudioCast")
        CastContext.getSharedInstance(activity, Executors.newSingleThreadExecutor())
            .addOnSuccessListener(activity) { context ->
                cast = context
                context.sessionManager.addSessionManagerListener(sessions, CastSession::class.java)
                context.sessionManager.currentCastSession?.let { watch(it) }
                push()
            }
    }

    /** Puts the stand-in into the page; run on every page load. */
    fun inject() {
        web.evaluateJavascript(PAGE_SCRIPT, null)
        push() // a session that outlived a page reload shows up straight away
    }

    private val session get() = cast?.sessionManager?.currentCastSession
    private val client get() = session?.remoteMediaClient

    private fun sessionReady(session: CastSession) {
        watch(session)
        settle(pendingSession, null)
        pendingSession = null
        push()
    }

    private fun watch(session: CastSession) {
        session.remoteMediaClient?.apply {
            unregisterCallback(media)
            registerCallback(media)
            removeProgressListener(progress)
            addProgressListener(progress, 1000)
        }
    }

    // --- Called from the page ---------------------------------------------------

    /** Android's device picker; [id] settles once a session starts, or with "cancel". */
    @JavascriptInterface
    fun requestSession(id: String) = activity.runOnUiThread {
        val context = cast ?: return@runOnUiThread settle(id, "receiver_unavailable")
        if (session?.isConnected == true) return@runOnUiThread settle(id, null)
        pendingSession = id
        val themed = ContextThemeWrapper(activity, androidx.appcompat.R.style.Theme_AppCompat_Dialog)
        MediaRouteChooserDialog(themed).apply {
            routeSelector = context.mergedSelector ?: return@runOnUiThread settle(id, "receiver_unavailable")
            setOnDismissListener {
                // Picking a device starts the session (sessionReady); closing it otherwise is a cancel.
                if (pendingSession == id && session?.isConnected != true) {
                    activity.window.decorView.postDelayed({
                        if (pendingSession == id && session?.isConnected != true) {
                            pendingSession = null
                            settle(id, "cancel")
                        }
                    }, 8000)
                }
            }
            show()
        }
    }

    /** Loads [json] (url, contentType, title, tracks, activeTrackIds) on the receiver. */
    @JavascriptInterface
    fun load(id: String, json: String) = activity.runOnUiThread {
        val request = JSONObject(json)
        val remote = client ?: return@runOnUiThread settle(id, "session_error")
        val tracks = request.optJSONArray("tracks") ?: JSONArray()
        val metadata = MediaMetadata(MediaMetadata.MEDIA_TYPE_MOVIE).apply {
            putString(MediaMetadata.KEY_TITLE, request.optString("title"))
        }
        val info = MediaInfo.Builder(request.getString("url"))
            .setContentType(request.getString("contentType"))
            .setStreamType(MediaInfo.STREAM_TYPE_BUFFERED)
            .setMetadata(metadata)
            .setMediaTracks((0 until tracks.length()).map { index ->
                val track = tracks.getJSONObject(index)
                MediaTrack.Builder(track.getLong("id"), MediaTrack.TYPE_TEXT)
                    .setContentId(track.getString("url"))
                    .setContentType("text/vtt")
                    .setSubtype(MediaTrack.SUBTYPE_SUBTITLES)
                    .setLanguage(track.optString("lang"))
                    .setName(track.optString("name"))
                    .build()
            })
            .build()
        val active = request.optJSONArray("activeTrackIds")?.let { ids -> LongArray(ids.length()) { ids.getLong(it) } }
        remote.load(MediaLoadRequestData.Builder().setMediaInfo(info).setAutoplay(true).setActiveTrackIds(active).build())
            .setResultCallback { result -> settle(id, if (result.status.isSuccess) null else "load_media_failed") }
    }

    @JavascriptInterface
    fun control(command: String, value: Double) = activity.runOnUiThread {
        val remote = client
        when (command) {
            "playOrPause" -> remote?.togglePlayback()
            "mute" -> session?.let { it.isMute = !it.isMute }
            "seek" -> remote?.seek(MediaSeekOptions.Builder().setPosition((value * 1000).toLong()).build())
            "volume" -> session?.volume = value
            "end" -> cast?.sessionManager?.endCurrentSession(true)
        }
        push()
    }

    /** Shows the subtitle tracks [json] (an array of ids; empty for none). */
    @JavascriptInterface
    fun editTracks(id: String, json: String) = activity.runOnUiThread {
        val ids = JSONArray(json).let { array -> LongArray(array.length()) { array.getLong(it) } }
        val remote = client ?: return@runOnUiThread settle(id, "session_error")
        remote.setActiveMediaTracks(ids).setResultCallback { result ->
            settle(id, if (result.status.isSuccess) null else "edit_failed")
        }
    }

    // --- Told to the page -------------------------------------------------------

    private fun settle(id: String?, error: String?) {
        if (id == null) return
        val reason = if (error == null) "null" else JSONObject.quote(error)
        activity.runOnUiThread {
            web.evaluateJavascript("window.__sestudioCast && __sestudioCast.resolve(${JSONObject.quote(id)}, $reason)", null)
        }
    }

    /** The receiver's state, in the shape of the web library's RemotePlayer. */
    private fun push() {
        val current = session
        val remote = current?.remoteMediaClient
        val status = remote?.mediaStatus
        val info = remote?.mediaInfo
        val state = JSONObject()
            .put("isConnected", current?.isConnected == true)
            .put("deviceName", current?.castDevice?.friendlyName ?: "")
            .put("isPaused", status?.playerState == MediaStatus.PLAYER_STATE_PAUSED)
            .put("currentTime", (remote?.approximateStreamPosition ?: 0) / 1000.0)
            .put("duration", (remote?.streamDuration ?: 0) / 1000.0)
            .put("volumeLevel", current?.volume ?: 1.0)
            .put("isMuted", current?.isMute == true)
            .put("canSeek", status?.isMediaCommandSupported(MediaStatus.COMMAND_SEEK) == true)
            .put("canControlVolume", current != null)
            .put(
                "playerState",
                when (status?.playerState) {
                    MediaStatus.PLAYER_STATE_PLAYING -> "PLAYING"
                    MediaStatus.PLAYER_STATE_PAUSED -> "PAUSED"
                    MediaStatus.PLAYER_STATE_BUFFERING, MediaStatus.PLAYER_STATE_LOADING -> "BUFFERING"
                    else -> "IDLE"
                },
            )
            .put("contentId", info?.contentId ?: "")
            .put("title", info?.metadata?.getString(MediaMetadata.KEY_TITLE) ?: "")
        activity.runOnUiThread {
            web.evaluateJavascript("window.__sestudioCast && __sestudioCast.state($state)", null)
        }
    }

    fun release() {
        cast?.sessionManager?.removeSessionManagerListener(sessions, CastSession::class.java)
        client?.apply {
            unregisterCallback(media)
            removeProgressListener(progress)
        }
    }

    private companion object {
        /**
         * The part of Google's web Cast library (cast_sender.js) the web UI uses,
         * forwarding to [CastBridge]. The real library is not loaded in the app
         * (MainActivity serves it empty); whoever registered __onGCastApiAvailable,
         * before or after this runs, is told the API is there.
         */
        val PAGE_SCRIPT = """
            (() => {
              if (window.__sestudioCast) return;
              let calls = 0;
              const waiting = {};
              const call = (method, ...args) => new Promise((ok, fail) => {
                const id = String(++calls);
                waiting[id] = { ok, fail };
                SestudioCast[method](id, ...args);
              });
              const players = [];
              const listeners = [];
              const remote = {
                isConnected: false, isPaused: false, currentTime: 0, duration: 0, volumeLevel: 1,
                isMuted: false, canSeek: false, canControlVolume: false, playerState: 'IDLE', mediaInfo: null,
              };
              let deviceName = '';
              window.__sestudioCast = {
                resolve(id, error) {
                  const w = waiting[id]; delete waiting[id];
                  if (w) error ? w.fail(error) : w.ok();
                },
                state(s) {
                  deviceName = s.deviceName;
                  Object.assign(remote, {
                    isConnected: s.isConnected, isPaused: s.isPaused, currentTime: s.currentTime,
                    duration: s.duration, volumeLevel: s.volumeLevel, isMuted: s.isMuted, canSeek: s.canSeek,
                    canControlVolume: s.canControlVolume, playerState: s.playerState,
                    mediaInfo: s.contentId ? { contentId: s.contentId, metadata: { title: s.title } } : null,
                  });
                  players.forEach(p => Object.assign(p, remote));
                  listeners.forEach(f => f({ type: 'anyChanged' }));
                },
              };
              const mediaSession = {
                editTracksInfo(request, ok, fail) {
                  call('editTracks', JSON.stringify(request.activeTrackIds || [])).then(ok, fail);
                },
              };
              const session = {
                getCastDevice: () => ({ friendlyName: deviceName }),
                getMediaSession: () => mediaSession,
                loadMedia(request) {
                  const m = request.media;
                  return call('load', JSON.stringify({
                    url: m.contentId, contentType: m.contentType, title: (m.metadata || {}).title || '',
                    tracks: (m.tracks || []).map(t => ({ id: t.trackId, url: t.trackContentId, lang: t.language, name: t.name })),
                    activeTrackIds: request.activeTrackIds || [],
                  }));
                },
              };
              const context = {
                setOptions() {},
                getCurrentSession: () => (remote.isConnected ? session : null),
                requestSession: () => call('requestSession'),
                endCurrentSession: () => SestudioCast.control('end', 0),
              };
              function RemotePlayer() { Object.assign(this, remote); players.push(this); }
              function RemotePlayerController(player) { this.player = player; }
              RemotePlayerController.prototype = {
                addEventListener(type, f) { listeners.push(f); },
                playOrPause() { SestudioCast.control('playOrPause', 0); },
                muteOrUnmute() { SestudioCast.control('mute', 0); },
                seek() { SestudioCast.control('seek', this.player.currentTime || 0); },
                setVolumeLevel() { SestudioCast.control('volume', this.player.volumeLevel); },
              };
              window.cast = { framework: {
                CastContext: { getInstance: () => context },
                RemotePlayer, RemotePlayerController,
                RemotePlayerEventType: { ANY_CHANGE: 'anyChanged' },
              } };
              const media = {
                DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
                MediaInfo: function (contentId, contentType) { this.contentId = contentId; this.contentType = contentType; },
                GenericMediaMetadata: function () {},
                LoadRequest: function (mediaInfo) { this.media = mediaInfo; },
                Track: function (trackId, type) { this.trackId = trackId; this.type = type; },
                TrackType: { TEXT: 'TEXT' },
                TextTrackType: { SUBTITLES: 'SUBTITLES' },
                EditTracksInfoRequest: function (ids) { this.activeTrackIds = ids; },
              };
              window.chrome = Object.assign(window.chrome || {}, { cast: { media, AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' } } });
              // The web UI registers this before loading the library; either order works.
              let ready = window.__onGCastApiAvailable;
              Object.defineProperty(window, '__onGCastApiAvailable', {
                configurable: true,
                get: () => ready,
                set: f => { ready = f; setTimeout(() => f(true)); },
              });
              if (typeof ready === 'function') setTimeout(() => ready(true));
            })();
        """.trimIndent()
    }
}
