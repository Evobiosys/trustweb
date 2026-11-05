// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30: the multi-select mode of the People and Map lists. The selection model and the undo snapshot of a bulk action. Pure, DOM-free. */
import { Ring, RINGS } from './model'
import type { Person } from './model'

/** The rings "Move to ring" offers: the five rings and Not yet sorted. */
export const BULK_RINGS: readonly Ring[] = [...RINGS, Ring.Unsorted]

export type Selection = ReadonlySet<string>

export const clearSelection = (): Selection => new Set()

export function toggle(sel: Selection, id: string): Selection {
  const next = new Set(sel)
  if (!next.delete(id)) next.add(id)
  return next
}

/** Selects every id of a group; when all of them were selected already, unselects them. */
export function selectGroup(sel: Selection, ids: readonly string[]): Selection {
  if (!ids.length) return sel
  const next = new Set(sel)
  const all = ids.every((id) => sel.has(id))
  for (const id of ids) { if (all) next.delete(id); else next.add(id) }
  return next
}

export interface Snap { id: string; ring: Ring; prevRing?: Ring; ringSuggested?: boolean }

/** What a bulk move or archive changes on the selected people, for one undo. */
export function snapshot(people: readonly Person[], ids: Selection): Snap[] {
  return people.filter((p) => ids.has(p.id)).map((p) => ({ id: p.id, ring: p.ring, prevRing: p.prevRing, ringSuggested: p.ringSuggested }))
}

export function restoreSnapshot(people: Person[], snaps: readonly Snap[]): void {
  for (const s of snaps) {
    const p = people.find((x) => x.id === s.id)
    if (!p) continue
    p.ring = s.ring
    if (s.prevRing === undefined) delete p.prevRing; else p.prevRing = s.prevRing
    if (s.ringSuggested === undefined) delete p.ringSuggested; else p.ringSuggested = s.ringSuggested
  }
}
