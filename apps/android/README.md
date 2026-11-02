# Attendance employee app (Android)

Native Kotlin/Jetpack Compose employee app for the attendance API.

## Configure and run

- Open `apps/android` in Android Studio with JDK 17 and Android SDK 35 installed.
- The default API URL is `http://10.0.2.2:3000/api` for the Android emulator.
- Override the debug base URL at build time with `-PAPI_BASE_URL=http://your-host/api` (include the `/api` path). The value is compiled into `BuildConfig.API_BASE_URL`.
- Release builds use `-PRELEASE_API_BASE_URL=https://your-host/api`; Gradle rejects a non-HTTPS release URL. Replace the example URL before distributing a release. Cleartext HTTP is allowed only in debug builds.

## API contract

- `POST /auth/login` with `{ "email", "password" }`; stores `accessToken` and user profile.
- `GET /attendance/current`; server state is authoritative when refreshing.
- `POST /attendance/check-in` and `/attendance/check-out` with `{ "latitude", "longitude", "accuracy", "isMocked" }`.
- `POST /locations` uploads `{ "shiftId", "latitude", "longitude", "accuracy", "capturedAt", "isMocked" }`; `204 No Content` confirms acceptance.
- Authenticated requests send `Authorization: Bearer <accessToken>`.
- Only employee accounts can use attendance endpoints. Administrators should use the web dashboard.

## Location and shift behavior

The app requires precise foreground location and, on Android 13+, notification permission for check-in and check-out. Approximate-only permission is not sufficient. It does not request `ACCESS_BACKGROUND_LOCATION`. A successful explicit check-in starts a location foreground service with an ongoing notification. Fused Location Provider requests high-accuracy updates every 30 seconds with a 25 m minimum displacement. Samples are stored in encrypted app-private preferences (maximum 1,000) and uploaded by WorkManager when connected, with exponential retry. The server accepts delayed uploads for up to 7 days and only for the matching shift's time range. Check-out reconciles server state after ambiguous network failures; tracking stops only after check-out is confirmed.

The token and current shift are stored in app-private encrypted preferences. At launch, server current-shift state reconciles the saved shift. Tracking resumes only when the server shift matches a shift previously checked into through this app; unrelated active shifts do not start tracking. The service validates the stored shift before accepting samples. This is MVP persistence and does not restore tracking after device reboot.

The employee screen shows whether the service is waiting for GPS, syncing, synced, or needs attention, along with the most recent successful upload time. A shift remains active if a session expires; the employee must sign in again to resume uploads and check out. Sign-out is disabled while a shift is active. Device-reported mock-location flags are review signals only and can be bypassed on employee-owned devices; they are not proof that a location was spoofed or genuine.
