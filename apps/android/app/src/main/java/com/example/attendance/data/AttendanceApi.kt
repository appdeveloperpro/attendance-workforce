package com.example.attendance.data

import android.content.Context
import com.example.attendance.BuildConfig
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.Response
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST

interface AttendanceApi {
    @POST("auth/login")
    suspend fun login(@Body request: LoginRequest): LoginResponse

    @GET("attendance/current")
    suspend fun currentShift(): CurrentShiftResponse

    @POST("attendance/check-in")
    suspend fun checkIn(@Body request: CheckInRequest): CheckInResponse

    @POST("attendance/check-out")
    suspend fun checkOut(@Body request: CheckInRequest): CheckOutResponse

    @POST("locations")
    suspend fun uploadLocation(@Body sample: LocationSample): Response<Unit>

    companion object {
        fun create(context: Context): AttendanceApi {
            val auth = Interceptor { chain ->
                val token = SecureStore(context).accessToken()
                val request = chain.request().newBuilder().apply {
                    if (!token.isNullOrBlank()) {
                        header("Authorization", "Bearer $token")
                    }
                }.build()
                chain.proceed(request)
            }
            val client = OkHttpClient.Builder()
                .addInterceptor(auth)
                .build()

            return Retrofit.Builder()
                .baseUrl(BuildConfig.API_BASE_URL)
                .client(client)
                .addConverterFactory(GsonConverterFactory.create())
                .build()
                .create(AttendanceApi::class.java)
        }
    }
}
