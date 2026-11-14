package io.musicfs.android.wear

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import io.musicfs.android.connection.LibraryState
import io.musicfs.android.ui.rememberNearbyServers
import kotlinx.coroutines.launch

private enum class Field { Address, Token }

@Composable
internal fun WatchLogin(state: LibraryState, list: LazyListState, onConnect: (String, String) -> Unit) {
    var address by rememberSaveable { mutableStateOf(state.address) }
    var token by remember { mutableStateOf("") }
    var editing by remember { mutableStateOf<Field?>(null) }
    val nearby = rememberNearbyServers()
    val scope = rememberCoroutineScope()
    val field = editing
    if (field != null) {
        WatchInput(
            field = field,
            initialValue = if (field == Field.Address) address else token,
            onSave = {
                if (field == Field.Address) address = it else token = it
                editing = null
            },
            onCancel = { editing = null },
        )
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        WatchAction("Server URL", detail = address.ifBlank { "Enter HTTPS address" }) { editing = Field.Address }
        WatchAction("Access token", detail = if (token.isEmpty()) "Enter token" else "Entered") { editing = Field.Token }
        state.error?.let { Text(it, color = MaterialTheme.colors.error) }
        WatchAction(
            text = if (state.busy) "Connecting…" else "Connect",
            enabled = !state.busy && address.isNotBlank() && token.isNotBlank(),
        ) {
            onConnect(address.trim(), token)
            token = ""
        }
        Text("Nearby servers", style = MaterialTheme.typography.caption1)
        nearby.message?.let { Text(it, style = MaterialTheme.typography.caption2) }
        nearby.servers.forEach { server ->
            WatchAction(server.name, detail = server.address, enabled = !state.busy) {
                address = server.address
                token = ""
                scope.launch { list.animateScrollToItem(0) }
            }
        }
        nearby.actionLabel?.let { label -> WatchAction(label, action = nearby.onAction) }
    }
}

@Composable
private fun WatchInput(field: Field, initialValue: String, onSave: (String) -> Unit, onCancel: () -> Unit) {
    val secret = field == Field.Token
    val label = if (secret) "Access token" else "Server URL"
    var value by remember(field) { mutableStateOf(initialValue) }
    val keyboard = LocalSoftwareKeyboardController.current
    val save = {
        keyboard?.hide()
        onSave(value)
    }
    BackHandler { onCancel() }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, style = MaterialTheme.typography.caption1)
        BasicTextField(
            value = value,
            onValueChange = { value = it },
            modifier = Modifier.fillMaxWidth()
                .border(1.dp, MaterialTheme.colors.primary, RoundedCornerShape(12.dp))
                .padding(10.dp).semantics { contentDescription = label },
            singleLine = true,
            textStyle = MaterialTheme.typography.body2.copy(color = MaterialTheme.colors.onBackground),
            cursorBrush = SolidColor(MaterialTheme.colors.primary),
            visualTransformation = if (secret) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(
                keyboardType = if (secret) KeyboardType.Password else KeyboardType.Uri,
                imeAction = ImeAction.Done,
            ),
            keyboardActions = KeyboardActions(onDone = { save() }),
        )
        WatchAction("Save", action = save)
        WatchAction("Cancel", action = onCancel)
    }
}
