// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 39 (import-curate, item 8): who the "Not yet sorted" ring lists, and why a person imported from Tana (id `tana-...`) may be missing from it.
 * The ring lists everyone whose slot (webSlot) is Unsorted after four things leave: archived (Ring.None), blocked, a hidden source (Settings >
 * Sources) or the Curator's archive, and the Expanse. Besides those, the ring draws only the closest few of a long list (the per-ring limit): a display cap, nobody is removed.
 * Pure: the same predicates the Web view uses, so the numbers match what it draws.
 */
import { inExpanse } from './expanse'
import type { AppState } from './model'
import { Ring } from './model'
import { isBlocked } from './non_responsive'
import { shown, sourceOfPerson } from './sources'
import { isArchived } from './trustzones'
import { webSlot } from './rings_layout'

export interface UnsortedCount {
  /** Everyone on the Not yet sorted ring, whatever their source. */
  unsorted: number
  /** Tana people in the record, and how many of them sit on the Not yet sorted ring. */
  tana: number
  tanaUnsorted: number
  /** Tana people the record holds but the ring leaves out, by reason. */
  tanaLeftOut: { archived: number; blocked: number; sourceHidden: number; curatorArchive: number; expanse: number; otherRing: number }
}

export function unsortedCount(s: Pick<AppState, 'people' | 'hiddenSources' | 'expanse'>, curatorHidden: ReadonlySet<string> = new Set()): UnsortedCount {
  const listed = new Set(shown(s as AppState, curatorHidden).people.filter((p) => !isArchived(p) && !isBlocked(p) && !inExpanse(s, p.id)).map((p) => p.id))
  const on = (id: string, p: AppState['people'][number]): boolean => listed.has(id) && webSlot(p) === Ring.Unsorted
  const out: UnsortedCount = { unsorted: 0, tana: 0, tanaUnsorted: 0, tanaLeftOut: { archived: 0, blocked: 0, sourceHidden: 0, curatorArchive: 0, expanse: 0, otherRing: 0 } }
  const sourceShown = new Set(shown({ ...(s as AppState), people: s.people.filter((p) => !curatorHidden.has(p.id)) }).people.map((p) => p.id))
  for (const p of s.people) {
    if (on(p.id, p)) out.unsorted++
    if (sourceOfPerson(p) !== 'tana') continue
    out.tana++
    if (on(p.id, p)) { out.tanaUnsorted++; continue }
    const why = isArchived(p) ? 'archived' : isBlocked(p) ? 'blocked' : curatorHidden.has(p.id) ? 'curatorArchive' : !sourceShown.has(p.id) ? 'sourceHidden' : inExpanse(s, p.id) ? 'expanse' : 'otherRing'
    out.tanaLeftOut[why]++
  }
  return out
}
