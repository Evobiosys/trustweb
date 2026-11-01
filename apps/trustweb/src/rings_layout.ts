/** The rings view's geometry and the one place a drop changes a person: four rings, close in the centre, and a grey "not placed yet" ring outside them (drawn only when someone is on it). */
import { CLOSENESS_KEY, Ring, RINGS, ringSlot } from './model'
import type { AppState, Person } from './model'

export const WEB_RINGS: readonly Ring[] = [...RINGS, Ring.Unsorted]

/** Where a person is drawn: their ring only when confirmed; a suggested ring, none, unsorted and no ring at all sit on the unsorted ring. */
export function webSlot(p: Pick<Person, 'ring' | 'fields' | 'ringSuggested'>): Ring {
  const r = ringSlot(p)
  return WEB_RINGS.includes(r) && !p.ringSuggested ? r : Ring.Unsorted
}
export const RING_RADIUS: Record<Ring, number> = { [Ring.Closest]: 48, [Ring.Close]: 78, [Ring.Friend]: 106, [Ring.Acquaintance]: 132, [Ring.Intending]: 156, [Ring.Unsorted]: 176, [Ring.None]: 176, [Ring.Family]: 48 }

/** More people than this on the rings: the name shows on hover, focus or tap only. */
export const RINGS_LABEL_CAP = 40

export const DESIRE_DEFAULT = 5

/** The ring whose circle is nearest to a distance from the centre (a drop is read from this). */
export function ringAt(dist: number, radius: Record<Ring, number> = RING_RADIUS, rings: readonly Ring[] = WEB_RINGS): Ring {
  return rings.reduce((best, r) => (Math.abs(radius[r] - dist) < Math.abs(radius[best] - dist) ? r : best))
}

/** A drop this far from the centre, beyond the outermost avatar, hides the person (same as "hide in trustweb"). */
const HIDE_MARGIN = 12
export const beyondRings = (dist: number, g: RingsGeometry): boolean => dist > g.extent + HIDE_MARGIN

/** Avatar diameter (px): at most FULL, shrinking to LEAST before a ring takes a second lap. */
const FULL_DOT = 42
const LEAST_DOT = 14
/** The "you" avatar's outer edge (r 20 + 2 px white ring) and the gap a close dot keeps from it. */
export const YOU_EDGE = 22
export const CLOSE_GAP = 2
const RING_FILL = 0.9
const GAP = 3
const around = (r: number, dot: number): number => Math.max(1, Math.floor((2 * Math.PI * r * RING_FILL) / dot))

/** The largest close dot that fits `n` on one lap, with the ring just far enough out that its inner edge sits CLOSE_GAP from the "you" avatar. The view draws everything at scale `k` but the avatar at full size, so the avatar's edge is YOU_EDGE / k in these units. */
function closeFit(n: number, k: number): { r: number; dot: number } {
  const inner = (YOU_EDGE + CLOSE_GAP) / k
  for (let dot = FULL_DOT; dot > LEAST_DOT; dot--) {
    const r = inner + dot / 2
    if (around(r, dot) >= n) return { r, dot }
  }
  return { r: inner + LEAST_DOT / 2, dot: LEAST_DOT }
}

export interface RingsGeometry {
  radius: Record<Ring, number>
  dot: Record<Ring, number>
  /** People per lap; a full ring continues on laps just outside it, never inside. */
  perLap: Record<Ring, number>
  /** The rings in play: the unsorted one only when someone is on it. */
  rings: readonly Ring[]
  /** Lap of each person per ring, in the order their angles were given (only when `angles` was given). */
  lapOf: Partial<Record<Ring, number[]>>
  /** Outer edge of the outermost avatar: the view scales to fit it. */
  extent: number
}

/** Degrees (0 = top, clockwise) of a point `dx`, `dy` from the centre, in 0..360. */
export const angleFromCentre = (dx: number, dy: number): number => ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360

