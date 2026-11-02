package com.example.attendance

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.example.attendance.data.Shift
import com.example.attendance.data.User
import com.example.attendance.ui.AttendanceViewModel
import com.example.attendance.ui.AttendanceViewModelFactory
import com.example.attendance.ui.AttendanceUiState
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MainActivity : ComponentActivity() {
    private lateinit var requestPermissions: () -> Unit
    private var onPermissionGranted: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val vm: AttendanceViewModel = viewModel(factory = AttendanceViewModelFactory(application))
            val state by vm.state.collectAsState()
            val permissionsLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestMultiplePermissions()
            ) {
                val action = onPermissionGranted
                onPermissionGranted = null
                when {
                    !hasPreciseLocationPermission() -> vm.onPreciseLocationPermissionDenied()
                    !hasNotificationPermission() -> vm.onNotificationPermissionDenied()
                    else -> action?.invoke()
                }
            }
            LaunchedEffect(Unit) {
                requestPermissions = {
                    val permissions = mutableListOf(
                        Manifest.permission.ACCESS_COARSE_LOCATION,
                        Manifest.permission.ACCESS_FINE_LOCATION
                    )
                    if (Build.VERSION.SDK_INT >= 33) permissions.add(Manifest.permission.POST_NOTIFICATIONS)
                    permissionsLauncher.launch(permissions.toTypedArray())
                }
                vm.initialize()
            }
            AttendanceApp(
                state = state,
                onLogin = vm::login,
                onCheckIn = {
                    if (hasPreciseLocationPermission() && hasNotificationPermission()) vm.checkIn()
                    else {
                        onPermissionGranted = { vm.checkIn() }
                        requestPermissions()
                    }
                },
                onCheckOut = {
                    if (hasPreciseLocationPermission() && hasNotificationPermission()) vm.checkOut()
                    else {
                        onPermissionGranted = { vm.checkOut() }
                        requestPermissions()
                    }
                },
                onRefresh = vm::refreshCurrent,
                onSignOut = vm::signOut
            )
        }
    }

    private fun hasPreciseLocationPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun hasNotificationPermission(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
}

@Composable
private fun AttendanceApp(
    state: AttendanceUiState,
    onLogin: (String, String) -> Unit,
    onCheckIn: () -> Unit,
    onCheckOut: () -> Unit,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit
) {
    MaterialTheme(
        colorScheme = MaterialTheme.colorScheme.copy(
            primary = Color(0xFF147957),
            secondary = Color(0xFF79C7A8),
            background = Color(0xFFF3F6F4),
            surface = Color.White
        )
    ) {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            if (state.user == null) {
                LoginScreen(state, onLogin)
            } else {
                AttendanceScreen(state, onCheckIn, onCheckOut, onRefresh, onSignOut)
            }
        }
    }
}

