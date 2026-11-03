# Attendance GPS MVP

An employee-owned Android attendance app with shift-only location collection, a NestJS API, PostgreSQL storage, and an administrator dashboard.

## What is included

- Employee-only Android sign-in, GPS check-in/check-out, and an on-shift location foreground service with visible GPS/sync health.
- A NestJS API with hashed passwords, role-based admin routes, JWT sessions, employee account management, and server-side distance estimates.
- A Next.js admin dashboard for daily shifts and exact recorded GPS coordinates.
- GPS samples are collected only during an app-authorized shift. Uploads can be delayed for up to 7 days and are accepted only when their capture time falls inside that shift. The app does not request always-on background location.
- Both the Android app and API restrict attendance access to employee accounts; administrators use the web dashboard.

GPS accuracy and availability depend on the employee's phone and environment. Location readings with accuracy worse than 100 metres are not accepted; distance estimates also omit implausible jumps. Device-reported mock-location flags are unverified review signals, not proof: BYOD GPS can be disabled or spoofed, and the app cannot guarantee continuous tracking.

## Local setup

Requirements: Node.js 20.9+, npm, Android Studio with Android SDK, and Docker Desktop (or a local PostgreSQL 16 instance).

1. Configure and start PostgreSQL:

   ```powershell
   Copy-Item .env.example .env
   ```

   Replace `POSTGRES_PASSWORD` with a random password before starting the database:

   ```powershell
   docker compose up -d database
   ```

2. Install JavaScript dependencies:

   ```powershell
   npm install
   ```

3. Configure the API:

   ```powershell
   Copy-Item apps/api/.env.example apps/api/.env
   ```

   Set `JWT_SECRET` to a random secret of at least 32 characters and set a unique `ADMIN_PASSWORD` of at least 12 characters. The configured initial account is a superadmin. Running the seed command upgrades an existing `ADMIN` with that email to `SUPERADMIN` without changing its password. Set `DATABASE_URL` to use the same user, password, and database as the root `.env` file:

   ```text
   postgresql://attendance:<POSTGRES_PASSWORD>@localhost:5432/attendance?schema=public
   ```

   Set `DIRECT_URL` to the direct or session-mode PostgreSQL connection for the same database. For Supabase, use its session-mode connection (port `5432`) for `DIRECT_URL` and its pooled connection (typically port `6543`) for `DATABASE_URL`. Prisma uses `DIRECT_URL` for schema operations such as `db push`.

4. Create the database tables and initial superadmin:

   ```powershell
   npm run db:push --workspace @attendance/api
   npm run prisma:seed-admin --workspace @attendance/api
   ```

   Superadmins can create and manage administrator accounts, reset their profile/password, change roles, disable accounts, and update the location retention period from the dashboard. Administrators and superadmins can register and manage employee accounts. Disabling an employee preserves their attendance history and is blocked while they have an active shift. The final active superadmin cannot disable or demote themselves.

5. Start the API and dashboard in separate terminals:

   ```powershell
   npm run dev:api
   npm run dev:admin
   ```

   Open `http://localhost:3001` and sign in with the configured administrator credentials. The **Overview** page summarizes the selected workday and links to common tasks. Use **Attendance** to review shifts and routes, and **Employees** to register, search, update, reset passwords, or disable/re-enable employee accounts. Superadmins can also manage administrator accounts in **Admin access**. The selected local day shows shifts whose check-in time falls on that day; an overnight shift is listed on its start day.

6. Open `apps/android` in Android Studio, sync Gradle, and run the app on a device or emulator. Debug builds default to `http://10.0.2.2:3000/api` for the emulator. Set `API_BASE_URL` for another debug endpoint. To build a debug APK for the emulator from PowerShell:

   ```powershell
   Push-Location apps/android
   .\gradlew.bat assembleDebug
   Pop-Location
   ```

   The APK is written to `apps/android/app/build/outputs/apk/debug/app-debug.apk`. This debug APK is for development/testing and defaults to the emulator's local API; it is not suitable for distribution. Release builds require HTTPS and use the separate `RELEASE_API_BASE_URL` Gradle property, for example `-PRELEASE_API_BASE_URL=https://attendance.example.com/api`; replace the example URL and configure release signing before distributing a release. The API's `ADMIN_WEB_ORIGIN` must match the dashboard origin.

## Hostinger Node.js deployment

Deploy both apps through one Hostinger Node.js website. The root entry script serves the admin dashboard at `/` and forwards `/api/*` requests to the API.

In Hostinger, use the repository root (`/`) as the root directory, Node.js 20.9 or newer, `npm run build` as the build command, and `hostinger-start.cjs` as the entry file. Leave the output directory empty. Hostinger supplies `PORT`.

