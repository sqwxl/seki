package app.seki

import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.SslErrorHandler
import android.net.http.SslError

class SekiWebViewClient(
    private val baseUrl: String,
    private val onPageLoaded: () -> Unit,
    private val onError: () -> Unit,
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        val url = request.url.toString()
        if (url.startsWith(baseUrl)) {
            return false
        }
        return true
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        injectBridge(view)
        onPageLoaded()
    }

    @Suppress("DEPRECATION")
    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        handler.cancel()
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        super.onReceivedError(view, request, error)
        if (request.isForMainFrame) {
            onError()
        }
    }

    private fun injectBridge(view: WebView) {
        val js = """
            (function() {
                if (window.SekiBridgeReady) return;
                window.SekiBridgeReady = true;
                document.dispatchEvent(new Event('sekibridge-ready'));
            })();
        """.trimIndent()
        view.evaluateJavascript(js, null)
    }
}