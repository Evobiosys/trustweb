// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Connect Google behind a flag (wave 40). Off by default; on by the switch in Settings > Advanced > Flags, or as soon as a client id is
 * configured. Also the dismissible "you can leave Google later" nudge. Pure: the store is injected, blocked storage = off / not remembered.
 */
import type { KeyValueStore } from './google_contacts'

export const GOOGLE_FLAG_KEY = 'tw-google-connect'
export const NUDGE_KEY = 'tw-google-nudge-dismissed'

/** The switch itself, as stored. */
export function googleFlagSet(store: KeyValueStore): boolean {
  try { return store.getItem(GOOGLE_FLAG_KEY) === '1' } catch { return false }
}

/** Review wave 40: switched off in Flags = off, whatever client id is stored; never switched = on once a client id is configured. */
export function googleConnectOn(store: KeyValueStore, clientId: string | null): boolean {
  let raw: string | null = null
  try { raw = store.getItem(GOOGLE_FLAG_KEY) } catch { return false }
  return raw === '1' || (raw !== '0' && !!clientId?.trim())
}

export function setGoogleConnect(store: KeyValueStore, on: boolean): void {
  try { store.setItem(GOOGLE_FLAG_KEY, on ? '1' : '0') } catch { /* not remembered */ }
}

/** Shown while connected (a token exists) until the owner dismisses it; the dismissal outlives the token. */
export function nudgeShown(store: KeyValueStore, token: string | null): boolean {
  if (!token) return false
  try { return store.getItem(NUDGE_KEY) !== '1' } catch { return true }
}

export function dismissNudge(store: KeyValueStore): void {
  try { store.setItem(NUDGE_KEY, '1') } catch { /* not remembered */ }
}
