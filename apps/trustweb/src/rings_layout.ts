/** The rings view's geometry and the one place a drop changes a person: four rings, close in the centre; people not placed yet are not on it. */
import { CLOSENESS_KEY, Ring, RINGS } from './model'
import type { Person } from './model'

export const WEB_RINGS: readonly Ring[] = RINGS
export const RING_RADIUS: Record<Ring, number> = { [Ring.Close]: 48, [Ring.Friend]: 84, [Ring.Acquaintance]: 118, [Ring.Intending]: 148, [Ring.Unsorted]: 168, [Ring.None]: 168, [Ring.Family]: 48 }

/** More people than this on the rings: the name shows on hover, focus or tap only. */
export const RINGS_LABEL_CAP = 40

export const DESIRE_DEFAULT = 5

/** The ring whose circle is nearest to a distance from the centre (a drop is read from this). */
export function ringAt(dist: number, radius: Record<Ring, number> = RING_RADIUS): Ring {
  return WEB_RINGS.reduce((best, r) => (Math.abs(radius[r] - dist) < Math.abs(radius[best] - dist) ? r : best))
}

/** Avatar diameter (px): at most FULL, shrinking to LEAST before a ring takes a second lap. */
const FULL_DOT = 42
const LEAST_DOT = 14
const RING_FILL = 0.9
const GAP = 3

export interface RingsGeometry {
  radius: Record<Ring, number>
  dot: Record<Ring, number>
  /** People per lap; a full ring continues on laps just outside it, never inside. */
  perLap: Record<Ring, number>
  /** Outer edge of the outermost avatar: the view scales to fit it. */
  extent: number
}

/** Where each ring sits for `counts` people: a ring that needs more laps pushes the rings outside it outward, so a crowd never lands on an inner tier. */
export function ringsGeometry(counts: Record<Ring, number>): RingsGeometry {
  const g: RingsGeometry = { radius: { ...RING_RADIUS }, dot: {} as Record<Ring, number>, perLap: {} as Record<Ring, number>, extent: 0 }
  let prev = { r: 0, dot: 0, pushed: false }
  for (const ring of WEB_RINGS) {
    const n = Math.max(counts[ring] ?? 0, 1)
    const around = (r: number, dot: number): number => Math.max(1, Math.floor((2 * Math.PI * r * RING_FILL) / dot))
    // The ring keeps its place unless the one inside it overflowed (or was pushed) onto it.
    let r = RING_RADIUS[ring]
    const dot = Math.max(LEAST_DOT, Math.min(FULL_DOT, Math.floor((2 * Math.PI * r * RING_FILL) / n)))
    if (prev.pushed) r = Math.max(r, prev.r + (prev.dot + dot) / 2 + GAP)
    const per = around(r, dot)
    const laps = Math.ceil(n / per)
    g.radius[ring] = r; g.dot[ring] = dot; g.perLap[ring] = per
    prev = { r: r + (laps - 1) * (dot + 1), dot, pushed: laps > 1 || r !== RING_RADIUS[ring] }
  }
  const edge = prev.r + prev.dot / 2
  g.extent = edge
  return g
}

/** Radius of one lap of a ring: the first sits on the ring, the others just outside it. */
export const lapRadius = (g: RingsGeometry, ring: Ring, lap: number): number => g.radius[ring] + lap * (g.dot[ring] + 1)

/** The person-field id of Tana's "family" checkbox: a purple accent on the avatar, no ring of its own. */
export const FAMILY_FIELD = 'LNlpliq4GdNI'
export const isFamily = (p: Pick<Person, 'ring' | 'fields'>): boolean => p.ring === Ring.Family || String(p.fields?.[FAMILY_FIELD]) === 'true'

/** Puts a person on a ring; family keeps its tag and moves by closeness. `desire` (0..10) belongs to Intending only. */
export function placeOnRing(p: Person, ring: Ring, now: number, desire = DESIRE_DEFAULT): void {
  if (p.ring === Ring.Family) {
    p.fields = { ...p.fields, [CLOSENESS_KEY]: ring }
  } else {
    p.ring = ring
  }
  if (ring === Ring.Intending) p.intending = { value: Math.max(0, Math.min(10, Math.round(desire))), since: now }
  else delete p.intending
}

