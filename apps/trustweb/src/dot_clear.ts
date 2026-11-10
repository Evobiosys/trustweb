// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39: bubbles never overlap on the Web: each shrinks just enough to clear its neighbours and the fixed discs (the "you" avatar). Pure, layout px, zoom-free. */
import type { Spot } from './rings_layout'

export interface DotDisc { id: string; x: number; y: number; r: number }

/** The smallest radius a bubble shrinks to (a 12 px dot); two dots on one spot stay overlapped rather than vanish. */
export const MIN_DOT_R = 6
/** Space kept between two bubbles. */
const GAP = 1
const PASSES = 8

/** The radius each dot is drawn at: its own, or smaller where a neighbour (or a fixed disc) is closer than both radii together. */
export function clearDots(dots: readonly DotDisc[], fixed: readonly Spot[]): Map<string, number> {
  const r = new Map(dots.map((d) => [d.id, d.r]))
  const byX = [...dots].sort((a, b) => a.x - b.x)   // sweep: only dots within two radii in x can touch
  const reach = 2 * Math.max(0, ...dots.map((d) => d.r)) + GAP
  for (let pass = 0; pass < PASSES; pass++) {
    let changed = false
    for (const d of dots) for (const f of fixed) {
      const room = Math.max(MIN_DOT_R, Math.hypot(d.x - f.x, d.y - f.y) - f.r - GAP)
      if (r.get(d.id)! > room) { r.set(d.id, room); changed = true }
    }
    for (let i = 0; i < byX.length; i++) for (let j = i + 1; j < byX.length && byX[j].x - byX[i].x <= reach; j++) {
      const a = byX[i], b = byX[j]
      const ra = r.get(a.id)!, rb = r.get(b.id)!
      const room = Math.hypot(a.x - b.x, a.y - b.y) - GAP
      if (ra + rb <= room) continue
      const f = Math.max(0, room) / (ra + rb)
      r.set(a.id, Math.max(MIN_DOT_R, ra * f)); r.set(b.id, Math.max(MIN_DOT_R, rb * f))
      changed = true
    }
    if (!changed) break
  }
  return r
}
