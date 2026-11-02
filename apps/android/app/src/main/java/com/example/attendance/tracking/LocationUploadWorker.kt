package com.example.attendance.tracking

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.example.attendance.data.AttendanceApi
import com.example.attendance.data.SecureStore
import java.io.IOException
import java.time.Instant
import java.util.concurrent.TimeUnit
import retrofit2.HttpException

class LocationUploadWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        val store = SecureStore(applicationContext)
        if (store.accessToken().isNullOrBlank()) return Result.failure()
        val api = AttendanceApi.create(applicationContext)

        repeat(MAX_SAMPLES_PER_RUN) {
            val pending = store.pendingLocations(limit = 1).firstOrNull()
                ?: return Result.success()
            try {
                val response = api.uploadLocation(pending.sample)
                if (!response.isSuccessful) {
                    val error = HttpException(response)
                    if (response.code() == 401) {
                        store.setTrackingHealth(
                            "session_expired",
                            "Sign in again to resume location uploads."
                        )
                        return Result.failure()
                    }
                    if (response.code() == 408 || response.code() == 429) {
                        store.setTrackingHealth(
                            "sync_error",
                            "The server asked the app to retry this saved location later."
                        )
                        return Result.retry()
                    }
                    if (response.code() in 400..499) {
                        store.removePendingLocation(pending.shiftId, pending.sample.capturedAt)
                        store.setTrackingHealth(
                            "sync_error",
                            "A saved location could not be accepted. Your manager may need to review this shift."
                        )
                        return@repeat
                    }
                    throw error
                }
                store.removePendingLocation(pending.shiftId, pending.sample.capturedAt)
                store.setTrackingHealth(
                    "synced",
                    "Location uploaded successfully.",
                    Instant.now().toString()
                )
            } catch (error: IOException) {
                store.setTrackingHealth(
                    "sync_error",
                    "Location is saved on this device and will retry when the connection is available."
                )
                return Result.retry()
            } catch (error: HttpException) {
                store.setTrackingHealth(
                    "sync_error",
                    "Location is saved on this device and will retry."
                )
                return Result.retry()
            }
        }
        return if (store.pendingLocations(limit = 1).isEmpty()) Result.success() else Result.retry()
    }

    companion object {
        private const val UNIQUE_WORK_NAME = "attendance-location-uploads"
        private const val MAX_SAMPLES_PER_RUN = 100

        fun enqueue(context: Context) {
            val request = OneTimeWorkRequestBuilder<LocationUploadWorker>()
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build()
                )
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(
                UNIQUE_WORK_NAME,
                ExistingWorkPolicy.KEEP,
                request
            )
        }
    }
}
