/**
 * Wave 12: the iPhone app (ios/, Capacitor) carries this web app BUNDLED, so the page's origin is capacitor://localhost and
 * nothing of TrustWeb's server is there. Everything that reaches the server (the relay, backups, hosted recordings,
 * transcription, short links, connect codes, the organizer) goes to SERVER_ORIGIN instead; in a browser that is the page's
 * own origin, as before. Capacitor's bridge is read from the window it injects (no import: this app has no node_modules).
 */
interface CapacitorBridge {
  isNativePlatform?(): boolean
  Plugins?: Record<string, unknown>
}

export const capacitor = (): CapacitorBridge | undefined => (globalThis as { Capacitor?: CapacitorBridge }).Capacitor

/** Inside the iPhone app. */
export const nativeApp: boolean = capacitor()?.isNativePlatform?.() === true

export const LIVE_SERVER = 'https://app.trustweb.one'

/** The TrustWeb server this page talks to. */
export const SERVER_ORIGIN: string = nativeApp ? LIVE_SERVER : typeof location !== 'undefined' ? location.origin : ''

/** A root-relative request URL ("/backup/health") rewritten for the server; anything else untouched. Pure. */
export function serverUrl(input: string, server = SERVER_ORIGIN): string {
  return input.startsWith('/') && !input.startsWith('//') ? server + input : input
}

/**
 * In the app, fetch('/backup/...'), fetch('/org/...') and the like must reach the server, not the bundle: one wrapper at boot
 * instead of a server argument in every module. Wraps whatever fetch is installed (Capacitor's native one), so no CORS.
 */
export function routeFetchToServer(): void {
  if (!nativeApp) return
  const inner = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (input, init) => inner(typeof input === 'string' ? serverUrl(input) : input, init)
}
