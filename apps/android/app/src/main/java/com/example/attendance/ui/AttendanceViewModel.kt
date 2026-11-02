package com.example.attendance.ui

import android.app.Application
import android.location.Location
import com.example.attendance.data.AttendanceApi
import com.example.attendance.data.CheckInRequest
import com.example.attendance.data.LoginRequest
import com.example.attendance.data.SecureStore
import com.example.attendance.data.Shift
import com.example.attendance.data.User
import com.example.attendance.tracking.LocationTrackingService
import com.example.attendance.tracking.LocationUploadWorker
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import retrofit2.HttpException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class AttendanceUiState(
    val isLoading: Boolean = true,
    val isWorking: Boolean = false,
    val user: User? = null,
    val shift: Shift? = null,
    val error: String? = null,
    val info: String? = null,
    val hasCurrentStatus: Boolean = false,
    val trackingStatus: String = "stopped",
    val trackingMessage: String? = null,
    val lastSyncedAt: String? = null
)

class AttendanceViewModel(application: Application) : AndroidViewModel(application) {
    private val store = SecureStore(application)
    private val api = AttendanceApi.create(application)
    private val locationClient = LocationServices.getFusedLocationProviderClient(application)
    private val mutableState = MutableStateFlow(AttendanceUiState())
    val state: StateFlow<AttendanceUiState> = mutableState.asStateFlow()
    private var initialized = false
    private var refreshing = false
    private var trackingMonitor: Job? = null

    fun initialize() {
        if (initialized) return
        initialized = true
        val user = store.user()
        if (user?.role != null && user.role != "EMPLOYEE") {
            store.clearSession()
            mutableState.value = AttendanceUiState(
                isLoading = false,
                error = "This app is for employee accounts. Admins should use the admin dashboard."
            )
            return
        }
        if (store.accessToken().isNullOrBlank() || user == null) {
            mutableState.value = AttendanceUiState(isLoading = false)
            return
        }
        mutableState.value = AttendanceUiState(isLoading = true, user = user, shift = store.shift())
        refreshCurrent()
    }

    fun login(email: String, password: String) {
        if (mutableState.value.isWorking) return
        viewModelScope.launch {
            update { copy(isWorking = true, error = null, info = null) }
            try {
                val response = api.login(LoginRequest(email, password))
                if (response.user.role != "EMPLOYEE") {
                    update {
                        copy(
                            isWorking = false,
                            error = "This app is for employee accounts. Admins should use the admin dashboard."
                        )
                    }
                    return@launch
                }
                store.saveSession(response.accessToken, response.user)
                LocationUploadWorker.enqueue(getApplication())
                update { copy(user = response.user, isWorking = false, isLoading = true) }
                refreshCurrent()
            } catch (error: Exception) {
                showError(error, sessionCanExpire = false)
            }
        }
    }

    fun refreshCurrent() {
        if (mutableState.value.isWorking || refreshing) return
        if (store.accessToken().isNullOrBlank()) {
            update { copy(isLoading = false) }
            return
        }
        refreshing = true
        viewModelScope.launch {
            update { copy(isLoading = true, hasCurrentStatus = false, error = null) }
            try {
                val authorizedShiftId = store.trackingShiftId()
                val current = api.currentShift().shift
                if (current == null) {
                    store.clearShift()
                    LocationTrackingService.stop(getApplication())
                    trackingMonitor?.cancel()
                } else {
                    if (authorizedShiftId != current.id) {
                        store.clearShift()
                        LocationTrackingService.stop(getApplication())
                    }
                    store.saveShift(current)
                }
                update { copy(isLoading = false, shift = current, error = null, hasCurrentStatus = true) }
                if (current != null && authorizedShiftId == current.id) {
                    try {
                        startTracking(current.id)
                        monitorTracking()
                    } catch (error: Exception) {
                        store.setTrackingHealth("unavailable", error.message ?: "Please check location permissions.")
                        monitorTracking()
                    }
                } else if (current != null) {
                    store.setTrackingHealth(
                        "not_started",
                        "This shift was started outside this app. Location tracking has not started."
                    )
                    update {
                        copy(
                            trackingStatus = "not_started",
                            trackingMessage = "This shift was started outside this app. Location tracking has not started."
                        )
                    }
                }
            } catch (error: Exception) {
                showError(error, loading = false)
            } finally {
                refreshing = false
            }
        }
    }

