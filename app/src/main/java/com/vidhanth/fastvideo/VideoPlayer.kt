package com.vidhanth.fastvideo

import android.content.Context
import android.os.Environment
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.TrackSelectionParameters
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.media3.ui.PlayerView
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.background
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.graphics.Color
import java.io.File

@OptIn(UnstableApi::class)
@Composable
fun VideoPlayer(modifier: Modifier = Modifier) {
    var currentVideoName by remember { mutableStateOf<String?>("test4k") }
    var showCustomDialog by remember { mutableStateOf(false) }
    var customInputText by remember { mutableStateOf("") }
    
    Box(modifier = modifier.fillMaxSize()) {
        // Critical: key() ensures the entire SingleVideoPlayer composable (and its ExoPlayer) 
        // is disposed and recreated from scratch when currentVideoName changes.
        // This is the most robust way to clear buggy decoders on TV boxes.
        androidx.compose.runtime.key(currentVideoName) {
            SingleVideoPlayer(
                videoName = currentVideoName,
                modifier = Modifier.fillMaxSize()
            )
        }

        // UI Controls (Overlay)
        Column(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .padding(bottom = 50.dp)
                .fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                androidx.compose.material3.Button(onClick = { currentVideoName = "test1080" }) {
                    androidx.compose.material3.Text("1080p")
                }
                androidx.compose.material3.Button(onClick = { currentVideoName = "test2k" }) {
                    androidx.compose.material3.Text("2K")
                }
                androidx.compose.material3.Button(onClick = { currentVideoName = "test4k" }) {
                    androidx.compose.material3.Text("4K")
                }
                androidx.compose.material3.Button(onClick = { showCustomDialog = true }) {
                    androidx.compose.material3.Text("Custom")
                }
            }
        }

        if (showCustomDialog) {
            androidx.compose.material3.AlertDialog(
                onDismissRequest = { showCustomDialog = false },
                title = { androidx.compose.material3.Text("Enter Filename") },
                text = {
                    androidx.compose.material3.TextField(
                        value = customInputText,
                        onValueChange = { customInputText = it },
                        placeholder = { androidx.compose.material3.Text("video.mp4") }
                    )
                },
                confirmButton = {
                    androidx.compose.material3.TextButton(
                        onClick = {
                            if (customInputText.isNotBlank()) {
                                currentVideoName = customInputText
                            }
                            showCustomDialog = false
                        }
                    ) {
                        androidx.compose.material3.Text("Play")
                    }
                },
                dismissButton = {
                    androidx.compose.material3.TextButton(onClick = { showCustomDialog = false }) {
                        androidx.compose.material3.Text("Cancel")
                    }
                }
            )
        }
    }
}

@OptIn(UnstableApi::class)
@Composable
fun SingleVideoPlayer(videoName: String?, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    var debugInfo by remember { mutableStateOf("Loading...") }

    // 1. Configure Buffer for 4K High Bitrate
    val loadControl = DefaultLoadControl.Builder()
        .setBufferDurationsMs(
            30_000, 
            50_000, 
            1_500,  
            2_000   
        )
        .setPrioritizeTimeOverSizeThresholds(true)
        .build()
        
    // Custom Selector to force Software Decoder for H.264 (AVC)
    // This bypasses the buggy hardware decoder on some TV boxes for high-profile AVC.
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
    val renderersFactory = androidx.media3.exoplayer.DefaultRenderersFactory(LocalContext.current)
        .setMediaCodecSelector(softwareSelector)

    val exoPlayer = remember {
        ExoPlayer.Builder(context, renderersFactory)
            .setLoadControl(loadControl)
            .setSeekParameters(androidx.media3.exoplayer.SeekParameters.CLOSEST_SYNC)
            .build()
            .apply {
                videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT
                playWhenReady = true
                
                addListener(object : androidx.media3.common.Player.Listener {
                    override fun onTracksChanged(tracks: androidx.media3.common.Tracks) {
                        for (group in tracks.groups) {
                            if (group.type == C.TRACK_TYPE_VIDEO && group.isSelected) {
                                val format = group.getTrackFormat(0)
                                val width = format.width
                                val height = format.height
                                val mime = format.sampleMimeType ?: "Unknown"
                                val bitrate = if (format.bitrate != androidx.media3.common.Format.NO_VALUE) 
                                    "${format.bitrate / 1000} kbps" else "Unknown"
                                val codec = format.codecs ?: "Unknown"
                                
                                debugInfo = """
                                    File: $videoName
                                    Resolution: ${width}x${height}
                                    Mime: $mime
                                    Codec: $codec
                                    Bitrate: $bitrate
                                    Decoder: Loading...
                                """.trimIndent()
                            }
                        }
                    }
                    
                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        debugInfo += "\nERROR: ${error.message}"
                    }
                })
                
                // Add AnalyticsListener for Decoder Name
                addAnalyticsListener(object : androidx.media3.exoplayer.analytics.AnalyticsListener {
                    override fun onVideoDecoderInitialized(
                        eventTime: androidx.media3.exoplayer.analytics.AnalyticsListener.EventTime,
                        decoderName: String,
                        initializationDurationMs: Long
                    ) {
                        super.onVideoDecoderInitialized(eventTime, decoderName, initializationDurationMs)
                        debugInfo = debugInfo.replace("Decoder: Loading...", "Decoder: $decoderName")
                    }
                })
            }
    }

    LaunchedEffect(videoName) {
        if (videoName == null) return@LaunchedEffect
        
        val moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
        val file = moviesDir.listFiles()?.find { file -> 
             if (videoName.contains(".")) {
                file.name.equals(videoName, ignoreCase = true)
            } else {
                (file.extension.equals("mp4", ignoreCase = true) || file.extension.equals("mkv", ignoreCase = true)) &&
                file.nameWithoutExtension.equals(videoName, ignoreCase = true)
            }
        }

        if (file != null) {
            val mediaItem = MediaItem.fromUri(file.absolutePath)
            exoPlayer.setMediaItem(mediaItem)
            exoPlayer.prepare()
        } else {
            debugInfo = "File not found: $videoName"
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            // Detach player from view to ensure Surface is released quickly
            // This can prevent SurfaceView from holding onto a dead codec
            exoPlayer.playWhenReady = false
            exoPlayer.stop()
            exoPlayer.release()
        }
    }

    Box(modifier = modifier) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exoPlayer
                    useController = true 
                    controllerAutoShow = true
                    // Keep SurfaceView but ensure Z-order is correct if needed
                    // surface_type is default (SURFACE_VIEW)
                    layoutParams = FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                }
            },
            onRelease = { view ->
                // Ensure player is nulled out when view is detached
                view.player = null
            }
        )
        
        // Debug Info Overlay
        Text(
            text = debugInfo,
            color = Color.Yellow,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier
                .align(Alignment.TopStart)
                .padding(16.dp)
                .background(Color.Black.copy(alpha = 0.6f))
                .padding(8.dp)
        )
    }
}