/** Where a dot sits on its ring: where it was dropped, else a fixed spot from its id so it never jumps between renders. */
export function angleOf(p: Pick<Person, 'id' | 'angle'>): number {
  if (p.angle !== undefined) return p.angle
  let h = 2166136261
  for (let i = 0; i < p.id.length; i++) h = Math.imul(h ^ p.id.charCodeAt(i), 16777619)
  return (h >>> 0) % 360
}

const angleGap = (a: number, b: number): number => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d) }

/** The lap of each angle (in the given order): the first lap where it clears every dot already there. Adding one at the end moves no one. */
export function packLaps(angles: readonly number[], radius: number, dot: number): number[] {
  const laps: number[][] = []
  return angles.map((a) => {
    for (let lap = 0; ; lap++) {
      const placed = (laps[lap] ??= [])
      const r = radius + lap * (dot + 1)
      const sep = (2 * Math.asin(Math.min(1, (dot + 1) / (2 * r))) * 180) / Math.PI
      if (placed.every((b) => angleGap(a, b) >= sep)) { placed.push(a); return lap }
    }
  })
}

/**
 * Evenly spaced angles per ring (all rings, or just `ring`), keeping the order around the circle and the first dot where it is.
 * Returns each touched person's previous stored angle (undefined = none) for Undo.
 */
export function spaceOut(s: Pick<AppState, 'people'>, ring?: Ring): Map<string, number | undefined> {
  const before = new Map<string, number | undefined>()
  for (const r of WEB_RINGS) {
    if (ring && r !== ring) continue
    const around = s.people.filter((p) => webSlot(p) === r).sort((a, b) => angleOf(a) - angleOf(b) || (a.id < b.id ? -1 : 1))
    if (!around.length) continue
    const start = angleOf(around[0])
    around.forEach((p, i) => { before.set(p.id, p.angle); p.angle = (start + (360 * i) / around.length) % 360 })
  }
  return before
}

/** Puts the stored angles back after spaceOut. */
export function restoreAngles(s: Pick<AppState, 'people'>, before: ReadonlyMap<string, number | undefined>): void {
  for (const p of s.people) {
    if (!before.has(p.id)) continue
    const a = before.get(p.id)
    if (a === undefined) delete p.angle
    else p.angle = a
  }
}

/** Where each ring sits for `counts` people: a ring that needs more laps pushes the rings outside it outward, so a crowd never lands on an inner tier. With `angles` (per ring, in layout order) the laps follow from where the dots sit. `k` is the view scale (see closeFit). */
export function ringsGeometry(counts: Record<Ring, number>, angles: Partial<Record<Ring, number[]>> = {}, k = 1): RingsGeometry {
  const g: RingsGeometry = { radius: { ...RING_RADIUS }, dot: {} as Record<Ring, number>, perLap: {} as Record<Ring, number>, rings: WEB_RINGS.filter((r) => r !== Ring.Unsorted || counts[r]), lapOf: {}, extent: 0 }
  let prev = { r: 0, dot: 0, pushed: false }
  for (const ring of g.rings) {
    const n = Math.max(counts[ring] ?? 0, 1)
    // The ring keeps its place unless the one inside it overflowed (or was pushed) onto it; the close ring hugs the "you" avatar.
    let { r, dot } = ring === Ring.Closest ? closeFit(n, k) : { r: RING_RADIUS[ring], dot: Math.max(LEAST_DOT, Math.min(FULL_DOT, Math.floor((2 * Math.PI * RING_RADIUS[ring] * RING_FILL) / n))) }
    if (prev.pushed) r = Math.max(r, prev.r + (prev.dot + dot) / 2 + GAP)
    const per = around(r, dot)
    const mine = angles[ring]
    const lapOf = mine && packLaps(mine, r, dot)
    if (lapOf) g.lapOf[ring] = lapOf
    const laps = lapOf ? Math.max(0, ...lapOf) + 1 : Math.ceil(n / per)
    g.radius[ring] = r; g.dot[ring] = dot; g.perLap[ring] = per
    prev = { r: r + (laps - 1) * (dot + 1), dot, pushed: laps > 1 || r > RING_RADIUS[ring] }
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

