package com.vidhanth.fastvideo

import android.content.Context
import android.os.Environment
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.annotation.OptIn
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
import androidx.media3.ui.PlayerView
import java.io.File

@OptIn(UnstableApi::class)
@Composable
fun VideoPlayer(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    
    // 1. Configure Buffer for 4K High Bitrate
    val loadControl = DefaultLoadControl.Builder()
        .setBufferDurationsMs(
            30_000, // Increased Min buffer (was 15s)
            50_000, 
            1_500,  // Lower start buffer for quicker resume
            2_000   // Lower rebuffer threshold
        )
        .setPrioritizeTimeOverSizeThresholds(true)
        .build()

    val exoPlayer = remember {
        ExoPlayer.Builder(context)
            .setLoadControl(loadControl)
            .setSeekParameters(androidx.media3.exoplayer.SeekParameters.CLOSEST_SYNC) // Critical for fast/stable seeking
            .build()
            .apply {
                trackSelectionParameters = trackSelectionParameters
                    .buildUpon()
                    .build()
                
                videoScalingMode = C.VIDEO_SCALING_MODE_SCALE_TO_FIT
                playWhenReady = true
            }
    }

    // 2. Load Video Files
    LaunchedEffect(Unit) {
        val moviesDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
        val files = moviesDir.listFiles { file -> 
            file.extension.equals("mp4", ignoreCase = true) || 
            file.extension.equals("mkv", ignoreCase = true) 
        }?.toList() ?: emptyList()

        if (files.isNotEmpty()) {
            val mediaItem = MediaItem.fromUri(files[0].absolutePath)
            exoPlayer.setMediaItem(mediaItem)
            exoPlayer.prepare()
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            exoPlayer.release()
        }
    }

    AndroidView(
        modifier = modifier.fillMaxSize(),
        factory = { ctx ->
            PlayerView(ctx).apply {
                player = exoPlayer
                useController = true 
                controllerAutoShow = true
                layoutParams = FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            }
        }
    )
}
