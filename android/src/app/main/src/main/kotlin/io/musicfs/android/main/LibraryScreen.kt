package io.musicfs.android.main

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import io.musicfs.android.connection.LibraryState
import io.musicfs.android.connection.LibraryTrack

internal fun Modifier.tvFocus(television: Boolean): Modifier {
    if (!television) return this
    return composed {
        var focused by remember { mutableStateOf(false) }
        val outline = if (focused) {
            Modifier.border(3.dp, MaterialTheme.colorScheme.primary, RoundedCornerShape(24.dp))
        } else {
            Modifier
        }
        onFocusChanged { focused = it.hasFocus }.then(outline)
    }
}

@Composable
internal fun LibraryScreen(
    state: LibraryState,
    television: Boolean,
    wide: Boolean,
    playbackTitle: String?,
    isPlaying: Boolean,
    playbackError: String?,
    ready: Boolean,
    onPlay: (LibraryTrack) -> Unit,
    onToggle: () -> Unit,
    onRefresh: () -> Unit,
    onMore: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val initialFocus = remember { FocusRequester() }
    var initialFocusSet by remember { mutableStateOf(false) }
    // 分屏或旋转会替换面板容器，滚动位置由外层持有。
    val listState = rememberLazyListState()
    val libraryPane: @Composable (Modifier) -> Unit = { modifier ->
        LazyColumn(
            modifier = modifier,
            state = listState,
            contentPadding = PaddingValues(6.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item { Text("Tracks", style = MaterialTheme.typography.headlineMedium) }
            item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = onRefresh,
                        enabled = !state.busy,
                        modifier = Modifier.focusRequester(initialFocus).tvFocus(television),
                    ) { Text("Refresh") }
                    OutlinedButton(
                        onClick = onDisconnect,
                        modifier = Modifier.tvFocus(television),
                    ) { Text("Disconnect") }
                }
                LaunchedEffect(state.busy) {
                    if (television && !initialFocusSet && !state.busy) {
                        initialFocus.requestFocus()
                        initialFocusSet = true
                    }
                }
            }
            state.error?.let { error -> item { Text(error, color = MaterialTheme.colorScheme.error) } }
            if (state.tracks.isEmpty()) {
                item { Text(if (state.busy) "Loading tracks…" else "No tracks available.") }
            }
            items(state.tracks, key = { track -> track.id }) { track ->
                OutlinedButton(
                    onClick = { onPlay(track) },
                    modifier = Modifier.fillMaxWidth().tvFocus(television),
                    enabled = ready,
                ) {
                    Text(track.title, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Text("Play", modifier = Modifier.padding(start = 12.dp))
                }
            }
            if (state.hasMore) {
                item {
                    Button(onMore, enabled = !state.busy, modifier = Modifier.tvFocus(television)) {
                        Text(if (state.busy) "Loading…" else "Load more tracks")
                    }
                }
            }
        }
    }
    val playerPane: @Composable (Modifier) -> Unit = { modifier ->
        Column(modifier, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Now playing", style = MaterialTheme.typography.titleLarge)
            Text(
                playbackTitle ?: "Select a track.",
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            if (playbackTitle != null) {
                Button(onToggle, enabled = ready, modifier = Modifier.tvFocus(television)) {
                    Text(if (isPlaying) "Pause" else "Resume")
                }
            }
            playbackError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
    val inset = if (television) 32.dp else 16.dp
    if (wide) {
        Row(Modifier.fillMaxSize().padding(inset), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
            libraryPane(Modifier.weight(3f))
            playerPane(Modifier.weight(2f).verticalScroll(rememberScrollState()).padding(6.dp))
        }
    } else {
        Column(Modifier.fillMaxSize().padding(inset), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            libraryPane(Modifier.weight(1f))
            HorizontalDivider()
            playerPane(Modifier.fillMaxWidth())
        }
    }
}
