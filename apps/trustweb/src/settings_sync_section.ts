// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-settings-sync: what the Sync section at the bottom of Settings holds. Device sync, then the Obsidian and Tana entries (on a phone those two sit under Advanced, wave 43 rule). */
import { syncEnv, syncPlacement } from './sync_capability'
import type { SyncEnv } from './sync_capability'

export function syncSectionParts<T>(o: { eligible: boolean; devices: () => T[]; entries: () => T[]; env?: SyncEnv }): { main: T[]; advanced: T[] } {
  const devices = o.eligible ? o.devices() : []
  const entries = o.entries()
  return syncPlacement(o.env ?? syncEnv()).obsidian === 'main' ? { main: [...devices, ...entries], advanced: [] } : { main: devices, advanced: entries }
}
