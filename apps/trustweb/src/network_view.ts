/**
 * The Network view of the Web tab (wave 7): the force graph from network_graph.ts on a plain 2D canvas. Pan and zoom with
 * pointer, wheel and pinch; labels only when zoomed in or hovered (Logseq's behaviour); the search box highlights;
 * a tap on a person opens their card. Everything local (I1): the record never leaves this phone.
 */
import { el } from '../../demo/src/ui/dom'
import { Ring } from './model'
import type { Person } from './model'
import { LAYOUT_ITERATIONS, alphaAt, buildGraph, matchIds, shake, step } from './network_graph'
import type { Graph, GraphNode } from './network_graph'
import { S } from './strings'

export interface NetworkOptions {
  me: { id: string; displayName: string }
  people: readonly Person[]
  openPerson: (id: string) => void
  openMe: () => void
}

const LABEL_ZOOM = 1.5
const STEPS_PER_FRAME = 20
const TAP_SLOP = 6
const RING_VAR: Record<Ring, string> = { [Ring.Close]: '--violet', [Ring.Friend]: '--electric', [Ring.Acquaintance]: '--ink-soft', [Ring.Intending]: '' }

interface Camera { k: number; x: number; y: number }
interface Cached { key: string; graph: Graph; iteration: number; camera: Camera | null }
// One graph and camera per record, so a redraw of the screen keeps the picture where it settled.
let cached: Cached | null = null

function keyOf(o: NetworkOptions): string {
  return o.me.id + '|' + o.people.map((p) => p.id + p.ring + p.context + p.name).join('|')
}

