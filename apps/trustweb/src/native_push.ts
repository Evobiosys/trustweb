/**
 * Wave 12: notifications in the iPhone app. A WKWebView has no Web Push, so the device token comes from Capacitor's
 * PushNotifications plugin (APNs) and goes to the relay over the drain like a Web Push subscription does (net.ts setPush,
 * `{apns: <token>}`; relay: packages/transport/src/apns_push.ts). Apple allows no silent wake that shows something, so the
 * relay sends a constant alert with no sender, kind or count in it; the app reads what arrived once it is opened.
 */
import { capacitor, nativeApp } from './native_app'
import type { PushSubscriptionJson } from './net'

type Grant = 'granted' | 'denied' | 'prompt' | 'prompt-with-rationale'

interface PushPlugin {
  checkPermissions(): Promise<{ receive: Grant }>
  requestPermissions(): Promise<{ receive: Grant }>
  register(): Promise<void>
  addListener(event: 'registration', cb: (token: { value: string }) => void): Promise<unknown>
  addListener(event: 'registrationError', cb: (error: { error: string }) => void): Promise<unknown>
}

const plugin = (): PushPlugin | null => (nativeApp ? ((capacitor()?.Plugins?.PushNotifications as PushPlugin | undefined) ?? null) : null)

export function nativePushAvailable(): boolean {
  return plugin() !== null
}

/** Asks iOS once (the system sheet); later calls just read the answer. */
export async function nativePushPermission(): Promise<boolean> {
  const p = plugin()
  if (!p) return false
  try {
    const now = (await p.checkPermissions()).receive
    if (now === 'granted') return true
    if (now === 'denied') return false
    return (await p.requestPermissions()).receive === 'granted'
  } catch {
    return false
  }
}

const REGISTER_TIMEOUT_MS = 15_000
let token: Promise<string | null> | null = null

/** The APNs device token of this app install (Apple may change it: asked again at every boot, the relay keeps the latest). */
export async function registerNativePush(): Promise<{ ok: true; sub: PushSubscriptionJson } | { ok: false; why: 'denied' | 'failed' }> {
  const p = plugin()
  if (!p) return { ok: false, why: 'failed' }
  if (!(await nativePushPermission())) return { ok: false, why: 'denied' }
  token ??= new Promise<string | null>((resolve) => {
    const done = (v: string | null): void => { clearTimeout(timer); resolve(v) }
    const timer = setTimeout(() => done(null), REGISTER_TIMEOUT_MS)
    void p.addListener('registration', (t) => done(t.value))
    void p.addListener('registrationError', () => done(null))
    p.register().catch(() => done(null))
  })
  const value = await token
  if (!value) { token = null; return { ok: false, why: 'failed' } }
  return { ok: true, sub: { apns: value } }
}
