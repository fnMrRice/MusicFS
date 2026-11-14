package io.musicfs.android.connection

import java.net.InetAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DiscoveryEndpointTest {
    private val attributes = mapOf("Api" to "1".toByteArray(), "scheme" to "https".toByteArray())
    private val ipv4 = InetAddress.getByName("192.0.2.10")
    private val ipv6 = InetAddress.getByName("2001:db8::1")

    @Test fun explicitOriginKeepsItsOwnPort() {
        val txt = attributes + ("origin" to "https://music.example.test:8443".toByteArray())
        val server = discoveredServer("Library", "._musicfs._tcp.local.", 9443, txt, listOf(ipv4), null)
        assertEquals(DiscoveredServer("Library", "https://music.example.test:8443"), server)
    }

    @Test fun missingOriginUsesTheResolvedPortAndBracketsIpv6() {
        assertEquals("https://[2001:db8::1]:9443", discoveredServer("Home", "_musicfs._tcp.", 9443,
            attributes, listOf(ipv6), null)?.address)
        assertEquals("https://192.0.2.10:9443", discoveredServer("Home", "_musicfs._tcp", 9443,
            attributes, listOf(ipv4), null)?.address)
        assertEquals("https://media.local:9443", discoveredServer("Home", "_musicfs._tcp", 9443,
            attributes, listOf(InetAddress.getByName("fe80::1")), "media")?.address)
    }

    @Test fun malformedOrForeignAdvertisementsNeverBecomeLoginTargets() {
        fun candidate(txt: Map<String, ByteArray?>, type: String = "_musicfs._tcp") =
            discoveredServer("Home", type, 443, txt, listOf(ipv4), null)
        assertNull(candidate(attributes, "_http._tcp."))
        assertNull(candidate(attributes - "Api"))
        assertNull(candidate(attributes + ("scheme" to "http".toByteArray())))
        for (origin in listOf("http://music.test", "https://u:p@music.test", "https://music.test/#token",
                "https://music.test/path", "https://music.test?token=1", "https://music.test/../")) {
            assertNull(candidate(attributes + ("origin" to origin.toByteArray())))
        }
    }
}
