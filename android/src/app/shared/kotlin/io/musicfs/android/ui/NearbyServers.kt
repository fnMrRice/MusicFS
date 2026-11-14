package io.musicfs.android.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import io.musicfs.android.connection.DiscoveredServer
import io.musicfs.android.connection.discoverServers
import io.musicfs.android.connection.discoveryPermission
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

internal data class NearbyServers(
    val servers: List<DiscoveredServer>,
    val message: String?,
    val actionLabel: String?,
    val onAction: () -> Unit,
)

@Composable
internal fun rememberNearbyServers(): NearbyServers {
    val context = LocalContext.current.applicationContext
    val owner = LocalLifecycleOwner.current
    var permission by remember(context) { mutableStateOf(discoveryPermission(context)) }
    var attempt by remember { mutableStateOf(0) }
    var servers by remember { mutableStateOf(emptyList<DiscoveredServer>()) }
    var searchError by remember { mutableStateOf<String?>(null) }
    var initialSearch by remember { mutableStateOf(true) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        permission = discoveryPermission(context)
    }
    LaunchedEffect(context, owner, attempt, permission) {
        owner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            permission = discoveryPermission(context)
            servers = emptyList()
            searchError = null
            initialSearch = true
            if (permission != null) return@repeatOnLifecycle
            coroutineScope {
                // DNS-SD 持续监听。首次搜索稍候给出空状态，后续出现的实例仍可加入。
                launch {
                    delay(4_000)
                    initialSearch = false
                }
                discoverServers(context).collect {
                    servers = it.servers
                    searchError = it.error
                }
            }
        }
    }
    val message = when {
        permission != null -> "Allow local network access to find servers."
        searchError != null -> searchError
        servers.isNotEmpty() -> null
        initialSearch -> "Searching for servers…"
        else -> "No servers found. You can enter a server URL."
    }
    val actionLabel = when {
        permission != null -> "Allow discovery"
        searchError != null -> "Search again"
        else -> null
    }
    return NearbyServers(servers, message, actionLabel) {
        val required = discoveryPermission(context)
        if (required != null) launcher.launch(required) else {
            permission = null
            attempt++
        }
    }
}
