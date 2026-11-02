package com.example.attendance.data

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecureStore(context: Context) {
    private val preferences = EncryptedSharedPreferences.create(
        context,
        "attendance_secure",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
    private val gson = Gson()

    fun accessToken(): String? = preferences.getString(KEY_TOKEN, null)

    fun user(): User? {
        val id = preferences.getString(KEY_USER_ID, null) ?: return null
        return User(
            id = id,
            email = preferences.getString(KEY_USER_EMAIL, "").orEmpty(),
            name = preferences.getString(KEY_USER_NAME, "").orEmpty(),
            role = preferences.getString(KEY_USER_ROLE, "").orEmpty()
        )
    }

    fun saveSession(token: String, user: User) {
        preferences.edit()
            .putString(KEY_TOKEN, token)
            .putString(KEY_USER_ID, user.id)
            .putString(KEY_USER_EMAIL, user.email)
            .putString(KEY_USER_NAME, user.name)
            .putString(KEY_USER_ROLE, user.role)
            .apply()
    }

    fun clearSession() {
        preferences.edit()
            .remove(KEY_TOKEN)
            .remove(KEY_USER_ID)
            .remove(KEY_USER_EMAIL)
            .remove(KEY_USER_NAME)
            .remove(KEY_USER_ROLE)
            .apply()
    }

    fun shift(): Shift? {
        val id = preferences.getString(KEY_SHIFT_ID, null) ?: return null
        return Shift(id, preferences.getString(KEY_SHIFT_STARTED, "").orEmpty())
    }

    fun saveShift(shift: Shift) {
        preferences.edit()
            .putString(KEY_SHIFT_ID, shift.id)
            .putString(KEY_SHIFT_STARTED, shift.startedAt)
            .apply()
    }

    fun authorizeTracking(shiftId: String) {
        preferences.edit().putString(KEY_TRACKING_SHIFT_ID, shiftId).apply()
    }

    fun trackingShiftId(): String? = preferences.getString(KEY_TRACKING_SHIFT_ID, null)

    fun setTrackingHealth(status: String, message: String? = null, syncedAt: String? = null) {
        preferences.edit()
            .putString(KEY_TRACKING_STATUS, status)
            .putString(KEY_TRACKING_MESSAGE, message)
            .apply {
                if (syncedAt != null) putString(KEY_LAST_SYNCED_AT, syncedAt)
            }
            .apply()
    }

    fun trackingStatus(): String = preferences.getString(KEY_TRACKING_STATUS, "stopped").orEmpty()

    fun trackingMessage(): String? = preferences.getString(KEY_TRACKING_MESSAGE, null)

    fun lastSyncedAt(): String? = preferences.getString(KEY_LAST_SYNCED_AT, null)

    fun enqueueLocation(shiftId: String, sample: LocationSample): Boolean = synchronized(QUEUE_LOCK) {
        val queue = pendingLocations().toMutableList()
        if (queue.any { it.shiftId == shiftId && it.sample.capturedAt == sample.capturedAt }) {
            return@synchronized true
        }
        if (queue.size >= MAX_PENDING_LOCATIONS) return@synchronized false
        queue.add(PendingLocationSample(shiftId, sample))
        preferences.edit().putString(KEY_PENDING_LOCATIONS, gson.toJson(queue)).commit()
    }

    fun pendingLocations(limit: Int = MAX_PENDING_LOCATIONS): List<PendingLocationSample> =
        synchronized(QUEUE_LOCK) {
            val saved = preferences.getString(KEY_PENDING_LOCATIONS, null) ?: return@synchronized emptyList()
            val type = object : TypeToken<List<PendingLocationSample>>() {}.type
            gson.fromJson<List<PendingLocationSample>>(saved, type)
                .sortedBy { it.sample.capturedAt }
                .take(limit)
        }

    fun removePendingLocation(shiftId: String, capturedAt: String) = synchronized(QUEUE_LOCK) {
        val queue = pendingLocations().filterNot {
            it.shiftId == shiftId && it.sample.capturedAt == capturedAt
        }
        preferences.edit()
            .putString(KEY_PENDING_LOCATIONS, gson.toJson(queue))
            .commit()
    }

    fun clearShift() {
        preferences.edit()
            .remove(KEY_SHIFT_ID)
            .remove(KEY_SHIFT_STARTED)
            .remove(KEY_TRACKING_SHIFT_ID)
            .remove(KEY_TRACKING_STATUS)
            .remove(KEY_TRACKING_MESSAGE)
            .remove(KEY_LAST_SYNCED_AT)
            .apply()
    }

    companion object {
        private const val KEY_TOKEN = "access_token"
        private const val KEY_USER_ID = "user_id"
        private const val KEY_USER_EMAIL = "user_email"
        private const val KEY_USER_NAME = "user_name"
        private const val KEY_USER_ROLE = "user_role"
        private const val KEY_SHIFT_ID = "shift_id"
        private const val KEY_SHIFT_STARTED = "shift_started_at"
        private const val KEY_TRACKING_SHIFT_ID = "tracking_shift_id"
        private const val KEY_TRACKING_STATUS = "tracking_status"
        private const val KEY_TRACKING_MESSAGE = "tracking_message"
        private const val KEY_LAST_SYNCED_AT = "last_synced_at"
        private const val KEY_PENDING_LOCATIONS = "pending_locations"
        private const val MAX_PENDING_LOCATIONS = 1000
        private val QUEUE_LOCK = Any()
    }
}
