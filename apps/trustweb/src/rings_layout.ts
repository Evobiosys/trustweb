/** The rings view's geometry and the one place a drop changes a person: close in the centre, unsorted (grey) outermost. */
import { CLOSENESS_KEY, Ring, RINGS } from './model'
import type { Person } from './model'

export const WEB_RINGS: readonly Ring[] = [...RINGS, Ring.Unsorted]
export const RING_RADIUS: Record<Ring, number> = { [Ring.Close]: 48, [Ring.Friend]: 84, [Ring.Acquaintance]: 118, [Ring.Intending]: 148, [Ring.Unsorted]: 168, [Ring.None]: 168, [Ring.Family]: 48 }

/** More people than this on the rings: initials only, the name on hover, focus or tap. */
export const RINGS_LABEL_CAP = 40

export const DESIRE_DEFAULT = 5

/** The ring whose circle is nearest to a distance from the centre (a drop is read from this). */
export function ringAt(dist: number): Ring {
  return WEB_RINGS.reduce((best, r) => (Math.abs(RING_RADIUS[r] - dist) < Math.abs(RING_RADIUS[best] - dist) ? r : best))
}

/** Avatar diameter in px (at most 18) for n people on one ring, shrinking so a crowded ring never overlaps into a blob. */
export function dotSize(n: number, ring: Ring): number {
  return Math.max(4, Math.min(18, Math.floor((2 * Math.PI * RING_RADIUS[ring] * 0.9) / Math.max(n, 1))))
}

/** Puts a person on a ring; family keeps its tag and moves by closeness. `desire` (0..10) belongs to Intending only. */
export function placeOnRing(p: Person, ring: Ring, now: number, desire = DESIRE_DEFAULT): void {
  if (p.ring === Ring.Family && ring !== Ring.Unsorted) {
    p.fields = { ...p.fields, [CLOSENESS_KEY]: ring }
  } else {
    p.ring = ring
  }
  if (ring === Ring.Intending) p.intending = { value: Math.max(0, Math.min(10, Math.round(desire))), since: now }
  else delete p.intending
}
