package io.musicfs.android.playback

import android.content.ComponentName
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.State
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import io.musicfs.android.connection.LibraryTrack

class MusicPlayback internal constructor(private val serviceStatus: State<String?>) {
    internal var controller: MediaController? by mutableStateOf(null)
    internal var connectionError: String? by mutableStateOf(null)
    val error: String? get() = connectionError ?: serviceStatus.value
    val ready: Boolean get() = controller != null
    var title: String? by mutableStateOf(null)
        internal set
    var isPlaying: Boolean by mutableStateOf(false)
        internal set

    fun play(track: LibraryTrack) {
        controller?.sendCustomCommand(playTrack, Bundle().apply {
            putString("id", track.id)
            putString("title", track.title)
        })
    }

    fun toggle() {
        controller?.let { if (it.playWhenReady) it.pause() else it.play() }
    }

    fun stop() {
        controller?.sendCustomCommand(stopTrack, Bundle.EMPTY)
    }

    internal fun sync(player: Player) {
        title = player.mediaMetadata.title?.toString()
        isPlaying = player.playWhenReady
    }
}

@androidx.annotation.OptIn(UnstableApi::class)
@Composable
fun rememberMusicPlayback(): MusicPlayback {
    val context = LocalContext.current.applicationContext
    val serviceStatus = playbackMessage.collectAsState()
    val state = remember(context, serviceStatus) { MusicPlayback(serviceStatus) }
    DisposableEffect(context, state) {
        var active = true
        val token = SessionToken(context, ComponentName(context, MusicPlaybackService::class.java))
        val listener = object : Player.Listener {
            override fun onEvents(player: Player, events: Player.Events) = state.sync(player)
        }
        val future = MediaController.Builder(context, token)
            .setListener(object : MediaController.Listener {
                override fun onDisconnected(controller: MediaController) {
                    if (active) {
                        state.controller = null
                        state.title = null
                        state.connectionError = "Playback service disconnected. Reopen the app."
                    }
                }
            }).buildAsync()
        future.addListener({
            if (active) {
                try {
                    val controller = future.get()
                    controller.addListener(listener)
                    state.controller = controller
                    state.sync(controller)
                } catch (error: Exception) {
                    state.connectionError = "Could not connect to the playback service."
                }
            }
        }, { task -> Handler(Looper.getMainLooper()).post(task) })
        onDispose {
            active = false
            state.controller?.removeListener(listener)
            MediaController.releaseFuture(future)
        }
    }
    return state
}