    fun checkIn() {
        val snapshot = mutableState.value
        if (snapshot.isWorking || snapshot.isLoading || !snapshot.hasCurrentStatus ||
            snapshot.shift != null || snapshot.user == null
        ) return
        viewModelScope.launch {
            update { copy(isWorking = true, error = null, info = null) }
            try {
                val location = currentLocation()
                if (location.accuracy > MAX_LOCATION_ACCURACY_METERS) {
                    throw IllegalStateException(
                        "GPS accuracy is about ${location.accuracy.toInt()} m. Move to an open area and try again."
                    )
                }
                val response = api.checkIn(location.toCheckInRequest())
                val shift = Shift(response.shiftId, response.startedAt)
                store.saveShift(shift)
                store.authorizeTracking(shift.id)
                store.setTrackingHealth("starting", "Starting shift location tracking.")
                update { copy(shift = shift, isWorking = false, trackingStatus = "starting") }
                try {
                    startTracking(shift.id)
                    monitorTracking()
                    update { copy(info = "You’re checked in. GPS tracking status is shown below.") }
                } catch (error: Exception) {
                    store.setTrackingHealth("unavailable", error.message ?: "Please check location permissions.")
                    update {
                        copy(
                            trackingStatus = "unavailable",
                            trackingMessage = error.message,
                            error = "You’re checked in, but location tracking could not start."
                        )
                    }
                }
            } catch (error: Exception) {
                showError(error)
            }
        }
    }

    fun checkOut() {
        val shift = mutableState.value.shift ?: return
        if (mutableState.value.isWorking || mutableState.value.isLoading) return
        viewModelScope.launch {
            update { copy(isWorking = true, error = null, info = null) }
            try {
                val location = currentLocation()
                if (location.accuracy > MAX_LOCATION_ACCURACY_METERS) {
                    throw IllegalStateException(
                        "GPS accuracy is about ${location.accuracy.toInt()} m. Move to an open area and try again."
                    )
                }
                api.checkOut(location.toCheckInRequest())
                finishCheckOut("You’re checked out. Location tracking has stopped.")
            } catch (error: Exception) {
                if (error is CancellationException) throw error
                if (error is HttpException && error.code() == 401) {
                    showError(error)
                } else {
                    reconcileCheckOut(error)
                }
            }
        }
    }

    fun onPreciseLocationPermissionDenied() {
        update {
            copy(
                error = "Precise location is required to record attendance. Allow precise location in Android settings and try again."
            )
        }
    }

    fun onNotificationPermissionDenied() {
        update {
            copy(
                error = "Allow notifications so Android can show the required on-shift location tracking notification."
            )
        }
    }

    fun signOut() {
        if (mutableState.value.shift != null || mutableState.value.isWorking) return
        store.clearSession()
        store.clearShift()
        LocationTrackingService.stop(getApplication())
        trackingMonitor?.cancel()
        mutableState.value = AttendanceUiState(
            isLoading = false,
            error = "You have been signed out."
        )
    }

    private fun monitorTracking() {
        trackingMonitor?.cancel()
        trackingMonitor = viewModelScope.launch {
            while (mutableState.value.shift != null) {
                val status = store.trackingStatus()
                if (status == "session_expired") {
                    store.clearSession()
                    update {
                        copy(
                            user = null,
                            isWorking = false,
                            isLoading = false,
                            hasCurrentStatus = false,
                            trackingStatus = "unavailable",
                            trackingMessage = "Sign in again to resume location uploads.",
                            error = "Your session expired. Sign in again to continue."
                        )
                    }
                    return@launch
                }
                update {
                    copy(
                        trackingStatus = status,
                        trackingMessage = store.trackingMessage(),
                        lastSyncedAt = store.lastSyncedAt()
                    )
                }
                delay(TRACKING_STATUS_REFRESH_MS)
            }
        }
    }

