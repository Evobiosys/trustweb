// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 sync-visibility: the Obsidian and Tana sections of the Import page; on a phone they sit inside one Advanced disclosure with a one-line hint. */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'
import { syncEnv, syncPlacement } from './sync_capability'
import type { SyncEnv } from './sync_capability'

export function syncSections(obsidian: readonly HTMLElement[], tana: readonly HTMLElement[], env: SyncEnv = syncEnv()): Node[] {
  if (syncPlacement(env).obsidian === 'main') return [...obsidian, ...tana]
  return [el('details', { class: 'settings-advanced-all sync-advanced', 'data-sync-advanced': '' }, [
    el('summary', { class: 'settings-group-title' }, [S.setAdvanced]),
    el('p', { class: 'meta', 'data-sync-phone-hint': '' }, [S.syncPhoneHint]),
    ...obsidian, ...tana,
  ])]
}