@Composable
private fun LoginScreen(state: AttendanceUiState, onLogin: (String, String) -> Unit) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).imePadding().padding(horizontal = 24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = Color(0xFFE5F2EA),
            modifier = Modifier.fillMaxWidth().padding(bottom = 26.dp)
        ) {
            Column(Modifier.padding(22.dp)) {
                Box(
                    Modifier.width(46.dp).height(46.dp).background(Color(0xFF147957), RoundedCornerShape(14.dp)),
                    contentAlignment = Alignment.Center
                ) {
                    Text("A", color = Color.White, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                }
                Spacer(Modifier.height(24.dp))
                Text("WORKFORCE", color = Color(0xFF147957), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                Text("Welcome back", style = MaterialTheme.typography.headlineLarge, fontWeight = FontWeight.Bold)
                Text("Sign in to manage your attendance.", color = Color(0xFF66736D), modifier = Modifier.padding(top = 8.dp))
            }
        }
        if (state.shift != null) {
            Text(
                "Your shift is still active. Sign in again to resume location uploads, or contact your manager if you cannot access your account.",
                color = Color(0xFF8A5A10),
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.padding(bottom = 16.dp)
            )
        }
        OutlinedTextField(
            value = email, onValueChange = { email = it }, label = { Text("Work email") },
            singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = password, onValueChange = { password = it }, label = { Text("Password") },
            singleLine = true, visualTransformation = PasswordVisualTransformation(),
            modifier = Modifier.fillMaxWidth()
        )
        ErrorBanner(state.error)
        Spacer(Modifier.height(20.dp))
        Button(
            onClick = { onLogin(email.trim(), password) },
            enabled = !state.isWorking && email.isNotBlank() && password.isNotBlank(),
            modifier = Modifier.fillMaxWidth().height(54.dp),
            shape = RoundedCornerShape(16.dp)
        ) {
            if (state.isWorking) CircularProgressIndicator(modifier = Modifier.height(20.dp), color = Color.White, strokeWidth = 2.dp)
            else Text("Sign in", fontWeight = FontWeight.SemiBold)
        }
        if (state.isLoading) {
            Spacer(Modifier.height(16.dp))
            CircularProgressIndicator(modifier = Modifier.align(Alignment.CenterHorizontally))
        }
    }
}

