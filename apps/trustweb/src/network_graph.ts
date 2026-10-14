/**
 * The Network view's data and layout (wave 7): me pinned at the centre, one node per person, edges me -> person by ring
 * (closer = shorter) and person -> person where two people share the same "where met" text. A small force layout
 * (spring + repulsion + gravity), seeded deterministically so a reload settles the same way. Pure: no DOM, no storage.
 * Same family as Logseq's graph view (graphology + ForceAtlas2) without the dependency.
 */
import { LineStatus, Ring } from './model'
import type { Person } from './model'

export const NETWORK_DEFAULT_ABOVE = 60
export const LAYOUT_ITERATIONS = 300

const REST: Record<Ring, number> = { [Ring.Close]: 60, [Ring.Friend]: 100, [Ring.Acquaintance]: 150, [Ring.Intending]: 200 }
const PEER_REST = 40

export interface GraphNode {
  id: string
  name: string
  context: string
  /** Absent on the centre node (me). */
  ring?: Ring
  x: number
  y: number
  vx: number
  vy: number
  /** Draw radius at zoom 1. */
  r: number
  pinned: boolean
}

export interface GraphEdge { a: number; b: number; rest: number; dashed: boolean }
export interface Graph { nodes: GraphNode[]; edges: GraphEdge[] }

export function defaultsToNetwork(people: number): boolean {
  return people > NETWORK_DEFAULT_ABOVE
}

function hash(s: string): number {
  let h = 2166136261
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0
  return h
}

/** Node size by activity: current note lines (grows slowly, capped). */
function radiusOf(p: Person): number {
  const n = p.lines.filter((l) => l.status === LineStatus.Current).length
  return 4 + Math.min(6, Math.sqrt(n) * 1.5)
}

export function buildGraph(me: { id: string; displayName: string }, people: readonly Person[]): Graph {
  const nodes: GraphNode[] = [{ id: me.id, name: me.displayName, context: '', x: 0, y: 0, vx: 0, vy: 0, r: 12, pinned: true }]
  const edges: GraphEdge[] = []
  const lastInContext = new Map<string, number>()
  for (const p of people) {
    const angle = (hash(p.id) / 4294967296) * Math.PI * 2
    const i = nodes.length
    nodes.push({ id: p.id, name: p.name, context: p.context, ring: p.ring, x: Math.cos(angle) * REST[p.ring], y: Math.sin(angle) * REST[p.ring], vx: 0, vy: 0, r: radiusOf(p), pinned: false })
    edges.push({ a: 0, b: i, rest: REST[p.ring], dashed: p.ring === Ring.Intending })
    const key = p.context.trim().toLowerCase()
    if (!key) continue
    const prev = lastInContext.get(key)
    if (prev !== undefined) edges.push({ a: prev, b: i, rest: PEER_REST, dashed: false })
    lastInContext.set(key, i)
  }
  return { nodes, edges }
}

/** One relaxation step; `alpha` (1 -> 0) cools the movement so the picture settles. */
export function step(g: Graph, alpha: number): void {
  const { nodes, edges } = g
  const n = nodes.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = nodes[j].x - nodes[i].x
      let dy = nodes[j].y - nodes[i].y
      let d2 = dx * dx + dy * dy
      if (d2 > 90000) continue
      if (d2 < 0.01) { dx = (i % 7) - 3; dy = (j % 5) - 2; d2 = dx * dx + dy * dy + 0.01 }
      const f = (alpha * 260) / d2
      nodes[i].vx -= dx * f; nodes[i].vy -= dy * f
      nodes[j].vx += dx * f; nodes[j].vy += dy * f
    }
  }
  for (const e of edges) {
    const a = nodes[e.a]
    const b = nodes[e.b]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 0.01
    const f = ((d - e.rest) / d) * 0.08 * alpha
    a.vx += dx * f; a.vy += dy * f
    b.vx -= dx * f; b.vy -= dy * f
  }
  for (const v of nodes) {
    if (v.pinned) { v.x = 0; v.y = 0; v.vx = 0; v.vy = 0; continue }
    v.vx -= v.x * 0.002 * alpha; v.vy -= v.y * 0.002 * alpha
    v.x += v.vx; v.y += v.vy
    v.vx *= 0.6; v.vy *= 0.6
  }
}

export function alphaAt(iteration: number, total = LAYOUT_ITERATIONS): number {
  return Math.max(0, 1 - iteration / total)
}

/** Scatter every free node a little, so a new run can find another resting place ("shake"). */
export function shake(g: Graph, seed: number): void {
  for (const v of g.nodes) {
    if (v.pinned) continue
    const h = hash(v.id + seed)
    v.x += ((h & 255) / 255 - 0.5) * 120
    v.y += (((h >>> 8) & 255) / 255 - 0.5) * 120
  }
}

/** Nodes whose name or context contains the needle; empty needle matches nobody (nothing to highlight). */
export function matchIds(g: Graph, needle: string): Set<string> {
  const q = needle.trim().toLowerCase()
  const out = new Set<string>()
  if (!q) return out
  for (const v of g.nodes) if (v.name.toLowerCase().includes(q) || v.context.toLowerCase().includes(q)) out.add(v.id)
  return out
}
