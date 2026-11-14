package io.musicfs.android.playback

import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Bundle
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import io.musicfs.android.connection.LibraryTrack
import io.musicfs.android.connection.MusicConnection
import io.musicfs.android.connection.ServerSession
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal val playTrack = SessionCommand("io.musicfs.PLAY_TRACK", Bundle.EMPTY)
internal val stopTrack = SessionCommand("io.musicfs.STOP_TRACK", Bundle.EMPTY)
internal val playbackMessage = MutableStateFlow<String?>(null)

@UnstableApi
class MusicPlaybackService : MediaSessionService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private lateinit var player: ExoPlayer
    private lateinit var mediaSession: MediaSession
    private var stream: StreamLease? = null
    private var owner: ServerSession? = null
    private var generation = 0L
    private var pending: LibraryTrack? = null
    private var preparing = false
    private val watch by lazy { packageManager.hasSystemFeature(PackageManager.FEATURE_WATCH) }

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this).setSuppressPlaybackOnUnsuitableOutput(watch).build().apply {
            setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
            setHandleAudioBecomingNoisy(true)
            setWakeMode(C.WAKE_MODE_LOCAL)
            addListener(object : Player.Listener {
                override fun onPlayerError(error: PlaybackException) {
                    playbackMessage.value = "Audio playback failed. Select the track to retry."
                    reset()
                }
                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED) reset()
                }
            })
        }
        mediaSession = MediaSession.Builder(this, player).setCallback(Commands()).build()
        scope.launch {
            MusicConnection.sessions.collect { session ->
                if (owner !== session) {
                    playbackMessage.value = null
                    reset()
                }
            }
        }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo) = mediaSession

    private inner class Commands : MediaSession.Callback {
        override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
            val own = controller.uid == applicationInfo.uid
            if (!own && !controller.isTrusted) return MediaSession.ConnectionResult.reject()
            val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
            if (own) commands.add(playTrack).add(stopTrack)
            val playerCommands = Player.Commands.Builder().addAll(
                Player.COMMAND_PLAY_PAUSE, Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
                Player.COMMAND_GET_METADATA, Player.COMMAND_GET_TIMELINE, Player.COMMAND_GET_AUDIO_ATTRIBUTES
            ).build()
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(commands.build()).setAvailablePlayerCommands(playerCommands).build()
        }

        override fun onCustomCommand(session: MediaSession, controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand, args: Bundle): ListenableFuture<SessionResult> {
            if (controller.uid != applicationInfo.uid) return result(SessionError.ERROR_PERMISSION_DENIED)
            when (customCommand) {
                playTrack -> {
                    val id = args.getString("id") ?: return result(SessionError.ERROR_BAD_VALUE)
                    val title = args.getString("title") ?: return result(SessionError.ERROR_BAD_VALUE)
                    select(LibraryTrack(id, title))
                }
                stopTrack -> reset()
                else -> return result(SessionError.ERROR_NOT_SUPPORTED)
            }
            return result(SessionResult.RESULT_SUCCESS)
        }
    }

    private fun result(code: Int) = Futures.immediateFuture(SessionResult(code))

    private fun hasWatchOutput(): Boolean {
        if (!watch) return true
        val outputs = getSystemService(AudioManager::class.java).getDevices(AudioManager.GET_DEVICES_OUTPUTS)
        return outputs.any { it.type in setOf(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
            AudioDeviceInfo.TYPE_BLE_HEADSET, AudioDeviceInfo.TYPE_BLE_SPEAKER, AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
            AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_USB_HEADSET) }
    }

    private fun select(track: LibraryTrack) {
        reset()
        val session = MusicConnection.session() ?: return
        if (!hasWatchOutput()) {
            playbackMessage.value = "Connect headphones or a speaker to the watch."
            return
        }
        owner = session
        playbackMessage.value = null
        pending = track
        if (preparing) return
        preparing = true
        scope.launch {
            try {
                while (true) {
                    val next = pending ?: break
                    val currentOwner = owner ?: break
                    val revision = generation
                    pending = null
                    prepare(currentOwner, next, revision)
                }
            } finally {
                preparing = false
            }
        }
    }

    private suspend fun prepare(session: ServerSession, track: LibraryTrack, revision: Long) {
        try {
            // 已发送的创建请求需要拿到结果，才能在快速切歌或服务销毁时释放迟到的会话。
            withContext(NonCancellable) {
                val lease = createStream(session, track)
                if (revision != generation || MusicConnection.session() !== session || !hasWatchOutput()) {
                    discard(lease)
                    return@withContext
                }
                stream = lease
                val media = MediaItem.Builder().setMediaId(track.id).setUri(lease.url.toString())
                    .setMimeType(lease.mime)
                    .setMediaMetadata(MediaMetadata.Builder().setTitle(track.title).build()).build()
                val factory = OkHttpDataSource.Factory(session.client)
                player.setMediaSource(ProgressiveMediaSource.Factory(factory).createMediaSource(media))
                player.prepare()
                player.play()
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            if (revision == generation) {
                playbackMessage.value = error.message ?: "Could not prepare playback."
                reset()
            }
        }
    }

    private fun reset() {
        generation++
        pending = null
        owner = null
        player.stop()
        player.clearMediaItems()
        stream?.let { lease -> scope.launch(NonCancellable) { discard(lease) } }
        stream = null
    }

    private suspend fun discard(lease: StreamLease) {
        // 断线或登出可能让停止回执丢失，Server 仍按会话到期或注销回收。
        runCatching { stopStream(lease.session, lease.id) }
    }

    override fun onDestroy() {
        reset()
        scope.cancel()
        mediaSession.release()
        player.release()
        super.onDestroy()
    }
}
