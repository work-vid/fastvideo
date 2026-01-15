package com.vidhanth.fastvideo.fastvideo_flutter

import android.content.Context
import android.net.Uri
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.view.View
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.PlayerView
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.platform.PlatformView
import java.io.File
import kotlin.math.max
import kotlin.math.min

class NativeVideoView(
    val context: Context,
    id: Int,
    creationParams: Map<String, Any?>?,
    messenger: BinaryMessenger
) : PlatformView, MethodChannel.MethodCallHandler {
    
    private val playerView: PlayerView = PlayerView(context)
    private var player: ExoPlayer? = null
    private val methodChannel: MethodChannel = MethodChannel(messenger, "native_video_player_channel_$id")
    private var showControls: Boolean = true
    
    private val progressHandler = Handler(Looper.getMainLooper())
    private val progressRunnable = object : Runnable {
        override fun run() {
            player?.let { p ->
                if (p.isPlaying) {
                     val position = p.currentPosition / 1000
                     val duration = p.duration / 1000
                     if (duration > 0) {
                         methodChannel.invokeMethod("onEvent", mapOf(
                             "event" to "progress",
                             "position" to position,
                             "duration" to duration
                         ))
                     }
                }
            }
            progressHandler.postDelayed(this, 1000)
        }
    }

    private fun setupPlayer(videoNameOrPath: String) {
        // optimized load control
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
                        // Prioritize Google/Android software decoders
                        val isSoftware = decoder.name.lowercase().contains("google") || 
                                         decoder.name.lowercase().contains("android")
                        if (isSoftware) 0 else 1
                    }
                }
                return decoders
            }
        }
        
        val renderersFactory = androidx.media3.exoplayer.DefaultRenderersFactory(context)
            .setMediaCodecSelector(softwareSelector)

        player = ExoPlayer.Builder(context, renderersFactory)
            .setLoadControl(loadControl)
            .setSeekParameters(androidx.media3.exoplayer.SeekParameters.CLOSEST_SYNC)
            .build()
            .apply {
                videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT
                playWhenReady = true
                
                // Add Listeners
                addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        super.onPlaybackStateChanged(playbackState)
                        if (playbackState == Player.STATE_READY) {
                             val durationSec = duration / 1000
                             methodChannel.invokeMethod("onEvent", mapOf(
                                 "event" to "initialized",
                                 "duration" to durationSec
                             ))
                             // If playing, send started event
                             if (playWhenReady) {
                                 methodChannel.invokeMethod("onEvent", mapOf("event" to "started"))
                             }
                        } else if (playbackState == Player.STATE_ENDED) {
                            methodChannel.invokeMethod("onEvent", mapOf("event" to "ended"))
                        }
                    }

                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        super.onIsPlayingChanged(isPlaying)
                        if (isPlaying) {
                            methodChannel.invokeMethod("onEvent", mapOf("event" to "started")) // Or resumed
                        } else {
                            methodChannel.invokeMethod("onEvent", mapOf("event" to "paused"))
                        }
                    }

                    override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                        for (group in tracks.groups) {
                            if (group.type == C.TRACK_TYPE_VIDEO && group.isSelected) {
                                val format = group.getTrackFormat(0)
                                val mime = format.sampleMimeType ?: "Unknown"
                                val bitrate = if (format.bitrate != androidx.media3.common.Format.NO_VALUE) 
                                    "${format.bitrate / 1000} kbps" else "Unknown"
                                val codec = format.codecs ?: "Unknown"
                                
                                val info = "File: $videoNameOrPath\nRes: ${format.width}x${format.height}\nMime: $mime\nBitrate: $bitrate\nCodec: $codec"
                                methodChannel.invokeMethod("updateStats", info)
                            }
                        }
                    }
                    
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        try {
                            android.util.Log.e("NativeVideoView", "Player Error: ${error.message}")
                            methodChannel.invokeMethod("updateStats", "ERROR: ${error.message}")
                        } catch (e: Exception) { }
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
        playerView.useController = showControls 
        playerView.controllerAutoShow = showControls
        
        loadVideoFile(videoNameOrPath)
    }
    
    init {
        methodChannel.setMethodCallHandler(this)
        progressHandler.post(progressRunnable)
        
        val rawName = creationParams?.get("videoName") as? String
        val videoName = rawName ?: "test4k"
        
        if (creationParams?.containsKey("showControls") == true) {
            showControls = creationParams["showControls"] as Boolean
        }

        setupPlayer(videoName)
    }

    private fun loadVideoFile(name: String) {
        // Try as absolute path first (plugin friendly)
        var file = File(name)
        if (!file.exists()) {
            // Fallback to Movies dir (legacy app behavior)
            val moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
            if (moviesDir.exists()) {
                 val found = moviesDir.listFiles()?.find { f -> 
                    val match = if (name.contains(".")) {
                        f.name.equals(name, ignoreCase = true)
                    } else {
                        (f.extension.equals("mp4", ignoreCase = true) || 
                         f.extension.equals("mkv", ignoreCase = true)) &&
                        f.nameWithoutExtension.equals(name, ignoreCase = true)
                    }
                    match
                }
                if (found != null) {
                    file = found
                }
            }
        }
        
        if (!file.exists()) {
             android.util.Log.e("FASTVIDEO", "File not found: $name")
             return
        }

        val mediaItem = MediaItem.fromUri(Uri.fromFile(file))
        // If switched, we already created a new player instance in switchVideo, so we just set media item here.
        player?.setMediaItem(mediaItem)
        player?.prepare()
    }

    // DESTROY and REBUILD player logic - reused from original
    private fun switchVideo(name: String) {
        playerView.player = null
        player?.stop()
        player?.release()
        player = null
        setupPlayer(name)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        when (call.method) {
            "load" -> {
                val name = call.argument<String>("videoName") ?: call.argument<String>("path")
                if (name != null) {
                    switchVideo(name)
                    result.success(null)
                } else {
                    result.error("INVALID", "Path required", null)
                }
            }
            "play" -> {
                player?.play()
                result.success(null)
            }
            "pause" -> {
                player?.pause()
                result.success(null)
            }
            "setVolume" -> {
                val vol = call.argument<Double>("volume") // 0-10
                if (vol != null) {
                    // Map 0-10 to 0.0-1.0
                    val volume = (vol / 10.0).toFloat()
                    player?.volume = max(0f, min(1f, volume))
                    result.success(null)
                } else {
                    result.error("INVALID", "Volume required", null)
                }
            }
            "seekTo" -> {
                val pos = call.argument<Int>("position") // seconds
                if (pos != null) {
                    player?.seekTo(pos * 1000L)
                    result.success(null)
                } else {
                    result.error("INVALID", "Position required", null)
                }
            }
            "setLooping" -> {
                 val looping = call.argument<Boolean>("looping") ?: false
                 player?.repeatMode = if (looping) Player.REPEAT_MODE_ONE else Player.REPEAT_MODE_OFF
                 result.success(null)
            }
            "dispose" -> {
                dispose()
                result.success(null)
            }
            else -> result.notImplemented()
        }
    }

    override fun dispose() {
        methodChannel.setMethodCallHandler(null)
        progressHandler.removeCallbacks(progressRunnable)
        playerView.player = null
        player?.release()
        player = null
    }

    override fun getView(): View {
        return playerView
    }
}
