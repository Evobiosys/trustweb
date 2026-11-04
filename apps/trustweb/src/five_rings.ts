// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Five-ring prototype, behind a flag (`tw-five-rings`). Pure, no DOM, no strings: the five rings of the field with a Dunbar hint each,
 * the one-to-one map onto the share-sink ladder, the acquaintance lean as a move the owner accepts, the ring field's five options and
 * the field overview's numbers. Nothing here runs at boot; nothing new is stored on a Person (I1/I2).
 */
import { RINGS, Ring, ringSlot } from './model'
import type { AppState, Person } from './model'
import { Zone } from './share_sink/zones'
import { webSlot } from './rings_layout'
import { isArchived } from './trustzones'
import { isBlocked } from './non_responsive'

export const FIVE_RINGS_FLAG = 'tw-five-rings'
export const FIVE_RINGS_PARAM = 'five_rings'

/** The flag as stored ('1' = on); storage blocked or throwing = off. */
export function fiveRingsOn(read: () => string | null = () => localStorage.getItem(FIVE_RINGS_FLAG)): boolean {
  try { return read() === '1' } catch { return false }
}

/** `?five_rings=1` turns the prototype on, `=0` off; absent or anything else leaves it as stored (null). */
export function flagFromUrl(search: string): boolean | null {
  const v = new URLSearchParams(search).get(FIVE_RINGS_PARAM)
  return v === '1' ? true : v === '0' ? false : null
}

/** The five rings of the field = RINGS, centre out. */
export const FIELD_RINGS: readonly Ring[] = RINGS

/** Dunbar layer per ring, CUMULATIVE (this ring and everyone closer). A hint for the overview, never a cap. */
export interface DunbarHint { about: number; from: number; to: number }
type FieldRing = Ring.Closest | Ring.Close | Ring.Friend | Ring.Acquaintance | Ring.Intending
export const DUNBAR_HINT: Record<FieldRing, DunbarHint> = {
  [Ring.Closest]: { about: 5, from: 3, to: 7 },
  [Ring.Close]: { about: 15, from: 10, to: 20 },
  [Ring.Friend]: { about: 50, from: 30, to: 70 },
  [Ring.Acquaintance]: { about: 150, from: 100, to: 250 },
  [Ring.Intending]: { about: 500, from: 300, to: 800 },
}
const isFieldRing = (r: Ring): r is FieldRing => RINGS.includes(r)

/** The hint for a field ring; none for family, unsorted and none. */
export const dunbarHint = (ring: Ring): DunbarHint | null => (isFieldRing(ring) ? DUNBAR_HINT[ring] : null)

const RING_ZONE: Record<Ring, Zone> = {
  [Ring.Closest]: Zone.Closest, [Ring.Close]: Zone.Close, [Ring.Friend]: Zone.Friend, [Ring.Acquaintance]: Zone.Acquaintance,
  [Ring.Intending]: Zone.Intending, [Ring.Unsorted]: Zone.Public, [Ring.None]: Zone.Public,
  // Never reached: ringSlot puts family on its closeness.
  [Ring.Family]: Zone.Close,
}

/** Ring -> ladder zone. The five rings map one-to-one; Family goes by its closeness; Unsorted and None are public. */
export function ringZone(p: Pick<Person, 'ring' | 'fields'>): Zone {
  return RING_ZONE[ringSlot(p)]
}

/** Ladder zone -> the ring that is it, or null for the zones that are no ring (public, community, self). */
export function zoneRing(z: Zone): Ring | null {
  return RINGS.find((r) => RING_ZONE[r] === z) ?? null
}

export interface LeanMove { person: Person; to: Ring }

const movable = (p: Person): boolean =>
  p.ring === Ring.Acquaintance && !p.ringSuggested && !isArchived(p) && !isBlocked(p) && (p.lean === -2 || p.lean === -1)

/** Acquaintances (confirmed, not ringSuggested, not archived, not blocked) whose lean says "more friend" (-2 or -1): the one move the lean implies. +1/+2 and 0 imply none: Acquaintance is already the outermost field ring. */
export function leanMoves(people: readonly Person[]): LeanMove[] {
  return people.filter(movable).map((person) => ({ person, to: Ring.Friend }))
}

/**
 * Applies the accepted moves: ring = Friend, lean deleted; also deletes a stale lean on anyone not on Acquaintance. Returns how many
 * people changed. Idempotent. An empty set changes nothing at all. Never called at boot: a move widens who may ask (I9).
 */
export function migrateLean(s: Pick<AppState, 'people'>, accept: ReadonlySet<string> | 'all'): number {
  if (accept !== 'all' && accept.size === 0) return 0
  let changed = 0
  for (const p of s.people) {
    if (movable(p) && (accept === 'all' || accept.has(p.id))) {
      p.ring = Ring.Friend
      delete p.lean
      changed++
    } else if (p.ring !== Ring.Acquaintance && 'lean' in p) {
      delete p.lean
      changed++
    }
  }
  return changed
}

/** The Curator's `tw-ring` options once Closest joins it (today: close, friend, acquaintance, intending; apps/crm/src/person_fields.ts). */
export const RING_FIELD_OPTIONS_V2: readonly { id: Ring; label: string }[] = [
  { id: Ring.Closest, label: 'Closest few' },
  { id: Ring.Close, label: 'Close friend' },
  { id: Ring.Friend, label: 'Friend' },
  { id: Ring.Acquaintance, label: 'Acquaintance' },
  { id: Ring.Intending, label: 'Intending to connect' },
]

/** The two placement states the Curator's ring field also holds (apps/crm/src/rings.ts UNSORTED, OUT_OF_WEB): no ring, kept as they are. */
const PLACEMENT_STATES: readonly string[] = ['unsorted', 'outofweb']

/** Is a stored `tw-ring` value one the five-option field knows: one of the five ring ids or a placement state? Anything else (an old "family", a typo) is for the Curator to re-file; no value changes meaning, so there is nothing to migrate. */
export function isRingFieldValue(value: string | undefined): boolean {
  return value !== undefined && (RING_FIELD_OPTIONS_V2.some((o) => o.id === value) || PLACEMENT_STATES.includes(value))
}

export interface FieldRow { ring: Ring; count: number; cumulative: number; hint: DunbarHint }
export interface FieldOverview { rows: FieldRow[]; unsorted: number; total: number; leanMoves: number }

/** Everyone not archived (Ring.None) and not blocked, by webSlot (a suggested ring counts as unsorted). cumulative = this ring + all closer. The TrustZones display filters (uiRings) do NOT apply: the overview is the whole field. */
export function fieldOverview(people: readonly Person[]): FieldOverview {
  const field = people.filter((p) => !isArchived(p) && !isBlocked(p))
  const counts = new Map<Ring, number>()
  let unsorted = 0
  for (const p of field) {
    const slot = webSlot(p)
    if (isFieldRing(slot)) counts.set(slot, (counts.get(slot) ?? 0) + 1)
    else unsorted++
  }
  let cumulative = 0
  const rows = (FIELD_RINGS as readonly FieldRing[]).map((ring) => {
    const count = counts.get(ring) ?? 0
    cumulative += count
    return { ring, count, cumulative, hint: DUNBAR_HINT[ring] }
  })
  return { rows, unsorted, total: cumulative + unsorted, leanMoves: leanMoves(people).length }
}
