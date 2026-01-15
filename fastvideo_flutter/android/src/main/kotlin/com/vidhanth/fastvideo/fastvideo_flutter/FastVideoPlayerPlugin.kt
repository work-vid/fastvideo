package com.vidhanth.fastvideo.fastvideo_flutter

import io.flutter.embedding.engine.plugins.FlutterPlugin

class FastVideoPlayerPlugin: FlutterPlugin {
    override fun onAttachedToEngine(flutterPluginBinding: FlutterPlugin.FlutterPluginBinding) {
        flutterPluginBinding
            .platformViewRegistry
            .registerViewFactory(
                "native_video_player",
                NativeVideoViewFactory(flutterPluginBinding.binaryMessenger)
            )
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        // No cleanup needed
    }
}
