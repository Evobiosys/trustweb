// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b filters-communities (item 3): saved filter states. A state = the in (show) and out (hide) chips under a name; Advanced lists them,
 * "Pin" shows one as a chip above the filter row on Web, Chat, Resources and Ask. Stored in the record (`savedFilters`, schema 4). Pure, no
 * imports (apps/mcp loads it under plain node).
 */
export interface SavedFilter { id: string; name: string; show: string[]; hide: string[]; pinned?: true }
type Rec = { uiRings?: { show?: string[]; hide?: string[] } & Record<string, unknown>; savedFilters?: SavedFilter[] }

export const SAVED_FILTERS_MAX = 30
const NAME_MAX = 40

const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')
const valid = (f: unknown): f is SavedFilter => !!f && typeof f === 'object' && typeof (f as SavedFilter).id === 'string' && typeof (f as SavedFilter).name === 'string' && strs((f as SavedFilter).show) && strs((f as SavedFilter).hide)

/** Saves what the filter row shows now; the same name (any letter case) replaces. Null for an empty name or no chips. */
export function saveFilterState(s: Rec, name: string): SavedFilter | null {
  const n = name.trim().slice(0, NAME_MAX)
  const show = [...(s.uiRings?.show ?? [])]
  const hide = [...(s.uiRings?.hide ?? [])]
  if (!n || (!show.length && !hide.length)) return null
  const list = s.savedFilters ?? []
  const old = list.find((f) => f.name.toLowerCase() === n.toLowerCase())
  const f: SavedFilter = { id: old?.id ?? `sf${Date.now().toString(36)}${list.length.toString(36)}`, name: n, show, hide, ...(old?.pinned ? { pinned: true as const } : {}) }
  s.savedFilters = [...list.filter((x) => x !== old), f].slice(-SAVED_FILTERS_MAX)
  return f
}

/** Puts a saved state's chips back into the filter row. */
export function applySavedFilter(s: Rec, id: string): boolean {
  const f = s.savedFilters?.find((x) => x.id === id)
  if (!f) return false
  s.uiRings = { ...s.uiRings, show: [...f.show], hide: [...f.hide] }
  return true
}

export function pinSavedFilter(s: Rec, id: string, on: boolean): boolean {
  const f = s.savedFilters?.find((x) => x.id === id)
  if (!f) return false
  if (on) f.pinned = true; else delete f.pinned
  return true
}

export const pinnedFilters = (s: Rec): SavedFilter[] => (s.savedFilters ?? []).filter((f) => f.pinned === true)

/** schema_version.ts step (4): malformed entries go; an empty list is dropped. True when the record changed. */
export function repairSavedFilters(s: { savedFilters?: unknown }): boolean {
  if (s.savedFilters === undefined) return false
  const good = Array.isArray(s.savedFilters) ? s.savedFilters.filter(valid) : []
  if (!good.length) { delete s.savedFilters; return true }
  const changed = !Array.isArray(s.savedFilters) || good.length !== s.savedFilters.length
  if (changed) s.savedFilters = good
  return changed
}
