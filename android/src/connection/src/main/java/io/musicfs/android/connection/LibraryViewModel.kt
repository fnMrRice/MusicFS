package io.musicfs.android.connection

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONException

data class LibraryState(
    val connected: Boolean = false,
    val busy: Boolean = false,
    val address: String = "",
    val tracks: List<LibraryTrack> = emptyList(),
    val error: String? = null,
    val hasMore: Boolean = false,
)

// 状态更新由主线程串行执行，活动重建不影响设备上的播放服务或登录会话。
object MusicConnection {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val active = MutableStateFlow<ServerSession?>(null)
    val sessions = active.asStateFlow()
    private val library = MutableStateFlow(LibraryState())
    internal val state = library.asStateFlow()

    private var api: LibraryApi? = null
    private var request: Job? = null
    private var next: String? = null
    private var revision: String? = null

    fun session(): ServerSession? = active.value

    internal fun connect(address: String, credential: String) {
        reset()
        val origin = try {
            serverOrigin(address)
        } catch (e: IllegalArgumentException) {
            library.value = LibraryState(error = e.message)
            return
        }
        val target = LibraryApi(origin)
        api = target
        library.value = LibraryState(address = origin.toString().removeSuffix("/"), busy = true)
        request = scope.launch {
            try {
                val session = target.login(credential)
                active.value = session
                library.value = library.value.copy(connected = true)
                readPage(target, null)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    internal fun page(append: Boolean) {
        val target = api ?: return
        if (active.value == null || library.value.busy) return
        val cursor = if (append) next ?: return else null
        library.value = library.value.copy(busy = true, error = null)
        request = scope.launch {
            try {
                readPage(target, cursor)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                fail(e)
            }
        }
    }

    private suspend fun readPage(target: LibraryApi, cursor: String?) {
        var append = cursor != null
        val page = try {
            val result = target.page(cursor)
            if (append && result.revision != revision) throw ApiFailure(410, "CURSOR_EXPIRED", "Library has changed.")
            result
        } catch (e: ApiFailure) {
            if (!append || e.code != "CURSOR_EXPIRED") throw e
            // 游标失效只允许重读首页，避免混合不同修订的列表。
            append = false
            revision = null
            next = null
            library.value = library.value.copy(tracks = emptyList(), hasMore = false)
            target.page(null)
        }
        val tracks = if (append) library.value.tracks + page.tracks else page.tracks
        revision = page.revision
        next = page.cursor
        library.value = library.value.copy(busy = false, tracks = tracks, hasMore = next != null, error = null)
    }

    private fun fail(e: Exception) {
        val message = when (e) {
            is JSONException -> "Invalid response from the MusicFS server."
            else -> e.message ?: "Unable to complete the MusicFS request."
        }
        if (active.value == null || e is ApiFailure && e.status == 401) reset()
        library.value = library.value.copy(busy = false, error = message)
    }

    internal fun disconnect() = reset()

    private fun reset() {
        request?.cancel()
        request = null
        val previous = api
        val revoke = previous?.close(active.value)
        api = null
        active.value = null
        next = null
        revision = null
        val cleared = LibraryState(address = library.value.address)
        library.value = cleared
        if (previous != null && revoke != null) scope.launch {
            try {
                previous.revoke(revoke)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                if (library.value === cleared) {
                    library.value = cleared.copy(error = "Signed out locally. Server sign-out could not be confirmed.")
                }
            }
        }
    }
}

class LibraryViewModel : ViewModel() {
    val state: StateFlow<LibraryState> = MusicConnection.state
    fun connect(address: String, credential: String) = MusicConnection.connect(address, credential)
    fun loadMore() = MusicConnection.page(append = true)
    fun refresh() = MusicConnection.page(append = false)
    fun disconnect() = MusicConnection.disconnect()
}