Configure `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_NAME`, `ADMIN_PASSWORD`, and `ADMIN_WEB_ORIGIN` in the website's environment variables. Use Supabase's pooled connection for `DATABASE_URL` and its session-mode connection for `DIRECT_URL`. Set `ADMIN_WEB_ORIGIN` to the exact HTTPS origin of this same Hostinger website, and set `NEXT_PUBLIC_API_URL` to that origin followed by `/api` (for example, `https://your-domain.example/api`) before building. `LOCATION_RETENTION_DAYS` is optional and defaults to `90`; `SUPABASE_URL` and `SUPABASE_API_KEY` are not used by this app.

The admin route map uses OpenStreetMap tiles and displays required contributor attribution. For small deployments it uses the public OSM tile service; follow its tile usage policy and choose a suitable hosted tile provider if traffic grows. Optional address lookup can be configured at dashboard build time with `NEXT_PUBLIC_REVERSE_GEOCODING_URL`. It must be an HTTPS, browser-accessible (CORS-enabled) endpoint that accepts `GET ?lat=<latitude>&lon=<longitude>` and returns JSON containing a non-empty `display_name` string. `NEXT_PUBLIC_` values are public, so do not include private API keys in this URL. Address lookup is off until an administrator clicks the lookup button; that action sends only the route's start and end coordinates to this endpoint. Coordinates remain displayed if lookup is not configured or fails.

After the API is deployed, apply the schema and create the initial superadmin once, using the API's `DATABASE_URL` and admin variables in `apps/api/.env`:

```powershell
npm run db:push
npm run prisma:seed-admin
```

For later releases that change `apps/api/prisma/schema.prisma`, apply the schema update against the deployment database before relying on the changed API. The admin audit log requires the `AdminAuditLog` table; run `npm run db:push` with the deployment database credentials, then deploy/restart the app. Do not run `prisma:seed-admin` again unless you intentionally need to bootstrap or promote the configured superadmin.

Verify the dashboard loads at `https://<your-domain>/` and the API responds with `{"status":"ok"}` at `https://<your-domain>/api/health`. A successful build alone does not mean the application processes started.

## API outline

- `POST /api/auth/login`
- `GET /api/attendance/current`
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out`
- `POST /api/locations` (returns `204 No Content` on acceptance; delayed samples are allowed for up to 7 days)
- `GET /api/admin/employees`, `POST /api/admin/employees`, `PATCH /api/admin/employees/:id` (administrator or superadmin)
- `GET /api/admin/admins`, `POST /api/admin/admins`, `PATCH /api/admin/admins/:id` (superadmin only)
- `GET /api/admin/settings`, `PATCH /api/admin/settings` (superadmin only; location retention 1–3650 days)
- `GET /api/admin/shifts?from=<ISO>&to=<ISO>&page=1&pageSize=50&search=<employee>&status=all|active|completed` (administrator or superadmin; page size is capped at 100)
- `GET /api/admin/shifts/route?shiftId=<id>` (administrator or superadmin)
- `GET /api/admin/audit?page=1&pageSize=50` (superadmin only)

The attendance page searches employee name/email server-side, filters active/completed shifts, and exports matching shift rows to CSV (up to 5,000 per export). Route details include an OpenStreetMap view, start/end locations, a per-point list, and a downloadable route CSV with timestamps, coordinates, accuracy, device-reported mock flags, segment estimates, and shift-level quality diagnostics. Coverage is a heuristic: limited means fewer than two points, a gap over 30 minutes, or average accuracy worse than 70 metres; partial means a gap over 10 minutes or average accuracy worse than 35 metres. This is not evidence that a complete journey was captured. Distances are straight-line GPS estimates, not road distances. The superadmin audit log records account creation/updates, password-reset events, and retention-setting changes; it stores no passwords or password hashes.

The admin date selector uses the browser's local day and sends explicit ISO time bounds; shifts are grouped by their local start day. Route coordinates are plotted in the browser over OpenStreetMap tiles; the map provider receives tile requests, not a route upload. If address lookup is configured, its endpoint receives the start/end coordinates only after an administrator chooses to look them up. A daily 02:00 UTC retention job deletes GPS samples older than the superadmin-configured retention period (initially `LOCATION_RETENTION_DAYS`, default 90; allowed range 1–3650) and clears precise check-in/out coordinates for closed shifts older than that period. Attendance timestamps and the estimated distance total for closed shifts remain; the detailed route points do not.

## Before production

This is an MVP foundation, not a production-certified workforce or security system. Deploy behind HTTPS, use managed secrets and backups, review applicable employee privacy and labor laws, and add operational monitoring and account recovery. On-device encrypted storage queues up to 1,000 location samples and retries while network is available; samples older than the server's 7-day upload window are rejected. BYOD tracking can be stopped by disabling permissions, force-stopping the app, or leaving the phone behind; treat missing or suspicious samples as review signals, not proof of misconduct.
