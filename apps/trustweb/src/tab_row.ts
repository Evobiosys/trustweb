// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 24: the bottom row. Five slots by default (Membranes | Chat | Record | Events | My Resources); the owner may re-pick
 * every slot but the last, which stays My Resources. Stored as AppState.tabRow (screen ids); absent = the default.
 * An id this build does not know, or whose feature is off, is skipped; duplicates collapse. Pure, no DOM.
 */
export type TabId = 'web' | 'chat' | 'record' | 'events' | 'inventory' | 'feed' | 'network' | 'desk'

export interface TabFlags {
  events: boolean
  feed: boolean
  inventory: boolean
}

export const DEFAULT_ROW: readonly TabId[] = ['web', 'chat', 'record', 'events', 'inventory']

/** Every screen the Settings picker offers, in the picker's order. */
export function availableTabs(f: TabFlags): TabId[] {
  const ids: TabId[] = ['web', 'chat', 'record']
  if (f.events) ids.push('events')
  if (f.inventory) ids.push('inventory')
  if (f.feed) ids.push('feed')
  ids.push('network', 'desk')
  return ids
}

/** The row to draw: saved ids that are available, once each, My Resources moved to the far right. */
export function resolveRow(saved: unknown, f: TabFlags): TabId[] {
  const ok = new Set<string>(availableTabs(f))
  const pick = (ids: readonly unknown[]): TabId[] => [...new Set(ids)].filter((id): id is TabId => typeof id === 'string' && ok.has(id))
  const row = pick(Array.isArray(saved) ? saved : [])
  const body = (r: TabId[]): TabId[] => r.filter((id) => id !== 'inventory')
  const chosen = body(row).length ? row : pick(DEFAULT_ROW)
  return f.inventory ? [...body(chosen), 'inventory'] : chosen
}

/** The row after slot `index` takes `id`: the slot that held `id` takes the old one. The last slot (My Resources) is locked. */
export function setSlot(row: readonly TabId[], index: number, id: string, f: TabFlags): TabId[] {
  const next = [...row]
  if (!availableTabs(f).includes(id as TabId) || id === 'inventory' || index < 0 || index >= next.length - (f.inventory ? 1 : 0)) return next
  const from = next.indexOf(id as TabId)
  if (from >= 0) next[from] = next[index]
  next[index] = id as TabId
  return next
}
