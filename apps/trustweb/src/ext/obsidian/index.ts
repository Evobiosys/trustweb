// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: read an Obsidian vault into the Import pipeline, re-sync only what changed, link a person to their note, and (opt-in)
 * let the owner's own AI find the people in all notes. Heavy: only this stub and the small data file (obsidian_data.ts) are in the main bundle;
 * the page, the worker, the cache and the rules load with the module (obsidian_body.ts). Off = nothing loaded, no worker, no database.
 */
import { S } from '../../strings'
import { EXT_DATA_MERGERS } from '../ext_data'
import type { TwModule } from '../tw_registry'
import { MODULE_ID, mergeObsidian } from './obsidian_data'

// The slice merges between my devices even while the module is off.
EXT_DATA_MERGERS.set(MODULE_ID, mergeObsidian)

export const module: TwModule = {
  id: MODULE_ID,
  title: S.obsidian.title,
  description: S.obsidian.desc,
  kind: 'service',
  enabledByDefault: false,
  heavy: true,
  load: () => import('./obsidian_body').then((m) => m.body),
}
