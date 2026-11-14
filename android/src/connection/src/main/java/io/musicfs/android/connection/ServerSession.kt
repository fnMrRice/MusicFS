package io.musicfs.android.connection

import java.io.IOException
import java.util.concurrent.TimeUnit
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient

data class ServerSession(
    val origin: HttpUrl,
    val client: OkHttpClient,
    val csrfToken: String,
) {
    override fun toString() = "ServerSession(origin=$origin)"
}

internal fun serverOrigin(address: String): HttpUrl {
    val url = address.trim().toHttpUrlOrNull()
    require(url != null && url.isHttps && url.username.isEmpty() && url.password.isEmpty() &&
        url.query == null && url.fragment == null && url.encodedPath.trimEnd('/') in setOf("", "/api/v1")
    ) { "Enter an HTTPS MusicFS server address." }
    return url.newBuilder().encodedPath("/").build()
}

// 同一登录会话只接受来自目标实例的会话 Cookie，注销时立即阻止旧请求恢复凭据。
internal class SessionCookies(private val origin: HttpUrl) : CookieJar {
    private var cookie: Cookie? = null
    private var closed = false

    fun accepts(url: HttpUrl): Boolean =
        url.scheme == origin.scheme && url.host == origin.host && url.port == origin.port

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (closed || !accepts(url)) return
        val updated = cookies.lastOrNull {
            it.name == "musicfs_session" && it.domain == origin.host && it.path == "/api/v1"
        } ?: return
        cookie = updated.takeIf { it.expiresAt > System.currentTimeMillis() }
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (closed || !accepts(url)) return emptyList()
        return listOfNotNull(cookie?.takeIf { it.expiresAt > System.currentTimeMillis() && it.matches(url) })
    }

    @Synchronized
    fun close() {
        closed = true
        cookie = null
    }
}

internal fun newServerClient(cookies: SessionCookies): OkHttpClient =
    OkHttpClient.Builder()
        .cookieJar(cookies)
        .followRedirects(false)
        .followSslRedirects(false)
        .retryOnConnectionFailure(false)
        .connectTimeout(10, TimeUnit.SECONDS)
        .addInterceptor { chain ->
            if (!cookies.accepts(chain.request().url)) throw IOException("Unexpected server origin.")
            chain.proceed(chain.request())
        }
        .build()
