package com.vidhanth.fastvideo

import android.Manifest
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import com.vidhanth.fastvideo.ui.theme.FastVideoTheme

class MainActivity : ComponentActivity() {

    private var hasPermission by mutableStateOf(false)

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        hasPermission = isGranted
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
             permissionLauncher.launch(Manifest.permission.READ_EXTERNAL_STORAGE)
        } else {
             permissionLauncher.launch(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        
        setContent {
            FastVideoTheme {
                Box(modifier = Modifier.fillMaxSize()) {
                    VideoPlayer()
                }
            }
        }
    }
}