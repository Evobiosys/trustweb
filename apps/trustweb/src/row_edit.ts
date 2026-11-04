// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30: edit a person row in place. Which ring group a dragged row lands on. Pure, DOM-free; the name edit is `nameEdit` (ring_hover.ts). */
import type { Ring } from './model'

export interface ZoneBox { ring: Ring; left: number; top: number; right: number; bottom: number }

/** The ring of the group box the point lies in, or null. */
export function dropRing(boxes: readonly ZoneBox[], x: number, y: number): Ring | null {
  return boxes.find((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)?.ring ?? null
}

/** The ring a drop moves the person to; null when it left the groups or stayed in its own. */
export function dragMovedTo(from: Ring, over: Ring | null): Ring | null {
  return over === null || over === from ? null : over
}