export function createNetworkView(o: NetworkOptions): HTMLElement {
  const key = keyOf(o)
  if (!cached || cached.key !== key) cached = { key, graph: buildGraph(o.me, o.people), iteration: 0, camera: null }
  const state = cached
  const g = state.graph
  let matches = new Set<string>()
  let hover: GraphNode | null = null
  let dirty = true
  let touched = state.iteration >= LAYOUT_ITERATIONS && state.camera !== null
  let w = 0
  let h = 0

  const canvas = el('canvas', { class: 'net-canvas', role: 'img', 'aria-label': S.netAria(o.people.length) }) as HTMLCanvasElement
  const ctx = canvas.getContext('2d')
  const search = el('input', { class: 'field net-search', type: 'search', placeholder: S.netSearchPh, 'aria-label': S.netSearchPh, autocomplete: 'off' }) as HTMLInputElement
  const shakeBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { shake(g, Date.now()); state.iteration = 0; dirty = true } }, [S.netShake])
  const root = el('div', { class: 'net' }, [el('div', { class: 'net-bar' }, [search, shakeBtn]), canvas])

  const fit = (): Camera => {
    const r = Math.max(60, ...g.nodes.map((v) => Math.hypot(v.x, v.y)))
    const k = Math.min(w, h) / 2 / (r + 24)
    return { k, x: w / 2, y: h / 2 }
  }
  const cam = (): Camera => (state.camera ??= { k: 0.8, x: w / 2, y: h / 2 })
  const hit = (px: number, py: number): GraphNode | null => {
    const c = cam()
    let best: GraphNode | null = null
    let bestD = Infinity
    for (const v of g.nodes) {
      const d = Math.hypot(v.x * c.k + c.x - px, v.y * c.k + c.y - py)
      if (d <= Math.max(v.r * c.k, 10) + 4 && d < bestD) { best = v; bestD = d }
    }
    return best
  }

  const colour = (v: GraphNode): string => {
    const css = getComputedStyle(document.documentElement)
    if (v.ring === undefined) return css.getPropertyValue('--coral').trim() || '#FF715B'
    return RING_VAR[v.ring] ? css.getPropertyValue(RING_VAR[v.ring]).trim() : '#D8B978'
  }

  const draw = (): void => {
    if (!ctx || !w) return
    const c = cam()
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const css = getComputedStyle(document.documentElement)
    const ink = css.getPropertyValue('--ink').trim() || '#241B2E'
    const filtering = matches.size > 0 || search.value.trim() !== ''
    ctx.lineWidth = 1
    for (const e of g.edges) {
      const a = g.nodes[e.a]
      const b = g.nodes[e.b]
      const lit = !filtering || matches.has(a.id) || matches.has(b.id)
      ctx.strokeStyle = colour(b.ring !== undefined ? b : a)
      ctx.globalAlpha = lit ? (e.thin ? 0.14 : 0.28) : 0.05
      ctx.setLineDash(e.dashed ? [3, 4] : [])
      ctx.beginPath()
      ctx.moveTo(a.x * c.k + c.x, a.y * c.k + c.y)
      ctx.lineTo(b.x * c.k + c.x, b.y * c.k + c.y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.font = '600 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    for (const v of g.nodes) {
      const lit = !filtering || matches.has(v.id) || v.ring === undefined
      const x = v.x * c.k + c.x
      const y = v.y * c.k + c.y
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) continue
      const rad = v.r * Math.sqrt(c.k) * (matches.has(v.id) ? 1.5 : 1)
      ctx.globalAlpha = lit ? (v.faint ? 0.4 : 1) : 0.15
      ctx.fillStyle = colour(v)
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
      if (v === hover || matches.has(v.id) || v.ring === undefined || (c.k >= LABEL_ZOOM && lit)) {
        ctx.globalAlpha = 1
        ctx.fillStyle = ink
        ctx.fillText(v.name, x, y + rad + 12)
      }
    }
    ctx.globalAlpha = 1
  }

  const frame = (): void => {
    if (!canvas.isConnected) return // the screen was redrawn: this view is gone
    if (state.iteration < LAYOUT_ITERATIONS) {
      for (let i = 0; i < STEPS_PER_FRAME && state.iteration < LAYOUT_ITERATIONS; i++) step(g, alphaAt(state.iteration++))
      if (state.iteration >= LAYOUT_ITERATIONS && !touched) state.camera = fit()
      dirty = true
    }
    if (dirty) { dirty = false; draw() }
    requestAnimationFrame(frame)
  }

  const resize = (): void => {
    const box = root.getBoundingClientRect()
    if (!box.width) return
    const first = !w
    w = Math.floor(box.width) - 24
    h = Math.max(360, Math.floor(window.innerHeight * 0.62))
    const dpr = window.devicePixelRatio || 1
    canvas.width = w * dpr; canvas.height = h * dpr
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
    if (first && state.iteration >= LAYOUT_ITERATIONS && !touched) state.camera = fit()
    dirty = true
  }

  // Pointers: one = pan (or tap), two = pinch.
  const down = new Map<number, { x: number; y: number }>()
  let travelled = 0
  const local = (e: MouseEvent): { x: number; y: number } => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top } }
  const zoomAt = (px: number, py: number, factor: number): void => {
    touched = true
    const c = cam()
    const k = Math.min(8, Math.max(0.2, c.k * factor))
    c.x = px - (px - c.x) * (k / c.k); c.y = py - (py - c.y) * (k / c.k); c.k = k
    dirty = true
  }
  canvas.addEventListener('pointerdown', (e) => { touched = true; canvas.setPointerCapture(e.pointerId); down.set(e.pointerId, local(e)); travelled = 0 })
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e)
    const prev = down.get(e.pointerId)
    if (!prev) {
      const near = hit(p.x, p.y)
      if (near !== hover) { hover = near; dirty = true }
      return
    }
    const c = cam()
    if (down.size === 2) {
      const other = [...down.entries()].find(([id]) => id !== e.pointerId)?.[1] ?? prev
      const before = Math.hypot(prev.x - other.x, prev.y - other.y) || 1
      const after = Math.hypot(p.x - other.x, p.y - other.y) || 1
      zoomAt((p.x + other.x) / 2, (p.y + other.y) / 2, after / before)
    } else {
      c.x += p.x - prev.x; c.y += p.y - prev.y; dirty = true
    }
    travelled += Math.hypot(p.x - prev.x, p.y - prev.y)
    down.set(e.pointerId, p)
  })
  const release = (e: PointerEvent, tap: boolean): void => {
    const was = down.size
    down.delete(e.pointerId)
    if (!tap || was !== 1 || travelled > TAP_SLOP) return
    const p = local(e)
    const v = hit(p.x, p.y)
    if (v) (v.ring === undefined ? o.openMe() : o.openPerson(v.id))
  }
  canvas.addEventListener('pointerup', (e) => release(e, true))
  canvas.addEventListener('pointercancel', (e) => release(e, false))
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; dirty = true } })
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); const p = local(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)) }, { passive: false })
  search.addEventListener('input', () => { matches = matchIds(g, search.value); dirty = true })

  new ResizeObserver(resize).observe(root)
  requestAnimationFrame(frame)
  return root
}
