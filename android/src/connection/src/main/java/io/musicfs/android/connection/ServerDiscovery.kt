package io.musicfs.android.connection

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.nsd.DiscoveryRequest
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ext.SdkExtensions
import androidx.annotation.RequiresApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn

fun discoveryPermission(context: Context): String? {
    if (Build.VERSION.SDK_INT < 37 || context.applicationInfo.targetSdkVersion < 37) return null
    return Manifest.permission.ACCESS_LOCAL_NETWORK.takeIf {
        context.checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED
    }
}

// 每个前台订阅独立浏览；最后一次取消也覆盖启动尚未回调的情况。
fun discoverServers(context: Context): Flow<DiscoveryState> = callbackFlow {
    val app = context.applicationContext
    val nsd = app.getSystemService(NsdManager::class.java)
    if (nsd == null || discoveryPermission(app) != null) {
        trySend(DiscoveryState(error = if (nsd == null) "Local discovery is unavailable."
            else "Local network permission is required."))
        close()
        return@callbackFlow
    }
    val requiresLock = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
        SdkExtensions.getExtensionVersion(Build.VERSION_CODES.TIRAMISU) < 7
    val lock = if (requiresLock)
        app.getSystemService(WifiManager::class.java)?.createMulticastLock("MusicFS discovery") else null
    val entries = linkedMapOf<ServiceKey, DiscoveredServer>()
    fun publish() {
        trySend(DiscoveryState(entries.values.distinctBy { it.address }
            .sortedWith(compareBy<DiscoveredServer> { it.name.lowercase() }.thenBy { it.address })))
    }
    val onUpdate: (ServiceKey, NsdServiceInfo?) -> Unit = { key, info ->
        val server = info?.toServer()
        if (server == null) entries.remove(key) else entries[key] = server
        publish()
    }
    fun fail(message: String) {
        trySend(DiscoveryState(error = message))
        close()
    }
    var stop: (() -> Unit)? = null
    try {
        lock?.acquire()
        publish()
        stop = if (Build.VERSION.SDK_INT >= 37) browseResolved(nsd, app, onUpdate, ::fail)
            else LegacyNsdBrowse(nsd, onUpdate, ::fail).start()
        awaitClose()
    } catch (_: SecurityException) {
        fail("Local network access was denied.")
    } catch (_: IllegalArgumentException) {
        fail("Local discovery could not start.")
    } finally {
        stop?.invoke()
        if (lock?.isHeld == true) lock.release()
    }
}.flowOn(Dispatchers.Main.immediate).conflate().distinctUntilChanged()

internal data class ServiceKey(val name: String, val network: Long?)
internal fun NsdServiceInfo.key() =
    ServiceKey(serviceName, if (Build.VERSION.SDK_INT >= 33) network?.networkHandle else null)

@Suppress("DEPRECATION")
private fun NsdServiceInfo.toServer() = discoveredServer(serviceName, serviceType, port, attributes,
    if (Build.VERSION.SDK_INT >= 34) hostAddresses else listOfNotNull(host),
    if (Build.VERSION.SDK_INT >= 36) hostname else null)

@RequiresApi(37)
private fun browseResolved(
    nsd: NsdManager, context: Context, update: (ServiceKey, NsdServiceInfo?) -> Unit, fail: (String) -> Unit,
): () -> Unit {
    val callback = object : NsdManager.ServiceInfoCallback {
        override fun onServiceUpdated(info: NsdServiceInfo) = update(info.key(), info)
        override fun onServiceLost(info: NsdServiceInfo) = update(info.key(), null)
        override fun onServiceLost() = Unit
        override fun onServiceInfoCallbackRegistrationFailed(code: Int) = fail("Local discovery failed ($code).")
        override fun onServiceInfoCallbackUnregistered() = Unit
    }
    val request = DiscoveryRequest.Builder(MUSICFS_SERVICE).setFlags(DiscoveryRequest.FLAG_NO_PICKER).build()
    nsd.registerServiceInfoCallback(request, context.mainExecutor, callback)
    return { runCatching { nsd.unregisterServiceInfoCallback(callback) } }
}

