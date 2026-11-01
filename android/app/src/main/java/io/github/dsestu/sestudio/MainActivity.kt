package io.github.dsestu.sestudio

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

/**
 * sestudio's web UI, full screen. The first launch shows the setup screens
 * (assets/setup.html) and sets up the Linux sestudio runs in.
 */
class MainActivity : Activity() {
    private var web: WebView? = null

    /** Re-renders the setup screen; set while it is showing. */
    private var refreshSetup: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val runtime = Runtime(this)
        if (runtime.isReady) showWeb(savedInstanceState) else setUp(runtime)
    }

    override fun onResume() {
        super.onResume()
        refreshSetup?.invoke() // back from the battery settings
    }

    private class Step(val label: String) {
        var state = "wait"
        var detail = ""
        var fraction: Double? = null
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    private fun setUp(runtime: Runtime) {
        val page = WebView(this).apply {
            settings.javaScriptEnabled = true
            setBackgroundColor(Color.rgb(0x13, 0x17, 0x20))
        }
        val steps = listOf(Step("Linux base"), Step("uv"), Step("Checking"))
        var screen = "welcome"
        var error = ""
        var running = false

        fun render() {
            val state = JSONObject()
                .put("screen", screen)
                .put("error", error)
                .put("background", getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName))
                .put("steps", JSONArray(steps.map {
                    JSONObject().put("label", it.label).put("state", it.state).put("detail", it.detail)
                        .put("fraction", it.fraction ?: JSONObject.NULL)
                }))
            runOnUiThread { page.evaluateJavascript("render($state)", null) }
        }

        fun run() {
            if (running) return
            running = true
            screen = "progress"
            error = ""
            steps.forEach { it.state = "wait"; it.detail = ""; it.fraction = null }
            render()
            thread(name = "setup") {
                try {
                    runtime.install { index, done, total ->
                        steps.take(index).forEach { it.state = "done"; it.fraction = null }
                        steps[index].apply {
                            state = "run"
                            detail = "${done / 1_000_000} MB"
                            fraction = if (total > 0) done.toDouble() / total else null
                        }
                        render()
                    }
                    steps.take(2).forEach { it.state = "done"; it.fraction = null }
                    steps[2].state = "run"
                    render()
                    val check = runtime.command("uv", "--version").start()
                    val version = check.inputStream.bufferedReader().readText().trim()
                    check(check.waitFor() == 0) { version.ifEmpty { "uv did not start" } }
                    steps[2].apply { state = "done"; detail = version }
                    screen = "ready"
                    render()
                    Thread.sleep(1500)
                    runOnUiThread { showWeb(null) }
                } catch (e: Exception) {
                    steps.firstOrNull { it.state == "run" }?.state = "bad"
                    error = e.stackTraceToString().lines().take(6).joinToString("\n")
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
            override fun onPageFinished(view: WebView, url: String) = render()
        }
        refreshSetup = ::render
        show(page)
        page.loadUrl("file:///android_asset/setup.html")
    }

    private fun showWeb(savedInstanceState: Bundle?) {
        refreshSetup = null
        val view = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true // the library and settings live in localStorage
            settings.mediaPlaybackRequiresUserGesture = false
        }
        web = view
        show(view)
        if (savedInstanceState == null) view.loadUrl(SERVER_URL) else view.restoreState(savedInstanceState)
    }

    /** Full screen: the window only has its bars once it has content. */
    private fun show(view: View) {
        setContentView(view)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) window.insetsController?.apply {
            hide(WindowInsets.Type.systemBars())
            systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web?.saveState(outState)
    }

    @Deprecated("Back stays inside the web app's own history first.")
    override fun onBackPressed() {
        val view = web
        if (view != null && view.canGoBack()) view.goBack() else @Suppress("DEPRECATION") super.onBackPressed()
    }

    companion object {
        const val SERVER_URL = "http://localhost:8080"
    }
}
