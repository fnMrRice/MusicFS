package io.musicfs.android.main

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import io.musicfs.android.connection.LibraryState
import io.musicfs.android.ui.rememberNearbyServers

@Composable
internal fun ConnectionForm(state: LibraryState, television: Boolean, onConnect: (String, String) -> Unit) {
    var address by rememberSaveable { mutableStateOf(state.address) }
    // 登录凭据只在此界面的内存中保留。
    var credential by remember { mutableStateOf("") }
    val nearby = rememberNearbyServers()
    val initialFocus = remember { FocusRequester() }
    val focus = LocalFocusManager.current
    // 单行输入框保留左右键移动光标；上下键交给遥控器焦点导航。
    val fieldNavigation = if (television) Modifier.onPreviewKeyEvent { event ->
        if (event.type != KeyEventType.KeyDown) return@onPreviewKeyEvent false
        when (event.key) {
            Key.DirectionDown -> focus.moveFocus(FocusDirection.Next)
            Key.DirectionUp -> focus.moveFocus(FocusDirection.Previous)
            else -> false
        }
    } else Modifier
    Box(Modifier.fillMaxSize().padding(horizontal = 24.dp), contentAlignment = Alignment.Center) {
        Column(
            modifier = Modifier.widthIn(max = 440.dp).fillMaxWidth()
                .verticalScroll(rememberScrollState()).padding(vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("Connect to MusicFS", style = MaterialTheme.typography.headlineMedium)
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                label = { Text("Server URL") },
                placeholder = { Text("https://music.example.org") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, showKeyboardOnFocus = !television),
                modifier = Modifier.fillMaxWidth().focusRequester(initialFocus).then(fieldNavigation),
            )
            OutlinedTextField(
                value = credential,
                onValueChange = { credential = it },
                label = { Text("Access token") },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, showKeyboardOnFocus = !television),
                modifier = Modifier.fillMaxWidth().then(fieldNavigation),
            )
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = {
                    onConnect(address.trim(), credential)
                    credential = ""
                },
                enabled = !state.busy && address.isNotBlank() && credential.isNotBlank(),
                modifier = Modifier.tvFocus(television),
            ) {
                Text(if (state.busy) "Connecting…" else "Connect")
            }
            Text("Nearby servers", style = MaterialTheme.typography.titleMedium)
            nearby.message?.let { Text(it) }
            nearby.servers.forEach { server ->
                OutlinedButton(
                    onClick = {
                        address = server.address
                        credential = ""
                        initialFocus.requestFocus()
                    },
                    enabled = !state.busy,
                    modifier = Modifier.fillMaxWidth().tvFocus(television),
                ) {
                    Column {
                        Text(server.name)
                        Text(server.address, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            nearby.actionLabel?.let { label ->
                OutlinedButton(nearby.onAction, modifier = Modifier.tvFocus(television)) { Text(label) }
            }
        }
    }
    LaunchedEffect(Unit) {
        if (television) initialFocus.requestFocus()
    }
}
