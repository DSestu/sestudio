package io.github.dsestu.sestudio

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.app.DownloadManager
import android.content.res.Configuration
import android.content.Intent
import android.graphics.Color
import android.graphics.Insets
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.URLUtil
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.Socket
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.net.URL
import kotlin.concurrent.thread

/**
 * sestudio's web UI, full screen. Until the server answers, the setup screens
 * (assets/setup.html): the whole setup on first launch, "Starting…" after.
 */
class MainActivity : Activity() {
    private var web: WebView? = null
    private var playback: Playback? = null
    private var cast: CastBridge? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    /** Re-renders the setup screen; set while it is showing. */
    private var refreshSetup: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        boot(Runtime(this))
    }

    override fun onResume() {
        super.onResume()
        refreshSetup?.invoke() // back from the battery settings
        // Stopped from the notification: start over, which runs the server's latest version.
        if (web != null && !ServerService.running) recreate()
    }

    private class Step(val label: String) {
        var state = "wait"
        var detail = ""
        var fraction: Double? = null
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun boot(runtime: Runtime) {
        val page = WebView(this).apply {
            settings.javaScriptEnabled = true
            setBackgroundColor(Color.rgb(0x13, 0x17, 0x20))
        }
        val firstRun = !runtime.isReady
        val steps = if (firstRun) {
            listOf(Step("Linux base"), Step("uv"), Step("Python and sestudio"), Step("Starting"))
        } else {
            listOf(Step("Starting"))
        }
        // Background use is required: without it Android stops the server minutes after the screen locks.
        fun allowed() = getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)
        var screen = when {
            firstRun -> "welcome"
            !allowed() -> "background"
            else -> "starting"
        }
        var error = ""
        var running = false

        fun render() {
            val state = JSONObject()
                .put("screen", screen)
                .put("error", error)
                .put("background", allowed())
                .put("steps", JSONArray(steps.map {
                    JSONObject().put("label", it.label).put("state", it.state).put("detail", it.detail)
                        .put("fraction", it.fraction ?: JSONObject.NULL)
                }))
            runOnUiThread { page.evaluateJavascript("render($state)", null) }
        }

        fun run() {
            if (running || !allowed()) return
            running = true
            if (screen != "starting") screen = "progress"
            error = ""
            steps.forEach { it.state = "wait"; it.detail = ""; it.fraction = null }
            render()
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // The server's notification, with its Stop button.
                runOnUiThread { requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 0) }
            }
            thread(name = "boot") {
                try {
                    runtime.install { index, done, total ->
                        steps.take(index).forEach { it.state = "done"; it.fraction = null }
                        steps[index].apply {
                            state = "run"
                            detail = if (done >= 0) "${done / 1_000_000} MB" else ""
                            fraction = if (total > 0) done.toDouble() / total else null
                        }
                        render()
                    }
                    steps.dropLast(1).forEach { it.state = "done"; it.fraction = null }
                    val log = ServerService.logFile(this@MainActivity)
                    if (!ServerService.running) log.delete()
                    ServerService.start(this@MainActivity)
                    // The first start installs Python and sestudio, which reports in the log.
                    val waiting = if (firstRun) steps[2] else steps.last()
                    waiting.state = "run"
                    val deadline = System.currentTimeMillis() + 15 * 60_000
                    while (!answers()) {
                        check(System.currentTimeMillis() < deadline) { "The server did not answer in 15 minutes." }
                        Thread.sleep(1000)
                        check(ServerService.running) { "The server stopped:\n" + tail(log) }
                        waiting.detail = tail(log, 1).take(60)
                        render()
                    }
                    steps.forEach { it.state = "done"; it.detail = ""; it.fraction = null }
                    screen = "ready"
                    render()
                    runOnUiThread { showWeb(null) }
                } catch (e: Exception) {
                    steps.firstOrNull { it.state == "run" }?.state = "bad"
                    error = e.message ?: e.stackTraceToString().lines().take(6).joinToString("\n")
                    screen = "failed"
                    render()
                } finally {
                    running = false
                }
            }
        }

        page.addJavascriptInterface(object {
            @JavascriptInterface fun start() = run()

            @JavascriptInterface fun retry() = run()

            @JavascriptInterface fun allowBackground() = runOnUiThread {
                startActivity(
                    Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")),
                )
            }

            @JavascriptInterface fun copyLog() {
                val log = (steps.map { "${it.state} ${it.label} ${it.detail}" } + error).joinToString("\n")
                getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("sestudio setup", log))
            }
        }, "Setup")
        page.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                render()
                if (screen == "starting") run() // nothing to ask: start straight away
            }
        }
        refreshSetup = {
            // Back from Android's prompt: a later launch starts once background use is allowed.
            if (screen == "background" && allowed()) {
                screen = "starting"
                run()
            } else {
                render()
            }
        }
        show(page)
        page.loadUrl("file:///android_asset/setup.html")
    }

    /** The last [lines] lines of [file], or nothing yet. */
    private fun tail(file: File, lines: Int = 15) =
        if (file.exists()) file.readLines().takeLast(lines).joinToString("\n") else ""

    /** Whether the server answers HTTP yet, and listens on HTTPS: the two ports come up one after the other. */
    private fun answers(): Boolean = try {
        (URL(SERVER_URL).openConnection() as HttpURLConnection).run {
            connectTimeout = 1000
            readTimeout = 2000
            responseCode in 200..399
        } && Socket().use { it.connect(InetSocketAddress("127.0.0.1", BuildConfig.HTTPS_PORT), 1000); true }
    } catch (_: Exception) {
        false
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun showWeb(savedInstanceState: Bundle?) {
        refreshSetup = null
        val start = serverUrl()
        var host = Uri.parse(start).host
        val view = PlayerWebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // the library and settings live in localStorage
            settings.mediaPlaybackRequiresUserGesture = false
            // Honour the page's viewport meta like a browser: the width fits the screen again after
            // picture-in-picture, and long text wraps instead of widening the page.
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            webViewClient = object : WebViewClient() {
                // The server's certificate is self-signed: trust that one, and only it.
                // Read afresh each time: the server makes a new one when the phone gets a new address.
                override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                    val presented = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) error.certificate.x509Certificate else null
                    val trusted = serverCertificate()
                    if (trusted != null && presented == trusted) {
                        handler.proceed()
                    } else {
                        handler.cancel()
                        view.loadUrl(SERVER_URL)
                    }
                }

                override fun onPageFinished(view: WebView, url: String) {
                    playback?.inject()
                    cast?.inject()
                }

                // The server not answering (still starting, restarting): try the page again in a second.
                override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                    if (request.isForMainFrame) view.postDelayed({ view.loadUrl(request.url.toString()) }, 1000)
                }

                // Google's web Cast library does not run here; CastBridge stands in for it.
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    if (request.url.path.orEmpty().contains("cast_sender")) {
                        WebResourceResponse("text/javascript", "utf-8", ByteArrayInputStream(ByteArray(0)))
                    } else {
                        null
                    }

                // Other sites (a TMDB guide, a trailer) open in the browser.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    val target = request.url
                    if (target.host == host || target.host == "localhost") return false
                    startActivity(Intent(Intent.ACTION_VIEW, target))
                    return true
                }
            }
            webChromeClient = FullscreenVideo()
            // "This device" downloads: Android's download manager, over the server's plain HTTP
            // port (it would not trust the self-signed certificate), into Movies/sestudio.
            setDownloadListener { url, _, disposition, mime, _ ->
                val local = Uri.parse(url).buildUpon().scheme("http").encodedAuthority("127.0.0.1:${BuildConfig.HTTP_PORT}").build()
                val name = URLUtil.guessFileName(url, disposition, mime)
                getSystemService(DownloadManager::class.java).enqueue(
                    DownloadManager.Request(local)
                        .setTitle(name)
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationInExternalPublicDir(Environment.DIRECTORY_MOVIES, "sestudio/$name"),
                )
            }
        }
        playback = Playback(this, view).also { player -> view.keepVisible = { player.playing } }
        cast = CastBridge(this, view)
        web = view
        show(view)
        if (savedInstanceState == null) view.loadUrl(start) else view.restoreState(savedInstanceState)

        // The phone on another network, or another address on it: the page follows, on the
        // same screen, so casting keeps working without reopening the app. After a pause, as
        // the server takes a few seconds to make a cert for the new address.
        fun follow() { view.postDelayed({
            val next = serverUrl()
            val nextHost = Uri.parse(next).host
            if (nextHost == host) return@postDelayed
            host = nextHost
            view.loadUrl(next + (Uri.parse(view.url ?: "").fragment?.let { "/#$it" } ?: ""))
        }, 6000) }
        networkCallback = object : ConnectivityManager.NetworkCallback() {
            override fun onLinkPropertiesChanged(network: Network, properties: LinkProperties) = follow()
            override fun onLost(network: Network) = follow()
        }.also { getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(it) }
    }

    /**
     * The phone's Wi-Fi address over HTTPS, so media URLs the page gives a TV
     * reach the phone, and the page keeps a secure context. Off Wi-Fi: localhost.
     */
    private fun serverUrl(): String {
        val network = getSystemService(ConnectivityManager::class.java)
        val active = network.activeNetwork ?: return SERVER_URL
        if (network.getNetworkCapabilities(active)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) != true) return SERVER_URL
        val ip = network.getLinkProperties(active)?.linkAddresses
            ?.map { it.address }
            ?.firstOrNull { it is Inet4Address && !it.isLoopbackAddress }
            ?.hostAddress ?: return SERVER_URL
        return "https://$ip:${BuildConfig.HTTPS_PORT}"
    }

    /** The certificate sestudio made for its HTTPS port; null before it has made one. */
    private fun serverCertificate(): X509Certificate? {
        val pem = File(Runtime(this).rootfs, "root/.config/sestudio/cert.pem")
        if (!pem.exists()) return null
        return pem.inputStream().use { CertificateFactory.getInstance("X.509").generateCertificate(it) as X509Certificate }
    }

    /** A video's fullscreen button: its view laid over everything, until it ends. */
    private inner class FullscreenVideo : WebChromeClient() {
        private var shown: View? = null
        private var callback: CustomViewCallback? = null

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            shown?.let { onHideCustomView() }
            shown = view
            this.callback = callback
            (window.decorView as FrameLayout).addView(view, FrameLayout.LayoutParams(-1, -1))
        }

        override fun onHideCustomView() {
            shown?.let { (window.decorView as FrameLayout).removeView(it) }
            shown = null
            callback?.onCustomViewHidden()
            callback = null
        }

        fun leave(): Boolean = (shown != null).also { if (it) onHideCustomView() }
    }

    /** Full screen, like an app: the window only has its bars once it has content. */
    private fun show(view: View) {
        setContentView(view)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.apply {
                hide(WindowInsets.Type.systemBars())
                systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
            // The page reaches the top edge, the camera hole over the header's gap between
            // logo and menu: reporting the cutout as a safe area cost 40 px of empty header.
            view.setOnApplyWindowInsetsListener { target, insets ->
                target.onApplyWindowInsets(
                    WindowInsets.Builder(insets).setInsets(WindowInsets.Type.displayCutout(), Insets.NONE).build(),
                )
            }
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Android 12+ enters picture-in-picture by itself (setAutoEnterEnabled).
        val player = playback
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S && player?.playing == true) enterPictureInPictureMode(player.params())
    }

    override fun onPictureInPictureModeChanged(active: Boolean, config: Configuration) {
        super.onPictureInPictureModeChanged(active, config)
        playback?.pictureInPicture(active)
    }

    override fun onDestroy() {
        networkCallback?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
        playback?.release()
        cast?.release()
        super.onDestroy()
    }

    /** A web view that stays visible to its page while a video plays, so it plays on in the background. */
    private class PlayerWebView(context: Context) : WebView(context) {
        var keepVisible: () -> Boolean = { false }

        override fun onWindowVisibilityChanged(visibility: Int) =
            super.onWindowVisibilityChanged(if (keepVisible()) View.VISIBLE else visibility)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web?.saveState(outState)
    }

    @Deprecated("Back stays inside the web app's own history first.")
    override fun onBackPressed() {
        val view = web
        when {
            (view?.webChromeClient as? FullscreenVideo)?.leave() == true -> Unit
            view != null && view.canGoBack() -> view.goBack()
            else -> @Suppress("DEPRECATION") super.onBackPressed()
        }
    }

    companion object {
        val SERVER_URL = "http://localhost:${BuildConfig.HTTP_PORT}"
    }
}
