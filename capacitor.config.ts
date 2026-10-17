// TrustWeb for iPhone (wave 12): a Capacitor shell with the web app BUNDLED (apps/trustweb/dist, built with TW_BASE=/ and
// VITE_TW_NATIVE=1), unlike the Android shell (android/), which opens app.trustweb.one. Project: ios/ (Swift Package Manager,
// `npx cap sync ios` after every web build). The app talks to app.trustweb.one for the relay, backups and hosted services
// (apps/trustweb/src/native_app.ts SERVER_ORIGIN); CapacitorHttp routes fetch() natively, so the capacitor://localhost origin
// needs no CORS on the server. The WebSocket drain is not touched by it (WebSockets are not subject to CORS).
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'one.trustweb.app',
  appName: 'TrustWeb',
  webDir: 'apps/trustweb/dist',
  ios: { scheme: 'TrustWeb', contentInset: 'automatic' },
  plugins: {
    CapacitorHttp: { enabled: true },
    // A push that arrives while the app is in front shows nothing: the open drain already delivered the wire to the page.
    PushNotifications: { presentationOptions: [] },
  },
}

export default config
