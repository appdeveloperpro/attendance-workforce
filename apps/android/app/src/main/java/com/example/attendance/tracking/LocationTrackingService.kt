package com.example.attendance.tracking

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.example.attendance.data.LocationSample
import com.example.attendance.data.SecureStore
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.time.Instant

class LocationTrackingService : Service() {
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val store by lazy { SecureStore(this) }
    private val fusedLocationClient by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private var activeShiftId: String? = null

    private val locationCallback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            result.locations.forEach { location -> uploadIfOnShift(location) }
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            val savedShift = store.shift()
            if (savedShift != null && store.trackingShiftId() == savedShift.id && !store.accessToken().isNullOrBlank()) {
                beginTracking(savedShift.id)
                return START_STICKY
            }
            stopSelf()
            return START_NOT_STICKY
        }
        if (intent.action != ACTION_START) {
            stopSelf()
            return START_NOT_STICKY
        }

        val shiftId = intent.getStringExtra(EXTRA_SHIFT_ID)
        if (shiftId.isNullOrBlank() || store.accessToken().isNullOrBlank() ||
            store.shift()?.id != shiftId || store.trackingShiftId() != shiftId
        ) {
            stopSelf()
            return START_NOT_STICKY
        }
        beginTracking(shiftId)
        return START_STICKY
    }

    private fun beginTracking(shiftId: String) {
        if (activeShiftId == shiftId) return
        activeShiftId = shiftId
        createNotificationChannel()
        store.setTrackingHealth("waiting", "Waiting for a GPS location.")
        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
        requestLocationUpdates()
    }

    private fun requestLocationUpdates() {
        val hasFineLocation = ContextCompat.checkSelfPermission(
            this,
            android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        if (!hasFineLocation) {
            updateTrackingHealth("unavailable", "Precise location permission is off. Re-enable it to resume tracking.")
            stopSelf()
            return
        }
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, UPDATE_INTERVAL_MS)
            .setMinUpdateDistanceMeters(MIN_DISTANCE_METERS)
            .build()
        try {
            fusedLocationClient.requestLocationUpdates(request, locationCallback, mainLooper)
                .addOnFailureListener { error ->
                    updateTrackingHealth(
                        "unavailable",
                        error.message ?: "Android could not start location updates."
                    )
                    stopSelf()
                }
        } catch (error: SecurityException) {
            updateTrackingHealth("unavailable", error.message ?: "Location permission is unavailable.")
            stopSelf()
        }
    }

    private fun uploadIfOnShift(location: Location) {
        val shiftId = activeShiftId ?: return
        if (store.shift()?.id != shiftId || store.trackingShiftId() != shiftId ||
            store.accessToken().isNullOrBlank()
        ) {
            stopSelf()
            return
        }
        serviceScope.launch {
            if (location.accuracy > MAX_LOCATION_ACCURACY_METERS) {
                updateTrackingHealth(
                    "poor_accuracy",
                    "GPS accuracy is about ${location.accuracy.toInt()} m. Waiting for a clearer location."
                )
                return@launch
            }
            val capturedAt = Instant.ofEpochMilli(location.time).toString()
            val sample = LocationSample(
                shiftId = shiftId,
                latitude = location.latitude,
                longitude = location.longitude,
                accuracy = location.accuracy,
                capturedAt = capturedAt,
                isMocked = location.isMocked()
            )
            if (!store.enqueueLocation(shiftId, sample)) {
                updateTrackingHealth(
                    "queue_full",
                    "Saved location storage is full. Connect to the internet to sync this shift."
                )
                return@launch
            }
            updateTrackingHealth("syncing", "Location saved securely and queued for upload.")
            LocationUploadWorker.enqueue(this@LocationTrackingService)
        }
    }

    @Suppress("DEPRECATION")
    private fun Location.isMocked(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock else isFromMockProvider

    private fun updateTrackingHealth(
        status: String,
        message: String,
        syncedAt: String? = null
    ) {
        store.setTrackingHealth(status, message, syncedAt)
        if (activeShiftId != null) {
            getSystemService(NotificationManager::class.java)
                .notify(NOTIFICATION_ID, buildNotification(message))
        }
    }

    private fun buildNotification(
        message: String = "Your location is shared while you are checked in."
    ): Notification =
        NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Shift location tracking")
            .setContentText(message)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "Shift location tracking", NotificationManager.IMPORTANCE_LOW)
            )
        }
    }

    override fun onDestroy() {
        fusedLocationClient.removeLocationUpdates(locationCallback)
        serviceScope.cancel()
        if (store.trackingStatus() != "session_expired" &&
            store.trackingStatus() != "unavailable"
        ) {
            store.setTrackingHealth("stopped", "Location tracking is stopped.")
        }
        activeShiftId = null
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL_ID = "attendance_location"
        private const val NOTIFICATION_ID = 42
        private const val UPDATE_INTERVAL_MS = 30_000L
        private const val MIN_DISTANCE_METERS = 25f
        private const val MAX_LOCATION_ACCURACY_METERS = 100f
        private const val ACTION_START = "com.example.attendance.START_TRACKING"
        private const val EXTRA_SHIFT_ID = "shift_id"

        fun start(context: Context, shiftId: String) {
            val intent = Intent(context, LocationTrackingService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_SHIFT_ID, shiftId)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationTrackingService::class.java))
        }
    }
}
