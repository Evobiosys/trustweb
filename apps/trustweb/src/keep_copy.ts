// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-settings-sync: "Keep a copy on this device". When the last copy (a file or the server backup) is older than 7 days, the browser's own leave-page popup reminds once per stale period; never otherwise. */

export const COPY_STALE_MS = 7 * 86_400_000
const AT = 'trustweb.ui.keepcopy.at'
const WARNED = 'trustweb.ui.keepcopy.warned'
const OFFERED = 'trustweb.ui.keepcopy.offered'

type Store = Pick<Storage, 'getItem' | 'setItem'>
const num = (s: Store, k: string): number => { try { return Number(s.getItem(k)) || 0 } catch { return 0 } }
const put = (s: Store, k: string, v: string): void => { try { s.setItem(k, v) } catch { /* not remembered */ } }

/** The newest of the file copy, the server backup and the first run with this feature (a grace period of 7 days for a first-time user; ms, 0 = none). */
export const lastKept = (s: Store, backupAt = 0): number => Math.max(num(s, AT), backupAt, num(s, OFFERED))
export const markCopy = (s: Store, now: number): void => put(s, AT, String(now))
export const markWarned = (s: Store, now: number): void => put(s, WARNED, String(now))
export const wasOffered = (s: Store): boolean => { try { return s.getItem(OFFERED) !== null } catch { return true } }
export const markOffered = (s: Store, now: number): void => put(s, OFFERED, String(now))

/** Stale and not yet warned in this stale period. Nothing to lose (no data) = no warning. */
export function shouldWarn(o: { hasData: boolean; lastKept: number; warnedAt: number; now: number }): boolean {
  return o.hasData && o.now - o.lastKept > COPY_STALE_MS && o.warnedAt <= o.lastKept + COPY_STALE_MS
}
export const stale = (o: { lastKept: number; now: number }): boolean => o.now - o.lastKept > COPY_STALE_MS

/** Registers the leave-page reminder; the browser shows its own text. */
export function guardLeaving(s: Store, o: { hasData: () => boolean; backupAt: () => number; now?: () => number }): void {
  window.addEventListener('beforeunload', (e) => {
    const now = (o.now ?? Date.now)()
    if (!shouldWarn({ hasData: o.hasData(), lastKept: lastKept(s, o.backupAt()), warnedAt: num(s, WARNED), now })) return
    markWarned(s, now)
    e.preventDefault()
    e.returnValue = ''
  })
}
