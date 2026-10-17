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

/** The rings drawn as tiers: unsorted is outermost (grey, old "none"), outside is "not in my web". Family takes its closeness's tier. */
export type Tier = Exclude<Ring, Ring.None | Ring.Family> | 'outside'
/** Distance from me per ring; "intending" spreads over INTENDING_NEAR (desire 10) to INTENDING_FAR (desire 0). */
const REST: Record<Tier, number> = { [Ring.Close]: 60, [Ring.Friend]: 100, [Ring.Acquaintance]: 150, [Ring.Intending]: 215, [Ring.Unsorted]: 260, outside: 260 }
const INTENDING_NEAR = 175
/** Four greens (darkest = closest), unsorted grey. */
export const TIER_COLOUR: Record<Tier, string> = {
  [Ring.Close]: '#0b5d2a', [Ring.Friend]: '#2e8b4a', [Ring.Acquaintance]: '#6fbf73', [Ring.Intending]: '#a9dca0', [Ring.Unsorted]: '#9a9aa6', outside: '#9a9aa6',
}
/** The purple accent ring drawn around a family node. */
export const FAMILY_COLOUR = '#7a3fc4'
const F_FAMOUS = '6QzDHIfrlmSz'
const F_DECEASED = '__XNQ42Dtiwx'
const PEER_REST = 40
const LINK_REST = 50
/** Tana attribute ids on a person's `fields` (a record imported from Tana). */
const F_MET_THROUGH = 'X3aA3ndYjClT'
const F_COMMUNITY = 'yHXufuk2A7rt'
const F_WORKS_FOR = 'zHVsAk7dqNyT'
/** A shared "workspace: x" line links people only below this many; more would be a hairball. */
const WORKSPACE_MAX = 40

export interface GraphNode {
  id: string
  name: string
  context: string
  /** Absent on the centre node (me). */
  tier?: Tier
  /** Family tag: a purple accent ring; the distance still comes from the ring. */
  family?: boolean
  /** Intending only: how much I want to connect, 0 to 10. */
  desire?: number
  x: number
  y: number
  vx: number
  vy: number
  /** Draw radius at zoom 1. */
  r: number
  pinned: boolean
  /** Has a person-to-person edge (drawn a little larger). */
  linked?: boolean
  /** No fields and no notes: a name-only entry (drawn dimmer). */
  faint?: boolean
}

/** The sliders of the Forces panel; `DEFAULT_FORCES` reproduces the layout as it was before they existed. */
export interface Forces { link: number; charge: number; gravity: number; collide: number; labelZoom: number }
export const DEFAULT_FORCES: Forces = { link: 1, charge: 260, gravity: 0.002, collide: 0, labelZoom: 1.5 }

export interface GraphEdge { a: number; b: number; rest: number; dashed: boolean; thin?: boolean }
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

type FieldValue = string | { label?: string; tanaId?: string }[] | undefined
const fieldsOf = (p: Person): Record<string, FieldValue> => (p as Person & { fields?: Record<string, FieldValue> }).fields ?? {}

function refIds(v: FieldValue): string[] {
  return Array.isArray(v) ? v.flatMap((r) => (r && typeof r.tanaId === 'string' ? [r.tanaId] : [])) : []
}

