/**
 * A guest account stays (wave 6, U4 f / N5; Jakob 2026-10-07 18:31: "a demo/guest account stays active until the person deletes it: it is
 * an initial entry, not a demo"). A DemoAccount made from the QR button ends after a week; one the person makes their personal account
 * (Settings > "Make it your personal account" on the guest's phone) or that the owner marks "Keep this account" stays until they leave.
 *
 * HARD GUARD (tests): nothing changes for an account that is not kept. A record without `keep` reads and expires exactly as before (an
 * account made before expiry existed still reads as a week after creation); `keep` is an optional field on the owner's record, `kept` and
 * `keepAsked` optional fields on the guest's, and a kept account's `expiresAt` is moved far out so that even an older build, which ignores
 * `keep`, would not take it down. Two small texts travel inside the encrypted chat envelope of the paired peer (never in the connect-ack):
 *   guest -> owner  <app url>?keep=ask     "I made this my personal account"
 *   owner -> guest  <app url>?keep=yes     "it stays" (sent when the owner keeps it, now or on the guest's ask)
 * An older build shows neither text anywhere. Pure and DOM-free.
 */
import type { DemoAccount, DemoOf } from './model'

/** The text parameter. */
export const KEEP_PARAM = 'keep'

export enum KeepNotice {
  /** The guest asks that the account stays. */
  Ask = 'ask',
  /** The owner says it stays. */
  Yes = 'yes',
}

const NOTICES: readonly string[] = [KeepNotice.Ask, KeepNotice.Yes]

/** A kept account's stored end: far out, so a build that does not know `keep` still keeps it. */
export const KEPT_HORIZON_MS = 100 * 365 * 86_400_000

/** The text for one notice. */
export function keepText(appUrl: string, notice: KeepNotice): string {
  return `${appUrl}?${KEEP_PARAM}=${notice}`
}

/** Does this text claim to be a keep notice (whether or not it is well formed)? */
export function isKeepText(appUrl: string, text: string): boolean {
  return typeof text === 'string' && text.startsWith(`${appUrl}?${KEEP_PARAM}=`)
}

/** The notice a text carries; null for anything else, including a lookalike with more after it. */
export function parseKeepText(appUrl: string, text: string): KeepNotice | null {
  if (!isKeepText(appUrl, text)) return null
  const word = text.slice(`${appUrl}?${KEEP_PARAM}=`.length)
  return NOTICES.includes(word) ? (word as KeepNotice) : null
}

/** Is this account kept until the person leaves? Only the exact value `true` counts. */
export function isKept(acct: Pick<DemoAccount, 'keep'>): boolean {
  return acct.keep === true
}

/** The accounts that are due to be taken down: not kept, and past their end (`endOf` gives the end, older accounts included). */
export function dueForTakeDown<T extends Pick<DemoAccount, 'keep'>>(accounts: readonly T[], now: number, endOf: (a: T) => number): T[] {
  return accounts.filter((a) => !isKept(a) && endOf(a) <= now)
}

/** Keeps the account; true when this changed it. Idempotent. The stored end moves far out (see the header). */
export function keepAccount(acct: DemoAccount, now: number): boolean {
  if (isKept(acct)) return false
  acct.keep = true
  acct.expiresAt = now + KEPT_HORIZON_MS
  return true
}

/** Back to a demo account: a fresh week from `now`. True when this changed it. */
export function unkeepAccount(acct: DemoAccount, now: number, lifetimeMs: number): boolean {
  if (!isKept(acct)) return false
  delete acct.keep
  acct.expiresAt = now + lifetimeMs
  return true
}

/** The guest's phone: has it already asked, and is its account kept? */
export function guestAsked(t: Pick<DemoOf, 'keepAsked'>): boolean {
  return t.keepAsked === true
}

export function guestKept(t: Pick<DemoOf, 'kept'>): boolean {
  return t.kept === true
}

/** The guest asks (once): marks the record so the button reads "asked". True when it newly asked. */
export function guestAsk(t: DemoOf): boolean {
  if (guestAsked(t) || guestKept(t)) return false
  t.keepAsked = true
  return true
}

/** The owner said it stays: the guest's own end goes, the labels read "your account". True when this changed it. */
export function guestGranted(t: DemoOf): boolean {
  if (guestKept(t)) return false
  t.kept = true
  delete t.expiresAt
  delete t.keepAsked
  return true
}

/** Is the guest's account over by the clock? Never when kept or when the link carried no end. */
export function guestEnded(t: Pick<DemoOf, 'kept' | 'expiresAt'>, now: number): boolean {
  return !guestKept(t) && typeof t.expiresAt === 'number' && t.expiresAt - now <= 0
}
