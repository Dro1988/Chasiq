# Chasiq Android — Build Note

Built 2026-10-12 (America/New_York).

## Deliverable

- **APK:** `~/workspace/diecast-app/android/Chasiq.apk`
- **Size:** 128,935 bytes (128K on disk)
- **APK SHA-256:** `a04f11ca70a9482ebf6ddc09cd4a715a9f5a26f2dd377c5d6babaebbc2d38419`
- **Package / applicationId:** `com.chasiq.app`
- **App name:** Chasiq
- **Version:** versionName `1.0`, versionCode `1`
- **Launchable activity:** `com.chasiq.app.MainActivity`
- **SDK levels:** minSdk 26, targetSdk 36, compileSdk 36

## What was built

A minimal native Android shell with **zero third-party dependencies** (Android framework only):

- Plain `Activity` + `WebView` loading `https://chasiq.onrender.com` full-screen.
- JavaScript, DOM storage and database enabled; media playback does not require a user gesture.
- `WebChromeClient.onShowFileChooser` wired to an activity-result file picker, so the web app's `<input type="file" accept="image/*">` photo flows work.
- `WebChromeClient.onPermissionRequest`: grants `VIDEO_CAPTURE` / `AUDIO_CAPTURE` to the page only for media whose Android runtime permission is held; if CAMERA (or RECORD_AUDIO) is missing, Android is asked for it and the pending web request is then granted/denied from `onRequestPermissionsResult`. This is what lets the in-page barcode scanner use `getUserMedia`.
- Link policy in `shouldOverrideUrlLoading`: `chasiq.onrender.com`, `*.wikia.nocookie.net` and `wsrv.nl` / `*.wsrv.nl` stay in the WebView; other http(s) links and app schemes open externally.
- Android back navigates WebView history first, then finishes the activity.
- Downloads go to Android `DownloadManager` (public Downloads folder, cookies + user-agent forwarded), with a browser hand-off fallback.
- Dark theme: window/status/navigation background `#0B0C0E`, NoActionBar.
- Original launcher icon: amber-orange gradient (`#FFB03A → #FF6A00`) rounded square with a bold white italic “C”, generated programmatically (Python PIL) at mdpi–xxxhdpi, plus an adaptive-icon XML using a gradient background drawable and a transparent foreground “C”.

Source lives in `~/workspace/diecast-app/android/src/main/` (`MainActivity.java`, `AndroidManifest.xml`, `res/`). Reproducible build script: `~/workspace/diecast-app/android/build-manual.sh`.

## Signing

- **Dedicated keystore:** `~/workspace/.tools/chasiq-release.keystore` (alias `chasiq`, RSA 4096, DN `CN=Chasiq, O=Chasiq, C=US`)
- **Password file:** `~/workspace/.tools/chasiq-keystore-pass.txt` (mode 600; value intentionally not recorded here). Note: the same dedicated password is stored on two lines because apksigner’s `file:` password source consumes one line for the store password and one for the key password.
- **Certificate SHA-256:** `c64c33ea83c24d27f14e52bcc7337e6716741ba99af28ebd882d73dc07f280fd`
- Keep the keystore and password file backed up: future Chasiq updates must be signed with this same key.

## Exact build steps (manual pipeline — no Gradle)

Gradle/sdkmanager cannot download in this sandbox (Java TCP is blocked), so the build uses the pre-downloaded toolchain under `~/workspace/.tools/` (JDK 21 at `jdk/jdk-21.0.12.1+1`, SDK at `android-sdk/`, build-tools **35.0.0** — 34.0.0’s D8 is avoided per prior NPEs):

1. Create the dedicated keystore with bundled `keytool` (RSA 4096, alias `chasiq`); write its password to the 600-mode password file. (One-time step; not repeated by the build script.)
2. `aapt2 compile --dir src/main/res` → resource `.flat` files.
3. `aapt2 link` with `platforms/android-36/android.jar`, minSdk 26 / targetSdk 36 / versionCode 1 / versionName 1.0 → `base.apk` + generated `R.java`.
4. `javac --release 17` of `MainActivity.java` + generated `R.java` against `android.jar` (no external jars — zero dependencies).
5. D8 (`build-tools/35.0.0/lib/d8.jar`, min-api 26) → `classes.dex`.
6. Insert `classes.dex` into the linked APK, `zipalign -p 4`.
7. `apksigner sign` with the dedicated keystore (passwords via `file:`), output directly to `~/workspace/diecast-app/android/Chasiq.apk`.

All steps are scripted in `build-manual.sh`; intermediates are in `~/workspace/.tools/chasiq-build/`.

## Verification evidence (run against the final signed APK)

- `unzip -l`: contains `AndroidManifest.xml` (3,304 bytes), `classes.dex` (15,648 bytes), `resources.arsc`, adaptive-icon XML and launcher PNGs at all densities.
- `aapt2 dump badging`:
  - `package: name='com.chasiq.app' versionCode='1' versionName='1.0'`
  - `application-label:'Chasiq'`
  - `launchable-activity: name='com.chasiq.app.MainActivity'`
  - Permissions: `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`, `RECORD_AUDIO`
- `dexdump` on the extracted `classes.dex` shows: `Class descriptor: 'Lcom/chasiq/app/MainActivity;'`
- `apksigner verify --verbose --print-certs`:
  - `Verifies`
  - v2 scheme: **true**; v3 scheme: **true**
  - Signer #1 DN: `CN=Chasiq, O=Chasiq, C=US`
  - Signer #1 certificate SHA-256: `c64c33ea83c24d27f14e52bcc7337e6716741ba99af28ebd882d73dc07f280fd`
  - Key: RSA, 4096 bits

## Not done / blockers

- No blocker hit. The APK has **not** been installed on a physical device in this run — verification above is static (badging, dex, signature). First on-device smoke test (launch, file upload, camera scanner permission flow, back button, an external link, a download) still needs a handset.
- This is an APK for direct install / internal distribution. A Play Store release would additionally need an AAB built from the same source and signed/uploaded through the Play pipeline.

## Shell v1.0.4 (2026-10-12, user request: back should navigate, not close)
- Web app now keeps a real history stack (web v23.4): every go() pushes a
  history entry; popstate steps back through tabs/details (and closes any
  open modal first). Browser back on the website works the same way.
- Shell: back handling unified in handleBack() — WebView.goBack() while
  history remains; at the root, "Press back again to exit" toast and a
  second press within 2s finishes. Registered via OnBackInvokedDispatcher
  (API 33+, PRIORITY_DEFAULT) with the legacy onBackPressed() override as
  the path for older versions; 350 ms dedupe covers dual delivery.
- versionCode 5 / versionName 1.0.4, UA token ChasiqShell/1.0.4.
- Verified: badging vc5/1.0.4, signing cert SHA-256 c64c33ea… (same as
  v1.0.3, installs as update), dex contains the toast string + UA token.
  On-device behaviour is user-tested (sandbox cannot run Android).
