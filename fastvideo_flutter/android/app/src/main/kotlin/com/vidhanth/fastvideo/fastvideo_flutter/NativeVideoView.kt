package com.vidhanth.fastvideo.fastvideo_flutter

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.platform.PlatformView
import java.io.File

class NativeVideoView(
    context: Context, 
    id: Int, 
    creationParams: Map<String, Any?>?, 
    messenger: BinaryMessenger
) : PlatformView, io.flutter.plugin.common.MethodChannel.MethodCallHandler {
    
    private val playerView: PlayerView = PlayerView(context)
    private var player: ExoPlayer? = null
    private val methodChannel: io.flutter.plugin.common.MethodChannel

    private fun setupPlayer(context: Context, videoName: String) {
        // Optimized LoadControl for 4K
        val loadControl = DefaultLoadControl.Builder()
            .setBufferDurationsMs(30_000, 50_000, 1_500, 2_000)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
            
        // Custom Selector to force Software Decoder for H.264 (AVC)
        val softwareSelector = object : androidx.media3.exoplayer.mediacodec.MediaCodecSelector {
            override fun getDecoderInfos(mimeType: String, requiresSecureDecoder: Boolean, requiresTunnelingDecoder: Boolean): List<androidx.media3.exoplayer.mediacodec.MediaCodecInfo> {
                val decoders = androidx.media3.exoplayer.mediacodec.MediaCodecSelector.DEFAULT
                    .getDecoderInfos(mimeType, requiresSecureDecoder, requiresTunnelingDecoder)
                
                if (mimeType.equals("video/avc", ignoreCase = true)) {
                    return decoders.sortedBy { decoder ->
                        // Prioritize Google/Android software decoders (place them first)
                        val isSoftware = decoder.name.lowercase().contains("google") || 
                                         decoder.name.lowercase().contains("android")
                        if (isSoftware) 0 else 1
                    }
                }
                return decoders
            }
        }
        
        // Use DefaultRenderersFactory to set the custom selector
        val renderersFactory = androidx.media3.exoplayer.DefaultRenderersFactory(context)
            .setMediaCodecSelector(softwareSelector)

        player = ExoPlayer.Builder(context, renderersFactory)
            .setLoadControl(loadControl)
            .setSeekParameters(androidx.media3.exoplayer.SeekParameters.CLOSEST_SYNC)
            .build()
            .apply {
                videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT
                playWhenReady = true
                
                // Add Listener for Stats
                addListener(object : androidx.media3.common.Player.Listener {
                    override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                        for (group in tracks.groups) {
                            if (group.type == C.TRACK_TYPE_VIDEO && group.isSelected) {
                                val format = group.getTrackFormat(0)
                                val mime = format.sampleMimeType ?: "Unknown"
                                val bitrate = if (format.bitrate != androidx.media3.common.Format.NO_VALUE) 
                                    "${format.bitrate / 1000} kbps" else "Unknown"
                                val codec = format.codecs ?: "Unknown"
                                
                                val info = "File: $videoName\nRes: ${format.width}x${format.height}\nMime: $mime\nBitrate: $bitrate\nCodec: $codec"
                                methodChannel.invokeMethod("updateStats", info)
                            }
                        }
                    }
                    
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        try {
                            android.util.Log.e("NativeVideoView", "Player Error: ${error.message}")
                            methodChannel.invokeMethod("updateStats", "ERROR: ${error.message}")
                        } catch (e: Exception) {
                            // ignore if channel closed
                        }
                    }
                })
                
                 addAnalyticsListener(object : androidx.media3.exoplayer.analytics.AnalyticsListener {
                    override fun onVideoDecoderInitialized(
                        eventTime: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                        decoderName: String,
                        initializationDurationMs: Long
                    ) {
                        super.onVideoDecoderInitialized(eventTime, decoderName, initializationDurationMs)
                        try {
                            methodChannel.invokeMethod("updateDecoder", decoderName)
                        } catch (e: Exception) {}
                    }
                })
            }

        playerView.player = player
        playerView.useController = true
        playerView.controllerAutoShow = true
        
        loadVideoFile(videoName)
    }
    
    // Called initially
    init {
        methodChannel = io.flutter.plugin.common.MethodChannel(messenger, "native_video_player_channel_$id")
        methodChannel.setMethodCallHandler(this)
        
        val rawName = creationParams?.get("videoName") as? String
        val videoName = rawName ?: "test4k"
        
        android.util.Log.e("FASTVIDEO_DEBUG", "Init View $id. Raw: '$rawName', Resolved: '$videoName'")
        
        setupPlayer(context, videoName)
    }

    private fun loadVideoFile(name: String) {
        android.util.Log.e("FASTVIDEO_DEBUG", "Loading video file: '$name'")
        val moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
        
        if (!moviesDir.exists()) {
             android.util.Log.e("FASTVIDEO_DEBUG", "Movies dir does not exist: ${moviesDir.absolutePath}")
             return
        }

        val file = moviesDir.listFiles()?.find { file -> 
            val match = if (name.contains(".")) {
                file.name.equals(name, ignoreCase = true)
            } else {
                (file.extension.equals("mp4", ignoreCase = true) || 
                 file.extension.equals("mkv", ignoreCase = true)) &&
                file.nameWithoutExtension.equals(name, ignoreCase = true)
            }
            if (match) {
                 android.util.Log.e("FASTVIDEO_DEBUG", "Found match: ${file.absolutePath}")
            }
            match
        }
        
        if (file == null) {
             android.util.Log.e("FASTVIDEO_DEBUG", "No matching file found for '$name' in ${moviesDir.absolutePath}")
             return
        }

        val mediaItem = MediaItem.fromUri(Uri.fromFile(file))
        player?.setMediaItem(mediaItem)
        player?.prepare()
    }

    // Completely DESTROY and REBUILD player on switch to fix decoder bugs
    private fun switchVideo(name: String) {
        // Detach from view first
        playerView.player = null
        player?.stop()
        player?.release()
        player = null
        setupPlayer(playerView.context, name)
    }

    override fun onMethodCall(call: io.flutter.plugin.common.MethodCall, result: io.flutter.plugin.common.MethodChannel.Result) {
        if (call.method == "playVideo") {
            val videoName = call.argument<String>("videoName")
            if (videoName != null) {
                switchVideo(videoName)
                result.success(null)
            } else {
                result.error("INVALID_ARGUMENT", "Video name is required", null)
            }
        } else {
            result.notImplemented()
        }
    }

    override fun dispose() {
        methodChannel.setMethodCallHandler(null)
        playerView.player = null
        player?.release()
        player = null
    }

    override fun getView(): View {
        return playerView
    }
}