@Composable
private fun AttendanceScreen(
    state: AttendanceUiState,
    onCheckIn: () -> Unit,
    onCheckOut: () -> Unit,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit
) {
    val shift = state.shift
    Column(
        modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(modifier = Modifier.weight(1f)) {
                        Text("WORKDAY", color = Color(0xFF147957), style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                        Text("Hello, ${state.user?.name.orEmpty().substringBefore(' ')}", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            }
            TextButton(onClick = onRefresh, enabled = !state.isWorking && !state.isLoading) { Text("Refresh") }
            TextButton(
                onClick = onSignOut,
                enabled = shift == null && !state.isWorking && !state.isLoading
            ) { Text("Sign out") }
        }
        Card(
            colors = CardDefaults.cardColors(containerColor = Color.White),
            shape = RoundedCornerShape(24.dp),
            border = BorderStroke(1.dp, Color(0xFFE8EEE9)),
            elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
        ) {
            Column(Modifier.fillMaxWidth().padding(22.dp)) {
                Text(
                    if (shift == null) "YOUR WORKDAY" else "CURRENT SHIFT",
                    color = Color(0xFF87948C),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(14.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier.background(if (shift == null) Color(0xFFE5F2EA) else Color(0xFFFFF2D9), CircleShape).padding(12.dp)
                    ) {
                        IconDot(if (shift == null) Color(0xFF147957) else Color(0xFFAD7413))
                    }
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text(if (shift == null) "Ready when you are" else "You’re on shift", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                        Text(
                            if (shift == null) "Check in to start your workday." else "Location is collected during your shift only.",
                            color = Color(0xFF66736D), style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier.padding(top = 4.dp)
                        )
                    }
                }
                if (shift != null) {
                    Spacer(Modifier.height(18.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        androidx.compose.material3.Icon(Icons.Default.AccessTime, contentDescription = null, tint = Color(0xFF147957))
                        Spacer(Modifier.width(8.dp))
                        Text(
                            "Checked in ${formatTime(shift.startedAt)}",
                            color = Color(0xFF66736D),
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
            }
        }
        if (shift == null) {
            Button(
                onClick = onCheckIn, enabled = !state.isWorking && !state.isLoading && state.hasCurrentStatus,
                modifier = Modifier.fillMaxWidth().height(58.dp), shape = RoundedCornerShape(16.dp)
            ) {
                if (state.isWorking) CircularProgressIndicator(modifier = Modifier.height(20.dp), color = Color.White, strokeWidth = 2.dp)
                else {
                    androidx.compose.material3.Icon(Icons.Default.LocationOn, contentDescription = null)
                    Spacer(Modifier.width(8.dp))
                    Text("Check in", fontWeight = FontWeight.SemiBold)
                }
            }
        } else {
            Card(
                colors = CardDefaults.cardColors(containerColor = Color.White),
                shape = RoundedCornerShape(18.dp),
                border = BorderStroke(1.dp, Color(0xFFE6ECE8)),
                elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
            ) {
                Row(Modifier.fillMaxWidth().padding(18.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.background(Color(0xFFE5F2EA), CircleShape).padding(10.dp)) {
                        androidx.compose.material3.Icon(Icons.Default.LocationOn, contentDescription = null, tint = Color(0xFF147957))
                    }
                    Spacer(Modifier.width(10.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            trackingStatusTitle(state.trackingStatus),
                            fontWeight = FontWeight.SemiBold,
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Text(
                            state.trackingMessage ?: trackingStatusDescription(state.trackingStatus),
                            color = Color(0xFF66736D),
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 3.dp)
                        )
                        state.lastSyncedAt?.let { lastSynced ->
                            Text(
                                "Last location synced ${formatTime(lastSynced)}",
                                color = Color(0xFF66736D),
                                style = MaterialTheme.typography.bodySmall,
                                modifier = Modifier.padding(top = 3.dp)
                            )
                        } ?: Text(
                            "No location has synced yet.",
                            color = Color(0xFF66736D),
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 3.dp)
                        )
                    }
                }
            }
            Button(
                onClick = onCheckOut, enabled = !state.isWorking && !state.isLoading,
                modifier = Modifier.fillMaxWidth().height(58.dp), shape = RoundedCornerShape(16.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF24332D))
            ) {
                if (state.isWorking) CircularProgressIndicator(modifier = Modifier.height(20.dp), color = Color.White, strokeWidth = 2.dp)
                else Text("Check out", fontWeight = FontWeight.SemiBold)
            }
        }
        ErrorBanner(state.error)
        state.info?.let { Text(it, color = Color(0xFF176B58), style = MaterialTheme.typography.bodyMedium) }
        Spacer(Modifier.weight(1f))
        Text(
            "${state.user?.email.orEmpty()}  ·  ${state.user?.role.orEmpty()}",
            color = Color(0xFF77827D), style = MaterialTheme.typography.bodySmall
        )
    }
}

@Composable
private fun IconDot(color: Color) {
    Box(Modifier.width(12.dp).height(12.dp).background(color, CircleShape))
}

private fun trackingStatusTitle(status: String): String = when (status) {
    "starting" -> "Starting location tracking"
    "waiting" -> "Waiting for GPS"
    "syncing" -> "Syncing location"
    "synced" -> "Location synced"
    "poor_accuracy" -> "GPS signal needs improvement"
    "sync_error" -> "Location sync needs attention"
    "session_expired" -> "Sign in again to resume uploads"
    "unavailable" -> "Location tracking unavailable"
    "not_started" -> "Location tracking not started"
    else -> "Location tracking stopped"
}

private fun trackingStatusDescription(status: String): String = when (status) {
    "starting" -> "Starting the shift location service."
    "waiting" -> "Waiting for the first location fix."
    "syncing" -> "A GPS fix was received and is being uploaded."
    "synced" -> "Your latest GPS fix was uploaded."
    "poor_accuracy" -> "Move to a clearer area for a more accurate GPS fix."
    "sync_error" -> "The app will retry after the next GPS update."
    "session_expired" -> "Sign in again to resume location uploads."
    "unavailable" -> "Check location permissions and try again."
    "not_started" -> "This shift was started outside this app."
    else -> "Location is not currently being uploaded."
}

@Composable
private fun ErrorBanner(error: String?) {
    if (error != null) {
        Text(
            error, color = Color(0xFFAB3838), style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.fillMaxWidth().padding(top = 12.dp)
        )
    }
}

private fun formatTime(value: String): String = runCatching {
    val instant = Instant.parse(value)
    DateTimeFormatter.ofPattern("MMM d, h:mm a").withZone(ZoneId.systemDefault()).format(instant)
}.getOrDefault(value)
