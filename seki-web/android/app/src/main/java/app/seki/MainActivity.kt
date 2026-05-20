package app.seki

import android.annotation.SuppressLint
import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebChromeClient
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewCompat
import app.seki.bridge.SekiBridge
import app.seki.push.NotificationHelper
import java.lang.ref.WeakReference

class MainActivity : AppCompatActivity() {

    var webView: WebView? = null
        private set

    private var loadingView: android.view.View? = null
    private var errorView: android.view.View? = null

    companion object {
        var currentActivity: WeakReference<MainActivity>? = null
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        currentActivity = WeakReference(this)

        NotificationHelper.createChannel(this)

        val webView = findViewById<WebView>(R.id.webview)
        this.webView = webView

        WebViewSetup.configure(webView)

        val bridge = SekiBridge(getSharedPreferences(SekiBridge.BRIDGE_NAME, MODE_PRIVATE))
        webView.addJavascriptInterface(bridge, SekiBridge.BRIDGE_NAME)

        webView.webChromeClient = WebChromeClient()

        val baseUrl = BuildConfig.SEKI_BASE_URL
        webView.webViewClient = SekiWebViewClient(
            baseUrl = baseUrl,
            onPageLoaded = { runOnUiThread { showContent() } },
            onError = { runOnUiThread { showError() } },
        )

        webView.loadUrl(baseUrl)

        handleDeepLink(intent)
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        notifyLifecycle("foreground")
    }

    override fun onPause() {
        super.onPause()
        webView?.onPause()
        notifyLifecycle("background")
    }

    override fun onDestroy() {
        super.onDestroy()
        webView?.destroy()
        webView = null
        currentActivity = null
    }

    override fun onBackPressed() {
        if (webView?.canGoBack() == true) {
            webView?.goBack()
        } else {
            moveTaskToBack(true)
        }
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        handleDeepLink(intent)
    }

    private fun handleDeepLink(intent: android.content.Intent?) {
        val url = intent?.getStringExtra("deep_link_url") ?: return
        webView?.post {
            val js = "window.location.href = ${org.json.JSONObject.quote(url)}"
            webView?.evaluateJavascript(js, null)
        }
    }

    private fun notifyLifecycle(event: String) {
        webView?.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('sekilifecycle',{detail:'$event'}))",
            null,
        )
    }

    private fun showContent() {
        loadingView?.visibility = android.view.View.GONE
        errorView?.visibility = android.view.View.GONE
        webView?.visibility = android.view.View.VISIBLE
    }

    private fun showError() {
        loadingView?.visibility = android.view.View.GONE
        webView?.visibility = android.view.View.GONE
        if (errorView == null) {
            errorView = android.widget.TextView(this).apply {
                text = "Failed to load Seki.\nCheck your connection and try again."
                textSize = 18f
                gravity = android.view.Gravity.CENTER
                setOnClickListener {
                    webView?.reload()
                }
            }
            (findViewById<android.widget.FrameLayout>(android.R.id.content)).addView(errorView)
        }
        errorView?.visibility = android.view.View.VISIBLE
    }
}