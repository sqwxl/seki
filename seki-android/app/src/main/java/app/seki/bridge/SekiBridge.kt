package app.seki.bridge

import android.content.SharedPreferences
import android.webkit.JavascriptInterface

class SekiBridge(
    private val prefs: SharedPreferences,
) {
    @JavascriptInterface
    fun getFcmToken(): String {
        return prefs.getString(KEY_FCM_TOKEN, "") ?: ""
    }

    companion object {
        const val KEY_FCM_TOKEN = "seki:fcm_token"
        const val BRIDGE_NAME = "SekiBridge"
    }
}