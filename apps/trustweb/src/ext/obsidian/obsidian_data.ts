// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: the module's slice of the record (`AppState.extData.obsidian`) and the deep link back into Obsidian. Small on purpose:
 * this file is in the main bundle (the stub registers the merge, the person card builds the link), everything else loads only when the module is on.
 * Only the vault's NAME rides the device sync; the parsed notes and the folder access stay on the device they were read on.
 */
export const MODULE_ID = 'obsidian'

export interface ObsidianData { vault?: string; syncedAt?: number }

export function parseObsidian(raw: unknown): ObsidianData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const o = raw as Record<string, unknown>
  return { ...(typeof o.vault === 'string' && o.vault ? { vault: o.vault } : {}), ...(typeof o.syncedAt === 'number' ? { syncedAt: o.syncedAt } : {}) }
}

/** The side with the later sync decides the vault's name. */
export function mergeObsidian(mine: unknown, theirs: unknown): ObsidianData {
  const a = parseObsidian(mine)
  const b = parseObsidian(theirs)
  const newer = (b.syncedAt ?? 0) > (a.syncedAt ?? 0) ? b : a
  const vault = newer.vault ?? a.vault ?? b.vault
  const syncedAt = Math.max(a.syncedAt ?? 0, b.syncedAt ?? 0)
  return { ...(vault ? { vault } : {}), ...(syncedAt ? { syncedAt } : {}) }
}

/** obsidian://open?vault=<name>&file=<note path without .md>; null when either is missing. */
export function deepLink(vault: string, notePath: string): string | null {
  if (!vault || !notePath) return null
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(notePath.replace(/\.md$/i, ''))}`
}
