package io.musicfs.android.connection

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.net.ServerSocket
import java.util.UUID
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DiscoveryInstrumentedTest {
    // 同一临时设备使用系统 DNS-SD 注册一个实例，然后验证发现、解析及撤销。
    @Test
    fun advertisedEndpointAppearsAndDisappears() = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val manager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
        val registered = CompletableDeferred<String>()
        val listener = object : NsdManager.RegistrationListener {
            override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) {
                registered.completeExceptionally(IllegalStateException("NSD registration failed: $code"))
            }
            override fun onServiceRegistered(info: NsdServiceInfo) { registered.complete(info.serviceName) }
            override fun onServiceUnregistered(info: NsdServiceInfo) = Unit
            override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) = Unit
        }
        ServerSocket(0).use { socket ->
            val origin = "https://discovery-test.local:${socket.localPort}"
            val info = NsdServiceInfo().apply {
                serviceName = "MusicFS test " + UUID.randomUUID().toString().take(8)
                serviceType = "_musicfs._tcp."
                port = socket.localPort
                setAttribute("api", "1")
                setAttribute("scheme", "https")
                setAttribute("origin", origin)
            }
            val updates = Channel<DiscoveryState>(Channel.UNLIMITED)
            val browse = launch(Dispatchers.Default) { discoverServers(context).collect { updates.send(it) } }
            var registrationActive = false
            try {
                manager.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
                registrationActive = true
                withTimeout(30_000) {
                    val name = registered.await()
                    var server = updates.receive().servers.firstOrNull { it.name == name }
                    while (server == null) server = updates.receive().servers.firstOrNull { it.name == name }
                    assertEquals(origin, server.address)
                    manager.unregisterService(listener)
                    registrationActive = false
                    while (updates.receive().servers.any { it.name == name }) Unit
                }
            } finally {
                if (registrationActive) runCatching { manager.unregisterService(listener) }
                browse.cancel()
            }
        }
    }
}
