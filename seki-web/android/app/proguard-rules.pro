# Keep JavaScript interface methods
-keepclassmembers class app.seki.bridge.SekiBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep Firebase messaging service
-keep class app.seki.push.** { *; }