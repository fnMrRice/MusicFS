package io.musicfs.android.main

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import io.musicfs.android.connection.LibraryViewModel
import io.musicfs.android.playback.rememberMusicPlayback

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showMusicLibrary(television = false)
    }
}

class TvActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showMusicLibrary(television = true)
    }
}

private fun ComponentActivity.showMusicLibrary(television: Boolean) {
    val library = ViewModelProvider(this)[LibraryViewModel::class.java]
    setContent {
        MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFF8AE8C9))) {
            Surface(modifier = Modifier.fillMaxSize().safeDrawingPadding()) {
                MusicLibrary(television, library)
            }
        }
    }
}

@Composable
private fun MusicLibrary(television: Boolean, library: LibraryViewModel) {
    val state by library.state.collectAsState()
    val playback = rememberMusicPlayback()
    if (!state.connected) {
        ConnectionForm(state, television, library::connect)
        return
    }
    BoxWithConstraints(modifier = Modifier.fillMaxSize()) {
        LibraryScreen(
            state = state,
            television = television,
            wide = television || maxWidth >= 600.dp,
            playbackTitle = playback.title,
            isPlaying = playback.isPlaying,
            playbackError = playback.error,
            ready = playback.ready,
            onPlay = { playback.play(it) },
            onToggle = { playback.toggle() },
            onRefresh = library::refresh,
            onMore = library::loadMore,
            onDisconnect = {
                playback.stop()
                library.disconnect()
            },
        )
    }
}
