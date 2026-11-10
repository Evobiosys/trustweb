// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39: `AppState.extData` (data the extension modules keep, keyed by module id) merges between my devices module by module:
 * a module that registers a rule here merges its own slice; otherwise the side that has the slice keeps it, the incoming one when both do.
 */
import { SETTING_MERGERS } from '../sync_core'

export const EXT_DATA_MERGERS = new Map<string, (mine: unknown, theirs: unknown) => unknown>()

const isRec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function mergeExtData(mine: unknown, theirs: unknown): Record<string, unknown> {
  const a = isRec(mine) ? mine : {}
  const b = isRec(theirs) ? theirs : {}
  const out: Record<string, unknown> = { ...a }
  for (const [id, t] of Object.entries(b)) {
    if (id === '__proto__') continue
    const rule = EXT_DATA_MERGERS.get(id)
    out[id] = id in a && rule ? rule(a[id], t) : t
  }
  return out
}

SETTING_MERGERS.set('extData', mergeExtData)
