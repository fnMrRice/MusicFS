package io.musicfs.android.connection

import java.net.Inet4Address
import java.net.InetAddress
import java.net.URI
import java.util.Locale
import okhttp3.HttpUrl

data class DiscoveredServer(val name: String, val address: String)
data class DiscoveryState(val servers: List<DiscoveredServer> = emptyList(), val error: String? = null)

internal const val MUSICFS_SERVICE = "_musicfs._tcp"

internal fun isMusicService(type: String?) =
    type?.lowercase(Locale.ROOT)?.trim('.')?.removeSuffix(".local") == MUSICFS_SERVICE

internal fun discoveredServer(
    name: String, type: String?, port: Int, attributes: Map<String, ByteArray?>,
    addresses: List<InetAddress>, hostname: String?,
): DiscoveredServer? {
    if (!isMusicService(type) || name.isBlank() || name.any(Char::isISOControl) || port !in 1..65535) return null
    val txt = attributes.mapKeys { it.key.lowercase(Locale.ROOT) }
    fun value(key: String) = txt[key]?.toString(Charsets.UTF_8)
    if (value("api") != "1" || value("scheme") != "https") return null
    val url = if ("origin" in txt) {
        // TXT 仅提供候选；解析或校验失败时不能换成另一个用户没有选择的来源。
        val raw = value("origin") ?: return null
        runCatching {
            val uri = URI(raw)
            require(uri.isAbsolute && uri.rawUserInfo == null && uri.rawQuery == null &&
                uri.rawFragment == null && uri.rawPath.orEmpty() in setOf("", "/"))
            serverOrigin(raw)
        }.getOrNull()
    } else {
        // 链路本地 IPv6 的作用域无法作为 OkHttp URL 的一部分保留，使用实际 SRV 主机名解析。
        val host = hostname?.removeSuffix(".")?.removeSuffix(".local")
            ?.takeIf { it.matches(Regex("[A-Za-z0-9-]+")) }?.let { "$it.local" } ?: addresses.asSequence()
            .filterNot { it.isAnyLocalAddress || it.isMulticastAddress || it !is Inet4Address && it.isLinkLocalAddress }
            .sortedBy { it !is Inet4Address }
            .firstOrNull()?.hostAddress ?: return null
        runCatching { HttpUrl.Builder().scheme("https").host(host).port(port).build() }.getOrNull()
    } ?: return null
    return DiscoveredServer(name, url.toString().removeSuffix("/"))
}