// 旧 NSD 在自己的回调线程上通知，每个事件切回主线程后再修改批次和解析队列。
internal class LegacyNsdBrowse(
    private val nsd: NsdManager,
    private val update: (ServiceKey, NsdServiceInfo?) -> Unit,
    private val fail: (String) -> Unit,
) : NsdManager.DiscoveryListener {
    private val handler = Handler(Looper.getMainLooper())
    private val entries = mutableMapOf<ServiceKey, NsdServiceInfo>()
    private data class Resolution(val info: NsdServiceInfo, val attempt: Int = 0)
    private val pending = ArrayDeque<Resolution>()
    private val watching = mutableMapOf<ServiceKey, () -> Unit>()
    private var resolving: NsdManager.ResolveListener? = null
    private var closed = false

    fun start(): () -> Unit {
        nsd.discoverServices(MUSICFS_SERVICE, NsdManager.PROTOCOL_DNS_SD, this)
        return {
            closed = true
            runCatching { nsd.stopServiceDiscovery(this) }
            if (Build.VERSION.SDK_INT >= 34) resolving?.let { runCatching { nsd.stopServiceResolution(it) } }
            resolving = null
            watching.values.forEach { it() }
            pending.clear()
            entries.clear()
            handler.removeCallbacksAndMessages(null)
        }
    }

    private fun onMain(block: () -> Unit) {
        handler.post { if (!closed) block() }
    }

    override fun onDiscoveryStarted(type: String) = Unit
    override fun onDiscoveryStopped(type: String) = Unit
    override fun onStartDiscoveryFailed(type: String, code: Int) = onMain { fail("Local discovery failed ($code).") }
    override fun onStopDiscoveryFailed(type: String, code: Int) = Unit

    override fun onServiceFound(info: NsdServiceInfo) = onMain {
        if (!isMusicService(info.serviceType)) return@onMain
        val key = info.key()
        if (entries.putIfAbsent(key, info) != null) return@onMain
        if (Build.VERSION.SDK_INT >= 34) watch(info)
        else {
            pending.addLast(Resolution(info))
            next()
        }
    }

    override fun onServiceLost(info: NsdServiceInfo) = onMain {
        val key = info.key()
        entries.remove(key)
        watching.remove(key)?.invoke()
        update(key, null)
    }

    @RequiresApi(34)
    private fun watch(info: NsdServiceInfo) {
        val key = info.key()
        val listener = object : NsdManager.ServiceInfoCallback {
            override fun onServiceUpdated(resolved: NsdServiceInfo) {
                if (!closed && entries[key] === info) update(key, resolved)
            }
            override fun onServiceLost() {
                if (!closed && entries[key] === info) update(key, null)
            }
            override fun onServiceInfoCallbackRegistrationFailed(code: Int) {
                if (!closed && entries[key] === info) {
                    watching.remove(key)
                    // 达到平台活动监听数上限时，退回串行的一次解析。
                    pending.addLast(Resolution(info))
                    next()
                }
            }
            override fun onServiceInfoCallbackUnregistered() = Unit
        }
        try {
            nsd.registerServiceInfoCallback(info, { handler.post(it) }, listener)
            watching[key] = { runCatching { nsd.unregisterServiceInfoCallback(listener) } }
        } catch (_: IllegalArgumentException) {
            pending.addLast(Resolution(info))
            next()
        } catch (_: SecurityException) {
            fail("Local network access was denied.")
        }
    }

    @Suppress("DEPRECATION")
    private fun next() {
        if (resolving != null || closed) return
        val work = generateSequence { pending.removeFirstOrNull() }
            .firstOrNull { entries[it.info.key()] === it.info } ?: return
        val info = work.info
        val key = info.key()
        fun retry() {
            if (work.attempt >= 2 || entries[key] !== info) return
            handler.postDelayed({
                if (!closed && entries[key] === info) {
                    pending.addLast(work.copy(attempt = work.attempt + 1))
                    next()
                }
            }, 1_000L * (work.attempt + 1))
        }
        val listener = object : NsdManager.ResolveListener {
            override fun onServiceResolved(resolved: NsdServiceInfo) = onMain {
                if (resolving !== this) return@onMain
                if (entries[key] === info) update(key, resolved)
                resolving = null
                next()
            }
            override fun onResolveFailed(service: NsdServiceInfo, code: Int) = onMain {
                if (resolving !== this) return@onMain
                resolving = null
                retry()
                next()
            }
        }
        resolving = listener
        try {
            nsd.resolveService(info, listener)
            handler.postDelayed({
                if (!closed && resolving === listener) {
                    // 旧系统没有取消解析 API。丢弃迟到的回调并让其他实例继续，后台限次重试。
                    resolving = null
                    if (Build.VERSION.SDK_INT >= 34) runCatching { nsd.stopServiceResolution(listener) }
                    retry()
                    next()
                }
            }, 10_000)
        } catch (_: IllegalArgumentException) {
            resolving = null
            onMain { next() }
        } catch (_: SecurityException) {
            resolving = null
            fail("Local network access was denied.")
        }
    }
}
