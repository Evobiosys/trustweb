// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37: the ring lines' stroke, and the hit test that opens a ring's card only on the stroke itself. Pure, DOM-free. */
import { Ring } from './model'
import type { RingsGeometry } from './rings_layout'

/** A card opens when the pointer sits within this many px of the stroke's edge, each side. */
export const RING_HIT_TOLERANCE_PX = 4

/** Stroke width (view px) of each ring's line; the intending line stays clearly thinner than the acquaintance line. */
export const RING_STROKE_WIDTH: Partial<Record<Ring, number>> = { [Ring.Close]: 2.2, [Ring.Acquaintance]: 1.4, [Ring.Friend]: 1.4, [Ring.Closest]: 1.4, [Ring.Unsorted]: 1.4, [Ring.Intending]: 1 }

/** Stroke opacity of each ring's line; intending was a faint .55 and is now readable on light and dark. */
export const RING_STROKE_OPACITY: Partial<Record<Ring, number>> = { [Ring.Unsorted]: 0.35, [Ring.Intending]: 0.9 }

export const ringStrokeWidth = (r: Ring): number => RING_STROKE_WIDTH[r] ?? 1.4
export const ringStrokeOpacity = (r: Ring): number => RING_STROKE_OPACITY[r] ?? 0.55

/** The ring whose stroke the point (rings' layout px) sits on, else null. `k` scales the geometry radii to view px. */
export function onRingLine(geo: Pick<RingsGeometry, 'radius' | 'rings'>, at: { x: number; y: number }, k: number, size = 352): Ring | null {
  const dist = Math.hypot(at.x - size / 2, at.y - size / 2)
  for (const r of geo.rings) if (Math.abs(geo.radius[r] * k - dist) <= ringStrokeWidth(r) / 2 + RING_HIT_TOLERANCE_PX) return r
  return null
}
