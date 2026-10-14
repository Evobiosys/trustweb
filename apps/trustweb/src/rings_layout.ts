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

/** Smallest avatar (px) on a crowded ring; below the full size the avatars show no letter (styles.css `--d`). */
const CROWDED_DOT = 6
const RING_FILL = 0.9

/** How n people sit on one ring: the avatar diameter (at most 18) and the number of concentric tracks (inward from the ring's radius) a crowded ring needs, so the dots never overlap into a blob. */
export function ringLayout(n: number, ring: Ring): { dot: number; tracks: number } {
  const fit = Math.floor((2 * Math.PI * RING_RADIUS[ring] * RING_FILL) / Math.max(n, 1))
  if (fit >= CROWDED_DOT) return { dot: Math.min(18, fit), tracks: 1 }
  return { dot: CROWDED_DOT, tracks: Math.ceil(n / Math.floor((2 * Math.PI * RING_RADIUS[ring] * RING_FILL) / CROWDED_DOT)) }
}

/** Radius of one track of a ring: the first sits on the ring, the others just inside it. */
export const trackRadius = (ring: Ring, track: number, dot: number): number => RING_RADIUS[ring] - track * (dot + 1)

/** The person-field id of Tana's "family" checkbox: a purple accent on the avatar, no ring of its own. */
export const FAMILY_FIELD = 'LNlpliq4GdNI'
export const isFamily = (p: Pick<Person, 'ring' | 'fields'>): boolean => p.ring === Ring.Family || String(p.fields?.[FAMILY_FIELD]) === 'true'

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

/** Established contact: a met date, notes or a recorded meeting. Such a person cannot be dropped on "intending to connect". */
export function inContact(p: Person, meetings: readonly { personId?: string }[] = []): boolean {
  return p.metAt > 0 || p.lines.length > 0 || !!p.generalNote?.trim() || meetings.some((m) => m.personId === p.id)
}
