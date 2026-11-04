// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30: edit a person row in place. Archive and restore, and which ring group a dragged row lands on. Pure, DOM-free; the name edit is `nameEdit` (ring_hover.ts). */
import { Ring } from './model'
import type { Person } from './model'

/** Files the person under "Not in my web" (Ring.None), remembering the ring for a restore. */
export function archiveOf(p: Pick<Person, 'ring' | 'prevRing'>): void {
  if (p.ring === Ring.None) return
  p.prevRing = p.ring
  p.ring = Ring.None
}

/** Brings an archived person back to the ring they had, else "not placed yet". */
export function restoreOf(p: Pick<Person, 'ring' | 'prevRing'>): void {
  p.ring = p.prevRing ?? Ring.Unsorted
  delete p.prevRing
}

export interface ZoneBox { ring: Ring; left: number; top: number; right: number; bottom: number }

/** The ring of the group box the point lies in, or null. */
export function dropRing(boxes: readonly ZoneBox[], x: number, y: number): Ring | null {
  return boxes.find((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)?.ring ?? null
}

/** The ring a drop moves the person to; null when it left the groups or stayed in its own. */
export function dragMovedTo(from: Ring, over: Ring | null): Ring | null {
  return over === null || over === from ? null : over
}
