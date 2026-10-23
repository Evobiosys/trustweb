/** Per-ring hide toggles of the Web rings: which rings' people are not drawn. View state only (I1), kept per device. */
import type { Person, Ring } from './model'
import { webSlot } from './rings_layout'

export const RINGS_HIDDEN_KEY = 'trustweb.ui.ringsHidden'

export function parseHidden(raw: string | null): ReadonlySet<Ring> {
  try {
    const v: unknown = JSON.parse(raw ?? '[]')
    return new Set(Array.isArray(v) ? v.filter((r): r is Ring => typeof r === 'string') : [])
  } catch { return new Set() }
}

export const serializeHidden = (hidden: ReadonlySet<Ring>): string => JSON.stringify([...hidden])

export function toggleHidden(hidden: ReadonlySet<Ring>, ring: Ring): ReadonlySet<Ring> {
  const next = new Set(hidden)
  if (!next.delete(ring)) next.add(ring)
  return next
}

/** A person hides with the ring they are DRAWN on (webSlot: missing, none and suggested rings sit on Unsorted), never with another. */
export const visiblePeople = <P extends Pick<Person, 'ring' | 'fields' | 'ringSuggested'>>(people: readonly P[], hidden: ReadonlySet<Ring>, slotOf: (p: P) => Ring = webSlot): P[] => people.filter((p) => !hidden.has(slotOf(p)))

/** A hidden ring's guide circle stays drawn, dimmed, and shows in full while a person is dragged so the drop target is visible. */
export const guideDimmed = (hidden: boolean, dragging: boolean): boolean => hidden && !dragging

/** Where the ring toggles sit: one vertical column straight up from "you" (left = centre), each at its own ring radius (radii inner to outer);
 *  a crowded web packs rings together, so a diamond that would sit less than TOGGLE_GAP below the previous one is pushed outward. */
export const TOGGLE_GAP = 22
export function togglePoints(radii: readonly number[], centre: number, k: number): { left: number; top: number }[] {
  let prev = Infinity
  return radii.map((r) => {
    const top = Math.min(centre - r * k, prev - TOGGLE_GAP)
    prev = top
    return { left: centre, top }
  })
}
