// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28b: the needle on a pinned Network dot (thin line, red dot on top, up and right of the dot) and the eased unpin: a press on the needle frees the dot, which glides to where the force layout would put it over ~1.5 s. Pure, no DOM. */
import { LAYOUT_ITERATIONS, alphaAt, step } from './network_graph'
import type { Graph } from './network_graph'

export const EASE_MS = 1500
export const NEEDLE_LEN = 16
const NEEDLE_HIT = 14

export const easeOut = (t: number): number => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3

export interface UnpinTween { from: { x: number; y: number }; to: { x: number; y: number }; at: number }
export const startUnpin = (from: { x: number; y: number }, to: { x: number; y: number }, now: number): UnpinTween => ({ from: { ...from }, to: { ...to }, at: now })

export function unpinAt(t: UnpinTween, now: number): { x: number; y: number; done: boolean } {
  const k = (now - t.at) / EASE_MS
  if (k >= 1) return { ...t.to, done: true }
  const e = easeOut(k)
  return { x: t.from.x + (t.to.x - t.from.x) * e, y: t.from.y + (t.to.y - t.from.y) * e, done: false }
}

/** The red head of the needle for a dot at (x, y) with screen radius rad. */
export const needleHead = (x: number, y: number, rad: number): { x: number; y: number } => ({ x: x + rad * 0.7 + NEEDLE_LEN * 0.5, y: y - rad * 0.7 - NEEDLE_LEN * 0.87 })

/** The id whose needle head is within a fingertip of (px, py); pins carry screen x, y, radius. */
export function needleAt(pins: readonly { id: string; x: number; y: number; r: number }[], px: number, py: number): string | null {
  let best: string | null = null
  let bestD = NEEDLE_HIT
  for (const p of pins) {
    const h = needleHead(p.x, p.y, p.r)
    const d = Math.hypot(h.x - px, h.y - py)
    if (d < bestD) { best = p.id; bestD = d }
  }
  return best
}

/** Where node `index` settles when it is free: the node and its neighbours relax, everyone else (and the neighbours) holds still. The graph itself is not touched. */
export function settleTarget(g: Graph, index: number): { x: number; y: number } {
  const keep = new Set<number>([index])
  for (const e of g.edges) { if (e.a === index) keep.add(e.b); if (e.b === index) keep.add(e.a) }
  const map = [...keep]
  const sub: Graph = {
    nodes: map.map((i) => ({ ...g.nodes[i], vx: 0, vy: 0, pinned: i !== index })),
    edges: g.edges.filter((e) => keep.has(e.a) && keep.has(e.b)).map((e) => ({ ...e, a: map.indexOf(e.a), b: map.indexOf(e.b) })),
  }
  const at = map.indexOf(index)
  for (let i = 0; i < LAYOUT_ITERATIONS; i++) step(sub, alphaAt(i))
  return { x: sub.nodes[at].x, y: sub.nodes[at].y }
}
