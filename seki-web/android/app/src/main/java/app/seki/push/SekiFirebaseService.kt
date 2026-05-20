package app.seki.push

import android.content.SharedPreferences
import android.webkit.WebView
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import app.seki.bridge.SekiBridge

class SekiFirebaseService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        val prefs = getSharedPreferences(SekiBridge.BRIDGE_NAME, MODE_PRIVATE)
        prefs.edit().putString(SekiBridge.KEY_FCM_TOKEN, token).apply()
        notifyWebView(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data ?: return
        val title = data["title"] ?: return
        val body = data["body"]
        val url = data["url"]

        if (!isWebViewForeground()) {
            NotificationHelper.showPushNotification(this, title, body, url)
            return
        }

        val json = buildString {
            append("{\"title\":")
            append(org.json.JSONObject.quote(title))
            if (body != null) {
                append(",\"body\":")
                append(org.json.JSONObject.quote(body))
            }
            if (url != null) {
                append(",\"url\":")
                append(org.json.JSONObject.quote(url))
            }
            append("}")
        }
        notifyWebView("window.dispatchEvent(new CustomEvent('sekifcm-push',{detail:$json}))")
    }

    private fun isWebViewForeground(): Boolean {
        val activity = app.seki.MainActivity.currentActivity?.get()
        return activity != null && activity.hasWindowFocus()
    }

    private fun notifyWebView(js: String) {
        val activity = app.seki.MainActivity.currentActivity?.get()
        activity?.webView?.evaluateJavascript(js, null)
    }
}