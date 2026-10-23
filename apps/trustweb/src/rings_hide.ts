/** Per-ring hide toggles of the Web rings: which rings' people are not drawn. View state only (I1), kept per device. */
import type { Ring } from './model'

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

export const visiblePeople = <P>(people: readonly P[], hidden: ReadonlySet<Ring>, slotOf: (p: P) => Ring): P[] => people.filter((p) => !hidden.has(slotOf(p)))

/** A hidden ring's guide circle stays drawn, dimmed, and shows in full while a person is dragged so the drop target is visible. */
export const guideDimmed = (hidden: boolean, dragging: boolean): boolean => hidden && !dragging
