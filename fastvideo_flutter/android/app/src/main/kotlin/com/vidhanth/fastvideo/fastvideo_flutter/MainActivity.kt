package com.vidhanth.fastvideo.fastvideo_flutter

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity: FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        flutterEngine
            .platformViewsController
            .registry
            .registerViewFactory("native_video_player", NativeVideoViewFactory(flutterEngine.dartExecutor.binaryMessenger))
    }
}
