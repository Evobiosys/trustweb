// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 23 (share sink): the one check. A person may read an item when they hold an individual grant, OR carry a tag the item
 * carries, OR sit in a zone at least as intimate as the item's zone, honouring rings switched off. `why` lists the matching tuples
 * (for "what it would mean to share this"). Pure: no I/O, the clock is passed in.
 */
import { type Store, type Tuple, isLive } from './tuples'
import { MAX_DEPTH } from './tags'
import { ALL_ZONES, Zone, effectiveZone, mostIntimate, rank } from './zones'

export interface Access { allowed: boolean; why: Tuple[] }

const zoneOf = (id: string): Zone => id.slice('zone:'.length) as Zone
/** Does this tuple open `itemId` (read or write)? */
export const opens = (t: Tuple, itemId: string): boolean => t.object === itemId && (t.relation === 'may_read' || t.relation === 'may_write')

/** The person's zone (most intimate of the rings on) and the tuple that puts them there (none: public). */
export function personZone(store: Store, personId: string, now: Date, active: readonly Zone[] = ALL_ZONES): { zone: Zone; tuple?: Tuple } {
  const mine = store.filter((t) => t.subject === personId && t.relation === 'in_zone' && isLive(t, now))
  const zone = mostIntimate(mine.map((t) => zoneOf(t.object)), active)
  return { zone, tuple: mine.find((t) => zoneOf(t.object) === zone) }
}

/** The tags a person holds, each with the tuples that show how: their own has_tag, then up through nested_in (depth-capped). */
export function heldTags(live: Store, personId: string): Map<string, Tuple[]> {
  const held = new Map<string, Tuple[]>()
  const queue = live.filter((t) => t.subject === personId && t.relation === 'has_tag').map((t) => ({ tag: t.object, path: [t] }))
  for (let i = 0; i < queue.length; i++) {
    const { tag, path } = queue[i]
    if (held.has(tag)) continue
    held.set(tag, path)
    if (path.filter((t) => t.relation === 'nested_in').length >= MAX_DEPTH - 1) continue
    for (const up of live.filter((t) => t.subject === tag && t.relation === 'nested_in')) queue.push({ tag: up.object, path: [...path, up] })
  }
  return held
}

export function canAccess(store: Store, personId: string, itemId: string, now: Date, active: readonly Zone[] = ALL_ZONES): Access {
  const live = store.filter((t) => isLive(t, now))
  const held = heldTags(live, personId)
  // D3: an exclusion (of the person, or of a tag they hold) beats every grant, zone and tag alike.
  const excluded = live.filter((t) => t.relation === 'excludes' && t.object === itemId && (t.subject === personId || held.has(t.subject)))
  if (excluded.length) return { allowed: false, why: [...new Set(excluded.flatMap((t) => (t.subject === personId ? [t] : [t, ...(held.get(t.subject) ?? [])])))] }
  const why: Tuple[] = live.filter((t) => t.subject === personId && opens(t, itemId))
  for (const [tag, path] of held) {
    const item = live.filter((t) => t.subject === tag && opens(t, itemId))
    if (item.length) why.push(...path, ...item)
  }
  const me = personZone(live, personId, now, active)
  const zoned = live.filter((t) => t.subject.startsWith('zone:') && opens(t, itemId) && rank(me.zone) >= rank(effectiveZone(zoneOf(t.subject), active)))
  const needsMe = me.tuple && zoned.some((t) => zoneOf(t.subject) !== Zone.Public)
  if (zoned.length) why.push(...(needsMe ? [me.tuple as Tuple] : []), ...zoned)
  return { allowed: why.length > 0, why: [...new Set(why)] }
}
