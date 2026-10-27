/**
 * Wave 20 (qr-replay-guard, Jakob 2026-10-23: "a real-time but not in-person fix"): a connect link the app shows carries a nonce and the
 * time it was issued; the receiving phone refuses one older than the window or one it has seen. This proves freshness and single use,
 * NOT that the two people stand together. Pure: the clock and the random bytes are arguments.
 *
 * The public address (/c/<code>, /who/<name>) is NOT one-time: it stays reusable, so the link registered under it carries no stamp.
 * A link from an older app has no stamp either: accepted, flagged `legacy` (the caller records connectedVia 'legacy-code').
 */

/** One window for a code on screen and a link sent by messenger: the app cannot tell them apart. */
export const CONNECT_WINDOW_MS = 24 * 60 * 60 * 1000
/** A clock this far ahead of ours is still believed (a little drift between two phones). */
const CONNECT_SKEW_MS = 5 * 60 * 1000
const NONCE_RE = /^[A-Za-z0-9_-]{16,64}$/

export interface Stamp { nonce?: string; issuedAt?: number }
/** What check() reads from a received link; `exempt`: reusable by design (came through /c/<code>, /who/<name>, a bare DID) or an invitation this phone already holds. */
export interface Stamped extends Stamp { exempt?: true }
export interface SeenNonce { nonce: string; at: number }
export type Verdict = { ok: true; legacy: boolean } | { ok: false; reason: 'expired' | 'replayed' }

/** A fresh stamp: 12 random bytes (96 bit) as base64url, and the time. */
export function issue(now: number, bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(12))): { nonce: string; issuedAt: number } {
  return { nonce: btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), issuedAt: now }
}

/** The link with nonce= and ts= added; every other parameter stays, so the existing parsers read it unchanged. */
export function stampUrl(url: string, stamp: { nonce: string; issuedAt: number }): string {
  const u = new URL(url)
  u.searchParams.set('nonce', stamp.nonce)
  u.searchParams.set('ts', String(stamp.issuedAt))
  return u.toString()
}

/**
 * The long link as issued: stamped while it expires (the default), unchanged when the owner chose "never expires" (a persistent link).
 * The receiver reads an unstamped link as `legacy` and records connectedVia 'legacy-code' (kept: no new reason for the persistent link).
 */
export const issueLink = (url: string, expiring: boolean, now: number, bytes?: Uint8Array): string => (expiring ? stampUrl(url, issue(now, bytes)) : url)

/** The stamp in a query string; empty when absent or unreadable (check() then refuses a half one). */
export function readStamp(search: string): Stamp {
  const p = new URLSearchParams(search)
  const nonce = p.get('nonce')
  const ts = Number(p.get('ts'))
  return nonce !== null && NONCE_RE.test(nonce) && p.get('ts') !== null && Number.isFinite(ts) ? { nonce, issuedAt: ts } : {}
}

export function check(link: Stamped, seen: readonly SeenNonce[], now: number): Verdict {
  if (link.exempt) return { ok: true, legacy: false }
  if (link.nonce === undefined && link.issuedAt === undefined) return { ok: true, legacy: true }
  const { nonce, issuedAt } = link
  if (nonce === undefined || issuedAt === undefined || issuedAt > now + CONNECT_SKEW_MS || now - issuedAt > CONNECT_WINDOW_MS) return { ok: false, reason: 'expired' }
  return seen.some((s) => s.nonce === nonce) ? { ok: false, reason: 'replayed' } : { ok: true, legacy: false }
}

/** Entries past the window can never matter again (their link would be expired): dropped. */
export const prune = (seen: readonly SeenNonce[], now: number): SeenNonce[] => seen.filter((s) => now - s.at <= CONNECT_WINDOW_MS)

/** The ledger with `nonce` added, pruned. */
export const remember = (seen: readonly SeenNonce[], nonce: string, now: number): SeenNonce[] => [...prune(seen, now), { nonce, at: now }]
