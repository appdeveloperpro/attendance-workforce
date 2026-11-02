package com.example.attendance.data

data class User(
    val id: String,
    val email: String,
    val name: String,
    val role: String
)

data class Shift(
    val id: String,
    val startedAt: String
)

data class LoginRequest(val email: String, val password: String)
data class LoginResponse(val accessToken: String, val user: User)
data class CurrentShiftResponse(val shift: Shift?)
data class CheckInRequest(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val isMocked: Boolean = false
)
data class CheckInResponse(val shiftId: String, val startedAt: String)
data class CheckOutResponse(val shiftId: String, val endedAt: String, val distanceMeters: Double)
data class LocationSample(
    val shiftId: String,
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val capturedAt: String,
    val isMocked: Boolean
)

data class PendingLocationSample(val shiftId: String, val sample: LocationSample)
