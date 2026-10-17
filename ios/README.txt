TrustWeb for iPhone (wave 12, 2026-10-16)
--------
What it is: a Capacitor app (Swift Package Manager, no CocoaPods) with the web app BUNDLED: apps/trustweb/dist is copied into
App/App/public by `npx cap sync ios`, and the phone runs it from there. Recording, notes, the rings and the record itself work
offline; the relay, backups, hosted recordings, transcription, short links and the organizer are reached at
https://app.trustweb.one when there is a connection (apps/trustweb/src/native_app.ts). Unlike the Android app (android/,
which opens the live site), a new web build needs a new app build here.

Files
  ../capacitor.config.ts             app id one.trustweb.app, webDir, CapacitorHttp (fetch goes native: no CORS for capacitor://localhost)
  App/App/Info.plist                 camera and microphone texts, remote-notification background mode, version from MARKETING_VERSION
  App/App/App.entitlements           aps-environment (push) and the App Group; Xcode switches aps to production in an archive
  App/TrustWebNotify/                the Notification Service Extension (see Notifications below)
  App/App/AppDelegate.swift          hands the APNs token to Capacitor's PushNotifications plugin
  App/App/Assets.xcassets            AppIcon (1024, no alpha, from apps/trustweb/pwa/icons/icon-maskable-512.png), Splash (android/ splash.png)
  App/CapApp-SPM/Package.swift       written by `cap sync` (the plugin list); do not edit
  ../.github/workflows/ios-smoke.yml builds for the simulator and launches it (no signing); the .app is an artifact

Notifications (apps/trustweb/src/native_push.ts, packages/transport/src/apns_push.ts)
  The app registers with APNs and sends its device token to the relay over the authenticated drain ({apns: <hex>}). When a
  wire waits and the app is closed (it closes its drain the moment it goes to the background), the relay POSTs ONE constant
  alert to Apple: title TrustWeb, "Something arrived for you", no sender, kind or count. Apple sees the device and the
  moment, never the content. The relay needs the credentials file apns.json next to its queue db (~/wot-relay/data/ on
  questhub, mode 0600, RELAY_APNS_FILE to override):
    { "keyId": "ABCDE12345", "teamId": "TEAM123456", "topic": "one.trustweb.app",
      "privateKey": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n", "sandbox": false }
  keyId/privateKey: Apple Developer > Certificates, Identifiers & Profiles > Keys > + > Apple Push Notifications service
  (APNs), download the .p8 once. teamId: Membership. "sandbox": true while the phone runs an Xcode build; the relay also
  retries the other environment once on BadDeviceToken. Without the file the relay answers push_rejected and the app says
  "this relay cannot wake iPhones yet".
  Before the alert shows, iOS runs the app's Notification Service Extension (App/TrustWebNotify, target TrustWebNotify,
  bundle id one.trustweb.app.notify): it reads the push bundle the web app keeps in the App Group group.one.trustweb.app
  (App/App/PushBundleStore.swift, written through the app-local plugin TrustWebPushBundlePlugin.swift), opens the relay
  drain in peek mode, reads the waiting wires under the pair keys (TrustWebWire.swift mirrors apps/demo/src crypto, did and
  relay framing with CryptoKit) and puts the real words in: "<name> sent you a message." Apple carried the fixed words only.
  No network or no bundle: the fixed words stay. A kind switched off also shows the fixed words (dropping a notification
  needs Apple's filtering entitlement: roadmap). The App Group and Push Notifications capabilities must exist on both the
  app id and the extension id in the developer account (Xcode's automatic signing registers them).

Build on a Mac with Xcode (none on this Mac today; the workflow is the reference build)
  cd apps/trustweb && TW_BASE=/ VITE_TW_SITE_URL=https://trustintheweb.org ../crm/node_modules/.bin/vite build --outDir dist --emptyOutDir
  cd ../.. && npx cap sync ios && npx cap open ios        (or: open ios/App/App.xcodeproj)
  Simulator: Product > Run. Phone: set the Team under Signing & Capabilities once (automatic signing), add the Push
  Notifications capability if Xcode did not pick it from App.entitlements, run.

App Store (once the Apple Developer account exists)
  1. App Store Connect > My Apps > + : name TrustWeb, bundle id one.trustweb.app (register the identifier with Push Notifications on).
  2. Xcode: Product > Archive (Any iOS Device), then Distribute App > App Store Connect > Upload. Or from a shell:
       xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' \
         -archivePath build/TrustWeb.xcarchive archive DEVELOPMENT_TEAM=<team id>
       xcodebuild -exportArchive -archivePath build/TrustWeb.xcarchive -exportPath build/export -exportOptionsPlist ios/ExportOptions.plist
       (ExportOptions.plist: method app-store-connect, teamID; upload build/export/*.ipa with Transporter.app or
        `xcrun altool --upload-app -f build/export/App.ipa -t ios --apiKey <key id> --apiIssuer <issuer id>`)
  3. TestFlight first (internal testers need no review), then submit for review. Review notes: the app needs no account; a
     reviewer can create a web and connect two devices through the relay; notifications arrive only when another phone writes.
  4. Versions: MARKETING_VERSION in App/App.xcodeproj/project.pbxproj (0.2.5 now, matches the next release tag), CURRENT_PROJECT_VERSION
     bumped on every upload. A CI release lane (macOS runner, certificate + profile as secrets, like android-release.yml) is roadmap.

Data
  The record lives in the WKWebView's storage of the app (localStorage per origin). An App Store update keeps it; deleting the
  app deletes it, and a browser's app.trustweb.one record does not move in by itself: "Restore from a backup" is the way over.
