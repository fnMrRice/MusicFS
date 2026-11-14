package io.musicfs.android.playback

import android.media.MediaCodecList
import io.musicfs.android.connection.LibraryTrack
import io.musicfs.android.connection.ServerSession
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.HttpUrl
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject

internal data class StreamLease(
    val session: ServerSession,
    val id: String,
    val url: HttpUrl,
    val mime: String,
)

// 只上报本播放器支持的容器和系统可用的解码器。PCM WAV 由 Media3 直接处理。
private fun formats(): JSONArray {
    val decoders = MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos
        .filterNot { it.isEncoder }.flatMap { it.supportedTypes.toList() }.toSet()
    val mimes = buildList {
        add("audio/wav")
        if ("audio/mpeg" in decoders) add("audio/mpeg")
        if ("audio/flac" in decoders) add("audio/flac")
        if ("audio/opus" in decoders) add("audio/webm; codecs=\"opus\"")
    }
    return JSONArray(mimes.map { JSONObject().put("mime", it).put("canPlay", "probably") })
}

internal suspend fun createStream(session: ServerSession, track: LibraryTrack): StreamLease {
    val body = JSONObject().put("sourceTrackId", track.id)
        .put("capabilities", JSONObject().put("nativeHttp", true).put("formats", formats()))
        .put("preferences", JSONObject().put("dspExecution", "server"))
    val description = command(session, "POST", "/playback/sessions", body)
    val id = description.getString("sessionId")
    try {
        val profile = description.getJSONObject("outputProfile")
        val path = description.getString("streamUrl")
        val attempt = description.getString("attemptId")
        require(profile.getString("transport") == "nativeHttp") { "Unsupported playback transport." }
        val expected = session.origin.newBuilder().addPathSegments("api/v1/playback/sessions")
            .addPathSegment(id).addPathSegment("attempts").addPathSegment(attempt).addPathSegment("stream").build()
        require(path == expected.encodedPath) { "Unexpected audio stream address." }
        return StreamLease(session, id, expected, profile.getString("mime"))
    } catch (error: Exception) {
        stopStream(session, id)
        throw error
    }
}

internal suspend fun stopStream(session: ServerSession, id: String) {
    command(session, "DELETE", "/playback/sessions/$id", null)
}

// 每次操作使用一个短时控制连接。断线后结果可能未知，绝不自动重放修改请求。
private suspend fun command(session: ServerSession, method: String, path: String, body: JSONObject?): JSONObject {
    val id = UUID.randomUUID().toString()
    val message = JSONObject().put("type", "request").put("id", id).put("method", method).put("path", path)
    if (body != null) message.put("body", body).put("idempotencyKey", UUID.randomUUID().toString())
    val result = CompletableDeferred<JSONObject>()
    val request = Request.Builder().url(session.origin.newBuilder().addPathSegments("api/v1/control").build())
        .header("Origin", session.origin.toString().removeSuffix("/"))
        .header("Sec-WebSocket-Protocol", "musicfs.control.v1").build()
    val socket = session.client.newWebSocket(request, object : WebSocketListener() {
        private var sent = false

        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send(JSONObject().put("type", "auth").put("csrfToken", session.csrfToken).toString())
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            try {
                val reply = JSONObject(text)
                when (reply.getString("type")) {
                    "ready" -> if (!sent) {
                        sent = true
                        if (!webSocket.send(message.toString())) throw IOException("Playback connection closed.")
                    }
                    "response" -> if (reply.getString("id") == id) {
                        val payload = reply.optJSONObject("body") ?: JSONObject()
                        if (reply.getInt("status") !in 200..299) {
                            val error = payload.optJSONObject("error")
                            throw IOException(error?.optString("message")?.takeIf { it.isNotBlank() }
                                ?: "Playback request failed.")
                        }
                        result.complete(payload)
                    }
                }
            } catch (error: Exception) {
                result.completeExceptionally(error)
            }
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            result.completeExceptionally(IOException("Playback connection failed."))
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            result.completeExceptionally(IOException("Playback connection closed."))
            webSocket.close(1000, null)
        }
    })
    return try {
        withTimeoutOrNull(22_000) { result.await() } ?: throw IOException("Playback request timed out.")
    } finally {
        if (result.isCompleted) socket.close(1000, null) else socket.cancel()
    }
}
