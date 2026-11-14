package io.musicfs.android.wear

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.rotary.onRotaryScrollEvent
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModelProvider
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import io.musicfs.android.connection.LibraryViewModel
import io.musicfs.android.playback.rememberMusicPlayback
import kotlinx.coroutines.launch

class WearActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val library = ViewModelProvider(this)[LibraryViewModel::class.java]
        setContent { MaterialTheme { WatchLibrary(library) } }
    }
}

@Composable
private fun WatchLibrary(library: LibraryViewModel) {
    val state by library.state.collectAsState()
    val playback = rememberMusicPlayback()
    val list = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val focus = remember { FocusRequester() }
    LazyColumn(
        state = list,
        modifier = Modifier.fillMaxSize().background(Color.Black)
            .onRotaryScrollEvent { event ->
                scope.launch { list.scrollBy(event.verticalScrollPixels) }
                true
            }.focusRequester(focus).focusable(),
        contentPadding = PaddingValues(horizontal = 26.dp, vertical = 32.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item { Text("MusicFS", style = MaterialTheme.typography.title3) }
        if (!state.connected) {
            item { WatchLogin(state, list, library::connect) }
        } else {
            playback.title?.let { title ->
                item {
                    WatchAction(
                        text = if (playback.isPlaying) "Pause" else "Resume",
                        detail = title,
                        enabled = playback.ready,
                        action = { playback.toggle() },
                    )
                }
            }
            playback.error?.let { error -> item { Text(error, color = MaterialTheme.colors.error) } }
            state.error?.let { error -> item { Text(error, color = MaterialTheme.colors.error) } }
            item { Text("Tracks", style = MaterialTheme.typography.caption1) }
            if (state.tracks.isEmpty()) {
                item { Text(if (state.busy) "Loading…" else "No tracks available.") }
            }
            items(state.tracks, key = { track -> track.id }) { track ->
                WatchAction(track.title, detail = "Play", enabled = playback.ready) { playback.play(track) }
            }
            if (state.hasMore) {
                item { WatchAction("Load more", enabled = !state.busy, action = library::loadMore) }
            }
            item { WatchAction("Refresh", enabled = !state.busy, action = library::refresh) }
            item {
                WatchAction("Disconnect") {
                    playback.stop()
                    library.disconnect()
                }
            }
        }
    }
    LaunchedEffect(state.connected) {
        list.scrollToItem(0)
        focus.requestFocus()
    }
}

@Composable
internal fun WatchAction(text: String, detail: String? = null, enabled: Boolean = true, action: () -> Unit) {
    Chip(
        onClick = action,
        label = { Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        secondaryLabel = if (detail == null) null else {
            { Text(detail, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        },
        enabled = enabled,
        modifier = Modifier.fillMaxWidth(),
    )
}