    private suspend fun currentLocation(): Location = suspendCancellableCoroutine { continuation ->
        val cancellation = CancellationTokenSource()
        continuation.invokeOnCancellation { cancellation.cancel() }
        locationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cancellation.token)
            .addOnSuccessListener { location ->
                if (location == null) {
                    continuation.resumeWithException(IllegalStateException("Could not get your location. Turn on location and try again."))
                } else {
                    continuation.resume(location)
                }
            }
            .addOnFailureListener { error -> continuation.resumeWithException(error) }
    }

    private fun reconcileCheckOut(originalError: Exception) {
        viewModelScope.launch {
            try {
                if (api.currentShift().shift == null) {
                    finishCheckOut("Check-out was confirmed after reconnecting. Location tracking has stopped.")
                } else {
                    showError(originalError)
                }
            } catch (reconciliationError: Exception) {
                if (reconciliationError is HttpException && reconciliationError.code() == 401) {
                    showError(reconciliationError)
                } else {
                    showError(
                        IllegalStateException(
                            "We couldn't confirm check-out. Refresh your attendance status before trying again."
                        )
                    )
                }
            }
        }
    }

    private fun finishCheckOut(message: String) {
        store.clearShift()
        LocationTrackingService.stop(getApplication())
        trackingMonitor?.cancel()
        update {
            copy(
                shift = null,
                isWorking = false,
                trackingStatus = "stopped",
                trackingMessage = null,
                lastSyncedAt = null,
                info = message
            )
        }
        if (store.pendingLocations(limit = 1).isNotEmpty()) {
            LocationUploadWorker.enqueue(getApplication())
        }
    }

    private fun Location.toCheckInRequest() =
        CheckInRequest(
            latitude = latitude,
            longitude = longitude,
            accuracy = accuracy,
            isMocked = isMocked()
        )

    @Suppress("DEPRECATION")
    private fun Location.isMocked(): Boolean =
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) isMock else isFromMockProvider

    private fun startTracking(shiftId: String) {
        LocationTrackingService.start(getApplication(), shiftId)
    }

    private fun showError(
        error: Exception,
        loading: Boolean = false,
        sessionCanExpire: Boolean = true
    ) {
        if (error is CancellationException) throw error
        val expired = sessionCanExpire && error is HttpException && error.code() == 401
        if (expired) {
            store.clearSession()
            LocationTrackingService.stop(getApplication())
            trackingMonitor?.cancel()
            val shift = store.shift()
            store.setTrackingHealth(
                if (shift == null) "stopped" else "unavailable",
                if (shift == null) null else "Sign in again to resume location uploads."
            )
            update {
                copy(
                    user = null,
                    shift = shift,
                    isWorking = false,
                    isLoading = false,
                    hasCurrentStatus = false,
                    trackingStatus = if (shift == null) "stopped" else "unavailable",
                    trackingMessage = if (shift == null) null else "Sign in again to resume location uploads.",
                    error = "Your session expired. Sign in again to continue."
                )
            }
            return
        }
        update { copy(isWorking = false, isLoading = loading, error = error.toDisplayMessage()) }
    }

    private fun Exception.toDisplayMessage(): String {
        if (this is HttpException) {
            val responseText = response()?.errorBody()?.string()
            val serverMessage = responseText
                ?.let { Regex("\"(?:message|error)\"\\s*:\\s*\"([^\"]+)\"").find(it)?.groupValues?.getOrNull(1) }
            return serverMessage ?: "Request failed (${code()}). Please try again."
        }
        return message?.takeIf { it.isNotBlank() } ?: "Something went wrong. Please try again."
    }

    private inline fun update(transform: AttendanceUiState.() -> AttendanceUiState) {
        mutableState.value = mutableState.value.transform()
    }

    companion object {
        private const val MAX_LOCATION_ACCURACY_METERS = 100f
        private const val TRACKING_STATUS_REFRESH_MS = 2_000L
    }
}

class AttendanceViewModelFactory(private val application: Application) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        if (modelClass.isAssignableFrom(AttendanceViewModel::class.java)) {
            return AttendanceViewModel(application) as T
        }
        throw IllegalArgumentException("Unknown ViewModel class")
    }
}
