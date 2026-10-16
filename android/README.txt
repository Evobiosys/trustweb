TrustWeb for Android (wave 11, 2026-10-16)
--------
What it is: a Trusted Web Activity (TWA). The APK opens https://app.trustweb.one/ full screen in the phone's own
Chrome (or any browser offering Custom Tabs); the app's code and data stay on the web origin, exactly as in the browser
(storage is shared with Chrome's app.trustweb.one). What the APK adds: a home-screen icon, a splash screen, and
notifications while the app is closed (web push from the relay, shown as this app's own through DelegationService).

Files
  app/src/main/AndroidManifest.xml   the TWA wiring (launch URL, colours, splash, notification delegation)
  app/src/main/res/                  strings (asset_statements), colours from the PWA manifest, icons copied from apps/trustweb/pwa/icons
  app/build.gradle.kts               version from -PtwVersionName/-PtwVersionCode, signing from the environment
  ../.github/workflows/android-release.yml   builds, signs and publishes trustweb-<version>.apk on a v* tag
  ../scripts/android_keystore.sh     makes the release key once, prints the GitHub secrets, writes assetlinks.json

Pairing with the origin
  apps/trustweb/pwa/.well-known/assetlinks.json names the signing certificate's SHA-256. Served at
  https://app.trustweb.one/.well-known/assetlinks.json by the normal app deploy. Until it matches, Android shows the
  app with a browser bar on top ("running in Chrome"); with it, full screen.

Release
  1. once: scripts/android_keystore.sh --push-secrets   (key in ~/.config/trustweb/, secrets to the GitHub repo, assetlinks.json written; commit it)
  2. bump the version in package.json files, merge to main, deploy the app (assetlinks.json goes live with it)
  3. git tag v0.2.1 && git push origin v0.2.1   -> the workflow publishes the APK as a GitHub Release asset:
     https://trustweb.one/apk  (Caddy 302 -> github.com/Evobiosys/trustweb/releases/latest/download/trustweb.apk)

Local build (optional; the workflow is the reference build)
  JDK 17, Gradle 8.11+, Android SDK with platform 36: gradle -p android assembleRelease -PtwVersionName=0.2.1 -PtwVersionCode=201
