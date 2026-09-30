# Mobile App Management module

Admin: **System → Mobile App** (admin & super_admin only).

## Files

```
models/MobileAppSettings.js          collection `mobile_app_settings`: defaults, validation, version compare
services/mobileApp.js                read/update the singleton doc (jsonDb -> MongoDB)
controllers/mobileAppController.js   public + admin handlers
routes/mobileApp.js                  PUBLIC   GET /api/mobile-app, GET /api/mobile-app/version
routes/admin/mobile-app.js           ADMIN    GET/PUT /api/admin/mobile-app  (mobile_app:view / mobile_app:edit)
routes/adminRoutes.js                + mounts /mobile-app
app.js                               + mounts /api/mobile-app
config/permissions.js                + 'mobile_app:*' for admin (super_admin has '*')
public/admin/js/config.js            + 'mobile_app:*' in the browser-side role mirror
public/admin/dashboard.html          + sidebar item "Mobile App" and <script src="js/mobile-app.js">
public/admin/js/mobile-app.js        admin form + live banner preview
public/admin/js/navigation.js        + 'mobile-app' section
public/js/mobile-app-banner.js       homepage banner logic
index.html, style.css                banner markup + styles
images/app-icon.png                  banner icon (the app's launcher icon)
routes/appVersion.js                 legacy /api/app/version now reads the same settings
routes/appDownload.js                /download-app falls back to this APK URL
```

Note: the app has no runtime mongoose connection (only `scripts/` connect), so the model
lives on the existing `jsonDb` layer — same MongoDB, same as every other feature.

## API

`GET /api/mobile-app` (public)
```json
{ "success": true, "appName": "...", "version": "1.0.0", "apkUrl": "https://...apk",
  "releaseNotes": "...", "forceUpdate": false, "showBanner": true,
  "bannerTitle": "...", "bannerDescription": "...", "buttonText": "Download App", "updatedAt": null }
```

`GET /api/mobile-app/version` (public)
```json
{ "success": true, "latestVersion": "1.0.0", "apkUrl": "https://...apk", "forceUpdate": false, "releaseNotes": "..." }
```

`PUT /api/admin/mobile-app` (Bearer admin token) — any subset of the fields.
Rules: `version` like `1.0.0`; `apkUrl` must be `https://`; booleans must be real booleans;
length limits per field; unknown fields ignored. 401 without login, 403 for non-admin roles.

## Releasing a new app version

1. `pubspec.yaml`: `version: 1.0.1+2` -> `flutter build apk --release`.
2. Upload the APK to R2 (same path replaces the old one).
3. Admin -> Mobile App: version `1.0.1`, release notes, (optional) Force Update -> Save.
4. Users on an older version see the update dialog at next app launch.

Force Update ON = every installed version older than `version` cannot dismiss the dialog.

## Flutter (already applied in the app project)

```
lib/core/constants/api_constants.dart      appVersion -> /api/mobile-app/version
lib/models/app_update_info.dart            forceUpdate + apkUrl, version compare
lib/services/update_checker_service.dart   check on launch, force logic
lib/services/apk_installer_service.dart    NEW: download APK + open Android installer
lib/widgets/update_dialog.dart             progress bar, Later / Update Now / Cancel / Open in browser
android/app/src/main/AndroidManifest.xml   + REQUEST_INSTALL_PACKAGES
test/app_update_info_test.dart             NEW
```
`main.dart` and the provider are unchanged: they already show `UpdateDialog` when the check returns a result.

## Things to know

* `https://pub-...r2.dev` is Cloudflare's development URL (rate limited, no SLA). For a real
  student base connect a custom domain to the bucket (e.g. files.chawlaclasses.in) and paste
  that APK URL in Admin -> Mobile App.
* Android accepts an update only if it is signed with the same key as the installed app.
* In-app APK install is for direct distribution. Google Play does not allow it — if the app
  moves to Play, remove REQUEST_INSTALL_PACKAGES and set the APK URL to the Play listing.
