// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 23 (share sink): "want suggestions for what this person also gets?". Call it ONLY when the owner asked. Pure, no model call:
 * after the owner shared `activity.itemId` with `activity.personId`, every item the person cannot see yet is scored by how many of
 * the tags and zones that open it also open the shared item (Jaccard, 0..1 = credence; the UI renders it as opacity). The zone a
 * suggestion grants is the item's least intimate zone; an item with no zone counts as self (owner only).
 * Credence and why are shown to the owner always, and to the person it is about only when they sit closer than that zone (Q5).
 */
import { canAccess, opens, personZone } from './check'
import { type Store, type Tuple, isLive } from './tuples'
import { ALL_ZONES, Zone, effectiveZone, rank } from './zones'

export interface Activity { personId: string; itemId: string }
export interface Suggestion { personId: string; itemId: string; credence: number; zone: Zone; why: Tuple[] }

const openers = (live: Store, itemId: string): Tuple[] =>
  live.filter((t) => opens(t, itemId) && /^(tag|zone):/.test(t.subject))

export function suggestSharing(store: Store, activity: Activity, now: Date, active: readonly Zone[] = ALL_ZONES): Suggestion[] {
  const live = store.filter((t) => isLive(t, now))
  const base = openers(live, activity.itemId)
  const baseSubjects = new Set(base.map((t) => t.subject))
  const candidates = [...new Set(live.filter((t) => /^(item|file):/.test(t.object)).map((t) => t.object))]
    .filter((id) => id !== activity.itemId && !canAccess(live, activity.personId, id, now, active).allowed)
  return candidates.flatMap((itemId) => {
    const own = openers(live, itemId)
    const shared = own.filter((t) => baseSubjects.has(t.subject))
    if (!shared.length) return []
    const union = new Set([...baseSubjects, ...own.map((t) => t.subject)])
    const zones = own.filter((t) => t.subject.startsWith('zone:')).map((t) => effectiveZone(t.subject.slice(5) as Zone, active))
    const zone = zones.length ? zones.reduce((a, b) => (rank(b) < rank(a) ? b : a)) : Zone.Self
    const why = [...base.filter((t) => shared.some((s) => s.subject === t.subject)), ...shared]
    return [{ personId: activity.personId, itemId, credence: shared.length / union.size, zone, why }]
  }).sort((a, b) => b.credence - a.credence || a.itemId.localeCompare(b.itemId))
}

/** May `viewerId` see this suggestion's credence and why? */
export function mayExplain(store: Store, s: Suggestion, viewerId: string, ownerId: string, now: Date, active: readonly Zone[] = ALL_ZONES): boolean {
  if (viewerId === ownerId) return true
  return viewerId === s.personId && rank(personZone(store, viewerId, now, active).zone) > rank(s.zone)
}