/** Person-to-person links from the imported fields: [index, index, thin] over `people`. */
export function personLinks(people: readonly Person[]): [number, number, boolean][] {
  const index = new Map(people.map((p, i) => [p.id, i]))
  const seen = new Set<string>()
  const out: [number, number, boolean][] = []
  const add = (a: number, b: number, thin: boolean): void => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`
    if (a === b || seen.has(k)) return
    seen.add(k)
    out.push([a, b, thin])
  }
  const groups = new Map<string, number[]>()
  const group = (key: string, i: number): void => { const g = groups.get(key); if (g) g.push(i); else groups.set(key, [i]) }
  people.forEach((p, i) => {
    const f = fieldsOf(p)
    for (const key of [F_MET_THROUGH, F_WORKS_FOR]) {
      for (const id of refIds(f[key])) { const j = index.get('tana-' + id); if (j !== undefined) add(i, j, false) }
    }
    for (const id of refIds(f[F_COMMUNITY])) group('c:' + id, i)
    for (const l of p.lines) if (l.text?.startsWith('workspace:')) group('w:' + l.text.trim().toLowerCase(), i)
  })
  for (const [key, members] of groups) {
    if (key.startsWith('w:') && members.length >= WORKSPACE_MAX) continue
    for (let m = 1; m < members.length; m++) add(members[m - 1], members[m], true)
  }
  return out
}

/** Rings as stored: the older "family" ring (closeness gave the distance) and "close_friend" still read. */
type Stored = Person & { tags?: string[]; closeness?: string; desire?: number }

export const isFamily = (p: Person): boolean => (p.ring as string) === 'family' || ((p as Stored).tags ?? []).includes('family')

/** The tier a person is drawn in. */
export function tierOf(p: Person): Tier {
  let ring = p.ring as string
  if (ring === 'family') ring = (p as Stored).closeness ?? Ring.Close
  if (ring === 'close_friend') ring = Ring.Close
  if (ring === 'outside') return ring
  if (ring !== Ring.None && (Object.values(Ring) as string[]).includes(ring)) return ring as Tier
  // old "none": calendar ids (an "@" in the name), famous and deceased people are not in my web
  const f = fieldsOf(p)
  return p.name.includes('@') || f[F_FAMOUS] || f[F_DECEASED] ? 'outside' : Ring.Unsorted
}

/** Desire 0..10 of an intending person (absent or out of range: 0). */
export const desireOf = (p: Person): number => Math.min(10, Math.max(0, Math.round(Number((p as Stored).desire) || 0)))

function restOf(t: Tier, desire: number): number {
  return t === Ring.Intending ? REST[t] - ((REST[t] - INTENDING_NEAR) * desire) / 10 : REST[t]
}

export function buildGraph(me: { id: string; displayName: string }, people: readonly Person[]): Graph {
  const nodes: GraphNode[] = [{ id: me.id, name: me.displayName, context: '', x: 0, y: 0, vx: 0, vy: 0, r: 12, pinned: true }]
  const edges: GraphEdge[] = []
  const lastInContext = new Map<string, number>()
  for (const p of people) {
    const angle = (hash(p.id) / 4294967296) * Math.PI * 2
    const i = nodes.length
    const tier = tierOf(p)
    const desire = tier === Ring.Intending ? desireOf(p) : undefined
    const rest = restOf(tier, desire ?? 0)
    nodes.push({ id: p.id, name: p.name, context: p.context, tier, ...(isFamily(p) ? { family: true } : {}), ...(desire === undefined ? {} : { desire }), x: Math.cos(angle) * rest, y: Math.sin(angle) * rest, vx: 0, vy: 0, r: radiusOf(p), pinned: false, faint: p.lines.length === 0 && Object.keys(fieldsOf(p)).length === 0 })
    edges.push({ a: 0, b: i, rest, dashed: tier === Ring.Intending })
    const key = p.context.trim().toLowerCase()
    if (!key) continue
    const prev = lastInContext.get(key)
    if (prev !== undefined) edges.push({ a: prev, b: i, rest: PEER_REST, dashed: false })
    lastInContext.set(key, i)
  }
  for (const [a, b, thin] of personLinks(people)) {
    edges.push({ a: a + 1, b: b + 1, rest: thin ? PEER_REST : LINK_REST, dashed: false, thin })
    nodes[a + 1].linked = nodes[b + 1].linked = true
  }
  for (const v of nodes) if (v.linked) v.r += 2
  return { nodes, edges }
}

/** One relaxation step; `alpha` (1 -> 0) cools the movement so the picture settles. */
export function step(g: Graph, alpha: number, f: Forces = DEFAULT_FORCES): void {
  const { nodes, edges } = g
  const n = nodes.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let dx = nodes[j].x - nodes[i].x
      let dy = nodes[j].y - nodes[i].y
      let d2 = dx * dx + dy * dy
      if (d2 > 90000) continue
      if (d2 < 0.01) { dx = (i % 7) - 3; dy = (j % 5) - 2; d2 = dx * dx + dy * dy + 0.01 }
      let push = (alpha * f.charge) / d2
      if (f.collide > 0 && d2 < f.collide * f.collide) push += (alpha * (f.collide - Math.sqrt(d2)) * 0.5) / Math.sqrt(d2)
      nodes[i].vx -= dx * push; nodes[i].vy -= dy * push
      nodes[j].vx += dx * push; nodes[j].vy += dy * push
    }
  }
  for (const e of edges) {
    const a = nodes[e.a]
    const b = nodes[e.b]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 0.01
    const pull = ((d - e.rest * f.link) / d) * 0.08 * alpha
    a.vx += dx * pull; a.vy += dy * pull
    b.vx -= dx * pull; b.vy -= dy * pull
  }
  for (const v of nodes) {
    if (v.pinned) { v.vx = 0; v.vy = 0; continue }
    v.vx -= v.x * f.gravity * alpha; v.vy -= v.y * f.gravity * alpha
    v.x += v.vx; v.y += v.vy
    v.vx *= 0.6; v.vy *= 0.6
  }
}

export function alphaAt(iteration: number, total = LAYOUT_ITERATIONS): number {
  return Math.max(0, 1 - iteration / total)
}

/** Pinned positions by person id (the centre node is always fixed and never listed). Same shape as the reference map's anchors. */
export type Pins = Record<string, { x: number; y: number; a: true }>

export function applyPins(g: Graph, pins: Pins): void {
  for (const v of g.nodes) {
    const p = v.tier === undefined ? undefined : pins[v.id]
    if (p) { v.x = p.x; v.y = p.y; v.pinned = true }
  }
}

export function pinsOf(g: Graph): Pins {
  const out: Pins = {}
  for (const v of g.nodes) if (v.pinned && v.tier !== undefined) out[v.id] = { x: Math.round(v.x * 10) / 10, y: Math.round(v.y * 10) / 10, a: true }
  return out
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
