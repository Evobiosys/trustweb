// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 26 (R52): per-device sync mode, stored on the device only like the layout, never in the record and never synced. 'phoneHolds' = this device only receives; the phone is the holder and always sends. */
export const SYNC_MODE_KEY = 'trustweb.ui.syncmode'
export type SyncMode = 'mirror' | 'phoneHolds'
type Store = Pick<Storage, 'getItem' | 'setItem'>

export function readSyncMode(st: Store = localStorage): SyncMode {
  try { return st.getItem(SYNC_MODE_KEY) === 'phoneHolds' ? 'phoneHolds' : 'mirror' } catch { return 'mirror' }
}

export function writeSyncMode(mode: SyncMode, st: Store = localStorage): void {
  try { st.setItem(SYNC_MODE_KEY, mode) } catch { /* not remembered */ }
}

export const shouldSend = (mode: SyncMode, layoutIsPhone: boolean): boolean => mode !== 'phoneHolds' || layoutIsPhone
