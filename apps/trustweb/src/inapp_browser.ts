// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-inapp-browser. A connect link opened inside Telegram, Instagram, Facebook, WhatsApp or LinkedIn runs in that app's own web
 * view: its storage is separate from Safari/Chrome and from the installed app. The connect completes there (chat works over the relay),
 * but the person never reaches the real web. The link itself (query + fragment) is the whole pending connect, so opening the SAME link in
 * the real browser completes it, no server involved. Pure; the storage is an argument.
 */

export interface InApp { app: string; os: 'ios' | 'android' | 'other' }

const MARKERS: readonly [RegExp, string][] = [
  [/Telegram/i, 'Telegram'], [/Instagram/i, 'Instagram'], [/FBAN|FBAV|FB_IAB|FBIOS/, 'Facebook'],
  [/WhatsApp/i, 'WhatsApp'], [/LinkedInApp/i, 'LinkedIn'],
]

/**
 * The app whose web view this is, or null in a real browser. An iPhone web view has no `Safari/` token and Telegram on iOS sends no
 * marker at all, so that case reads as an in-app browser with an empty app name. An installed home-screen app has no token either: `standalone`.
 */
export function inAppBrowser(ua: string, standalone = false): InApp | null {
  const os = /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Android/.test(ua) ? 'android' : 'other'
  const hit = MARKERS.find(([re]) => re.test(ua))
  if (hit) return { app: hit[1], os }
  if (os === 'ios' && !standalone && !/Safari\/|CriOS|FxiOS|EdgiOS/.test(ua)) return { app: '', os }
  return null
}

/** Android: opens the link in the default browser; the fallback keeps the plain link if no browser takes the intent. */
export function androidIntentUrl(href: string): string {
  const u = new URL(href)
  return `intent://${u.host}${u.pathname}${u.search}${u.hash}#Intent;scheme=${u.protocol.slice(0, -1)};S.browser_fallback_url=${encodeURIComponent(href)};end`
}

export const PENDING_KEY = 'tw.inapp.pending'
/** A link is good for 24 h (connect_freshness.ts), so the note outlives it by nothing. */
export const PENDING_MAX_MS = 24 * 60 * 60 * 1000
export interface Pending { href: string; name: string; at: number }
interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

export function rememberPending(s: Store, p: { href: string; name: string }, now: number): void {
  s.setItem(PENDING_KEY, JSON.stringify({ ...p, at: now }))
}

/** The connect still waiting for the real browser, or null (none, junk, or past its window; the stale one is dropped). */
export function readPending(s: Store, now: number): Pending | null {
  try {
    const p = JSON.parse(s.getItem(PENDING_KEY) ?? 'null') as Partial<Pending> | null
    if (p && typeof p.href === 'string' && typeof p.name === 'string' && typeof p.at === 'number' && now - p.at <= PENDING_MAX_MS) return p as Pending
  } catch { /* junk reads as none */ }
  s.removeItem(PENDING_KEY)
  return null
}
