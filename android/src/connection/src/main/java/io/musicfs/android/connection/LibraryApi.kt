package io.musicfs.android.connection

import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONException
import org.json.JSONObject

data class LibraryTrack(val id: String, val title: String)

internal data class TrackPage(
    val tracks: List<LibraryTrack>,
    val revision: String,
    val cursor: String?,
)

internal class ApiFailure(val status: Int, val code: String, message: String) : IOException(message)

internal class LibraryApi(val origin: HttpUrl) {
    private val cookies = SessionCookies(origin)
    private val client = newServerClient(cookies)
    private val authUrl = url("auth/session")
    private val originHeader = origin.toString().removeSuffix("/")

    private fun url(path: String) = origin.newBuilder().addPathSegments("api/v1/$path").build()

    suspend fun login(credential: String): ServerSession {
        require(credential.isNotBlank() && credential.length <= 4096 &&
            credential.all { it.code in 33..126 }
        ) { "Enter a valid MusicFS access credential." }
        val ready = json(Request.Builder().url(url("health/ready")).build())
        if (ready.optString("product") != "MusicFS" || ready.optString("apiVersion") != "1" ||
            ready.optString("instanceId").isBlank() || !ready.optBoolean("ready")
        ) throw IOException("This server is not a ready MusicFS v1 instance.")

        val login = Request.Builder().url(authUrl)
            .header("Origin", originHeader)
            .header("Authorization", "Bearer $credential")
            .post(ByteArray(0).toRequestBody())
            .build()
        val session = json(login)
        if (cookies.loadForRequest(authUrl).isEmpty() || session.optJSONObject("user")?.optString("id").isNullOrBlank()) {
            throw IOException("The server did not establish a MusicFS session.")
        }
        val csrf = session.getString("csrfToken")
        if (csrf.isBlank()) throw IOException("The session is missing its CSRF token.")
        return ServerSession(origin, client, csrf)
    }

    suspend fun page(cursor: String?): TrackPage {
        val target = url("source-tracks").newBuilder().addQueryParameter("limit", "50")
        if (cursor != null) target.addQueryParameter("cursor", cursor)
        val page = json(Request.Builder().url(target.build()).build())
        val items = page.getJSONArray("items")
        val tracks = List(items.length()) { index ->
            val row = items.getJSONObject(index)
            val title = (row.opt("title") as? String)?.takeIf { it.isNotBlank() } ?: row.getString("displayName")
            LibraryTrack(row.getString("sourceTrackId"), title)
        }
        val next = when (val value = page.get("nextCursor")) {
            JSONObject.NULL -> null
            is String -> value.takeIf { it.isNotEmpty() } ?: throw JSONException("Invalid library cursor")
            else -> throw JSONException("Invalid library cursor")
        }
        return TrackPage(tracks, page.getString("libraryRevision"), next)
    }

    // 先准备只限注销用途的请求，再清空本地会话，使播放器和并发查询立即丧失访问权。
    fun close(session: ServerSession?): Request? {
        val cookie = cookies.loadForRequest(authUrl).singleOrNull()
        val revoke = if (session != null && cookie != null) {
            Request.Builder().url(authUrl).delete()
                .header("Cookie", "${cookie.name}=${cookie.value}")
                .header("Origin", originHeader)
                .header("X-CSRF-Token", session.csrfToken)
                .build()
        } else null
        cookies.close()
        client.dispatcher.cancelAll()
        client.connectionPool.evictAll()
        return revoke
    }

    suspend fun revoke(request: Request) {
        try {
            client.fetch(request) { Unit }
        } catch (e: ApiFailure) {
            if (e.status != 401) throw e
        }
    }

    private suspend fun json(request: Request) = client.fetch(request) { response ->
        JSONObject(response.body?.string() ?: throw JSONException("Missing response body"))
    }
}

private suspend fun <T> OkHttpClient.fetch(request: Request, read: (Response) -> T): T =
    suspendCancellableCoroutine { result ->
        val call = newCall(request)
        call.timeout().timeout(20, TimeUnit.SECONDS)
        result.invokeOnCancellation { call.cancel() }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                result.resumeWithException(IOException("Unable to reach the MusicFS server.", e))
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val value = response.use {
                        if (!it.isSuccessful) {
                            val detail = runCatching {
                                JSONObject(it.peekBody(8192).string()).optJSONObject("error")
                            }.getOrNull()
                            val code = detail?.optString("code").orEmpty()
                            throw ApiFailure(it.code, code, detail?.optString("message")?.takeIf(String::isNotBlank)
                                ?: "MusicFS returned HTTP ${it.code}.")
                        }
                        read(it)
                    }
                    result.resume(value)
                } catch (e: Exception) {
                    result.resumeWithException(e)
                }
            }
        })
    }
