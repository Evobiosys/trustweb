/**
 * The Network view of the Web tab (wave 7): the force graph from network_graph.ts on a plain 2D canvas. Pan and zoom with
 * pointer, wheel and pinch; labels only when zoomed in or hovered (Logseq's behaviour); the search box highlights;
 * a tap on a person opens their card. Everything local (I1): the record never leaves this phone.
 */
import { el } from '../../demo/src/ui/dom'
import type { Person } from './model'
import { DEFAULT_FORCES, LAYOUT_ITERATIONS, alphaAt, applyPins, buildGraph, pinsOf, matchIds, shake, step, tierOf, FAMILY_COLOUR, TIER_COLOUR } from './network_graph'
import type { Forces, Graph, GraphEdge, GraphNode, Pins } from './network_graph'
import { S } from './strings'

export interface NetworkOptions {
  me: { id: string; displayName: string }
  people: readonly Person[]
  openPerson: (id: string) => void
  openMe: () => void
}

const SETTINGS_KEY = 'trustweb.ui.netSettings'
const PINS_KEY = 'trustweb.ui.netPins'
const LONG_PRESS_MS = 500
const DOUBLE_TAP_MS = 320
const LOGSEQ = { bg: '#00323a', edge: '#b8d2d6', node: '#8c9ea2', lit: '#eef6f7', label: '#c5d6d9' }
const STEPS_PER_FRAME = 20
const TAP_SLOP = 6

/** Per device: the Logseq look, the forces, and whether people outside my web (tier "outside") are drawn. */
interface Settings { logseq: boolean; showAll: boolean; forces: Forces }
function loadSettings(): Settings {
  try {
    const v = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>
    return { logseq: v.logseq === true, showAll: v.showAll === true, forces: { ...DEFAULT_FORCES, ...v.forces } }
  } catch { return { logseq: false, showAll: false, forces: { ...DEFAULT_FORCES } } }
}
function saveSettings(v: Settings): void {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(v)) } catch { /* not remembered */ }
}

/** Pins per device, by person id: they survive reloads and "Shake". */
function loadPins(): Pins {
  try { return JSON.parse(window.localStorage.getItem(PINS_KEY) ?? '{}') as Pins } catch { return {} }
}
function savePins(g: Graph): void {
  try { window.localStorage.setItem(PINS_KEY, JSON.stringify(pinsOf(g))) } catch { /* not remembered */ }
}

function download(name: string, blob: Blob): void {
  const a = el('a', { href: URL.createObjectURL(blob), download: name }) as HTMLAnchorElement
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

interface Camera { k: number; x: number; y: number }
interface Cached { key: string; graph: Graph; iteration: number; camera: Camera | null }
// One graph and camera per record, so a redraw of the screen keeps the picture where it settled.
let cached: Cached | null = null

function keyOf(o: NetworkOptions): string {
  return o.me.id + '|' + o.people.map((p) => p.id + p.ring + tierOf(p) + p.context + p.name + (p.knows ?? []).join(',')).join('|')
}

export function createNetworkView(o: NetworkOptions): HTMLElement {
  const settings = loadSettings()
  const people = settings.showAll ? o.people : o.people.filter((p) => tierOf(p) !== 'outside')
  const key = keyOf({ ...o, people }) + (settings.showAll ? '+all' : '')
  if (!cached || cached.key !== key) cached = { key, graph: buildGraph(o.me, people), iteration: 0, camera: null }
  if (cached.iteration === 0 && cached.camera === null) applyPins(cached.graph, loadPins())
  const state = cached
  const g = state.graph
  const near = g.nodes.map(() => new Set<number>())
  for (const e of g.edges) { near[e.a].add(e.b); near[e.b].add(e.a) }
  let matches = new Set<string>()
  let hover: GraphNode | null = null
  let dirty = true
  let touched = state.iteration >= LAYOUT_ITERATIONS && state.camera !== null
  let w = 0
  let h = 0

  const canvas = el('canvas', { class: 'net-canvas', role: 'img', 'aria-label': S.netAria(people.length) }) as HTMLCanvasElement
  const ctx = canvas.getContext('2d')
  const search = el('input', { class: 'field net-search', type: 'search', placeholder: S.netSearchPh, 'aria-label': S.netSearchPh, autocomplete: 'off' }) as HTMLInputElement
  const shakeBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { shake(g, Date.now()); state.iteration = 0; dirty = true } }, [S.netShake])
  const rebuild = (): void => { saveSettings(settings); root.replaceWith(createNetworkView(o)) }
  const reheat = (): void => { saveSettings(settings); state.iteration = 0; dirty = true }
  const check = (label: string, on: boolean, set: (v: boolean) => void): HTMLElement =>
    el('label', { class: 'net-check' }, [el('input', { type: 'checkbox', ...(on ? { checked: '' } : {}), onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }), ' ' + label])
  const slider = (label: string, k: keyof Forces, min: number, max: number, stepBy: number): HTMLElement =>
    el('label', { class: 'net-slider' }, [label, el('input', { type: 'range', min: String(min), max: String(max), step: String(stepBy), value: String(settings.forces[k]), 'aria-label': label,
      oninput: (e: Event) => { settings.forces[k] = Number((e.target as HTMLInputElement).value); reheat() } })])
  const exportPng = (): void => { draw(); canvas.toBlob((b) => { if (b) download('network.png', b) }, 'image/png') }
  const exportJson = (): void => {
    const data = { positions: Object.fromEntries(g.nodes.map((v) => [v.id, { x: Math.round(v.x), y: Math.round(v.y) }])), anchors: pinsOf(g), layoutMode: 'dynamic',
      nodes: g.nodes.map((v) => ({ id: v.id, name: v.name, tier: v.tier ?? null })), edges: g.edges.map((e) => ({ a: g.nodes[e.a].id, b: g.nodes[e.b].id })) }
    download('network.json', new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }))
  }
  const menu = el('div', { class: 'net-menu', hidden: '' }, [
    check(S.netLogseq, settings.logseq, (v) => { settings.logseq = v; saveSettings(settings); dirty = true }),
    check(S.netShowAll, settings.showAll, (v) => { settings.showAll = v; rebuild() }),
    el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { for (const v of g.nodes) if (v.tier !== undefined) v.pinned = false; savePins(g); reheat() } }, [S.netUnpinAll]),
    el('strong', {}, [S.netForces]),
    slider(S.netLink, 'link', 0.3, 3, 0.1), slider(S.netCharge, 'charge', 20, 2000, 20), slider(S.netGravity, 'gravity', 0, 0.02, 0.0005),
    slider(S.netCollide, 'collide', 0, 60, 2), slider(S.netLabels, 'labelZoom', 0.3, 4, 0.1),
    el('div', { class: 'net-bar' }, [
      el('button', { class: 'btn btn-ghost btn-sm', onclick: () => { settings.forces = { ...DEFAULT_FORCES }; state.iteration = 0; rebuild() } }, [S.netReset]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: exportPng }, [S.netPng]),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: exportJson }, [S.netJson]),
    ]),
  ])
  const menuBtn = el('button', { class: 'btn btn-ghost btn-sm', 'aria-label': S.netMenu, onclick: () => { menu.hidden = !menu.hidden } }, ['⋯'])
  const tip = el('div', { class: 'net-tip', 'data-net-tip': '', hidden: '' })
  let tipTimer = 0
  const root = el('div', { class: 'net', 'data-view': 'network' }, [el('div', { class: 'net-bar' }, [search, shakeBtn, menuBtn]), menu, canvas, tip, el('small', { class: 'net-legend' }, [S.netLegend])])

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

  // The nearest member connection within a fingertip of (px, py), for the "<a> knows <b>" tooltip.
  const hitEdge = (px: number, py: number): GraphEdge | null => {
    const c = cam()
    let best: GraphEdge | null = null
    let bestD = 8
    for (const e of g.edges) {
      if (!e.knows) continue
      const a = g.nodes[e.a]; const b = g.nodes[e.b]
      const ax = a.x * c.k + c.x; const ay = a.y * c.k + c.y
      const dx = b.x * c.k + c.x - ax; const dy = b.y * c.k + c.y - ay
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)))
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy)
      if (d < bestD) { best = e; bestD = d }
    }
    return best
  }
  const showTip = (e: GraphEdge): void => {
    const a = g.nodes[e.a].name; const b = g.nodes[e.b].name
    tip.textContent = e.knows === 'mutual' ? S.netKnowsBoth(a, b) : S.netKnows(a, b)
    tip.hidden = false
    clearTimeout(tipTimer)
    tipTimer = window.setTimeout(() => { tip.hidden = true }, 3500)
  }

  const colour = (v: GraphNode): string =>
    v.tier === undefined ? getComputedStyle(document.documentElement).getPropertyValue('--coral').trim() || '#FF715B' : TIER_COLOUR[v.tier]

  const label = (v: GraphNode): string => (v.desire === undefined ? v.name : `${v.name} · ${S.netWants(v.desire)}`)

  const draw = (): void => {
    if (!ctx) return
    const c = cam()
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const css = getComputedStyle(document.documentElement)
    const ink = css.getPropertyValue('--ink').trim() || '#241B2E'
    const lq = settings.logseq
    if (lq) { ctx.fillStyle = LOGSEQ.bg; ctx.fillRect(0, 0, w, h) }
    const filtering = matches.size > 0 || search.value.trim() !== ''
    const focus = hover ? new Set<number>([g.nodes.indexOf(hover), ...near[g.nodes.indexOf(hover)]]) : null
    const inFocus = (i: number): boolean => (!focus || focus.has(i)) && (!filtering || matches.has(g.nodes[i].id) || g.nodes[i].tier === undefined)
    const baseWidth = lq ? 0.6 : 1
    for (const e of g.edges) {
      const a = g.nodes[e.a]
      const b = g.nodes[e.b]
      const lit = lq ? !focus || (focus.has(e.a) && focus.has(e.b)) : !filtering || matches.has(a.id) || matches.has(b.id)
      ctx.strokeStyle = lq ? LOGSEQ.edge : colour(b.tier !== undefined ? b : a)
      ctx.globalAlpha = lit ? (e.knows ? 0.8 : lq ? (focus ? 0.8 : 0.3) : e.thin ? 0.14 : 0.28) : 0.05
      ctx.lineWidth = e.knows === 'mutual' ? 3 : e.knows ? 1.2 : baseWidth
      ctx.setLineDash(e.dashed ? [3, 4] : [])
      ctx.beginPath()
      ctx.moveTo(a.x * c.k + c.x, a.y * c.k + c.y)
      ctx.lineTo(b.x * c.k + c.x, b.y * c.k + c.y)
      ctx.stroke()
    }
    ctx.setLineDash([])
    ctx.lineWidth = baseWidth
    ctx.font = lq ? '10px system-ui, sans-serif' : '600 11px system-ui, sans-serif'
    ctx.textAlign = 'center'
    const fade = Math.min(1, c.k / settings.forces.labelZoom)
    g.nodes.forEach((v, i) => {
      const lit = lq ? inFocus(i) : !filtering || matches.has(v.id) || v.tier === undefined
      const x = v.x * c.k + c.x
      const y = v.y * c.k + c.y
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) return
      const rad = lq ? (1.5 + Math.sqrt(near[i].size) * 1.1) * Math.sqrt(c.k) * (matches.has(v.id) ? 1.6 : 1) : v.r * Math.sqrt(c.k) * (matches.has(v.id) ? 1.5 : 1)
      ctx.globalAlpha = lit ? (!lq && v.faint ? 0.4 : 1) : 0.15
      ctx.fillStyle = lq ? (v === hover || matches.has(v.id) ? LOGSEQ.lit : LOGSEQ.node) : colour(v)
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
      if (v.family) {
        ctx.strokeStyle = FAMILY_COLOUR; ctx.lineWidth = 2.5; ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(x, y, rad + 3, 0, Math.PI * 2); ctx.stroke()
        ctx.lineWidth = lq ? 0.6 : 1
      }
      if (v.pinned && v.tier !== undefined) {
        ctx.globalAlpha = 1
        ctx.fillStyle = lq ? LOGSEQ.lit : ink
        ctx.beginPath(); ctx.arc(x + rad * 0.8, y - rad * 0.8, 3.2, 0, Math.PI * 2); ctx.fill()
        ctx.globalAlpha = lit ? 1 : 0.15
      }
      if (lq) {
        const a = lit ? fade : fade * 0.15
        if (a < 0.5 * (lit ? 1 : 0.15) && v !== hover && !matches.has(v.id)) return
        ctx.globalAlpha = v === hover || matches.has(v.id) ? 1 : a
        ctx.fillStyle = v === hover ? LOGSEQ.lit : LOGSEQ.label
        ctx.fillText(label(v), x, y + rad + 10)
      } else if (v === hover || matches.has(v.id) || v.tier === undefined || (c.k >= settings.forces.labelZoom && lit)) {
        ctx.globalAlpha = 1
        ctx.fillStyle = ink
        ctx.fillText(label(v), x, y + rad + 12)
      }
    })
    ctx.globalAlpha = 1
  }

  const frame = (): void => {
    if (!canvas.isConnected) return // the screen was redrawn: this view is gone
    if (state.iteration < LAYOUT_ITERATIONS) {
      for (let i = 0; i < STEPS_PER_FRAME && state.iteration < LAYOUT_ITERATIONS; i++) step(g, alphaAt(state.iteration++), settings.forces)
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
  // A node dragged becomes pinned; double-tap or long-press a pinned node unpins it.
  let drag: GraphNode | null = null
  let dragPinned = false
  let press = 0
  let opening = 0
  let lastTap = { id: '', at: 0 }
  const unpin = (v: GraphNode): void => { v.pinned = false; savePins(g); state.iteration = Math.min(state.iteration, LAYOUT_ITERATIONS - 60); dirty = true }
  const endDrag = (): void => { clearTimeout(press); drag = null }
  canvas.addEventListener('pointerdown', (e) => {
    touched = true
    canvas.setPointerCapture(e.pointerId)
    const p = local(e)
    down.set(e.pointerId, p)
    travelled = 0
    if (down.size > 1) { if (drag) drag.pinned = dragPinned; endDrag(); return }
    const v = hit(p.x, p.y)
    if (!v || v.tier === undefined) return
    drag = v; dragPinned = v.pinned
    if (v.pinned) press = window.setTimeout(() => { if (drag === v && travelled <= TAP_SLOP) { endDrag(); unpin(v); travelled = Infinity } }, LONG_PRESS_MS)
  })
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e)
    const prev = down.get(e.pointerId)
    if (!prev) {
      const near = hit(p.x, p.y)
      if (near !== hover) { hover = near; dirty = true }
      return
    }
    const c = cam()
    travelled += Math.hypot(p.x - prev.x, p.y - prev.y)
    down.set(e.pointerId, p)
    if (drag) {
      if (travelled <= TAP_SLOP) return
      clearTimeout(press)
      drag.x = (p.x - c.x) / c.k; drag.y = (p.y - c.y) / c.k; drag.pinned = true
      state.iteration = Math.min(state.iteration, LAYOUT_ITERATIONS - 30); dirty = true
      return
    }
    if (down.size === 2) {
      const other = [...down.entries()].find(([id]) => id !== e.pointerId)?.[1] ?? prev
      const before = Math.hypot(prev.x - other.x, prev.y - other.y) || 1
      const after = Math.hypot(p.x - other.x, p.y - other.y) || 1
      zoomAt((p.x + other.x) / 2, (p.y + other.y) / 2, after / before)
    } else {
      c.x += p.x - prev.x; c.y += p.y - prev.y; dirty = true
    }
  })
  const release = (e: PointerEvent, tap: boolean): void => {
    const was = down.size
    down.delete(e.pointerId)
    const dragged = drag
    endDrag()
    if (dragged && travelled > TAP_SLOP && tap) { savePins(g); return }
    if (dragged) dragged.pinned = dragPinned
    if (!tap || was !== 1 || travelled > TAP_SLOP) return
    const v = hit(local(e).x, local(e).y)
    if (!v) { const ed = hitEdge(local(e).x, local(e).y); if (ed) showTip(ed); return }
    if (v.pinned && v.tier !== undefined) {
      if (lastTap.id === v.id && e.timeStamp - lastTap.at < DOUBLE_TAP_MS) { clearTimeout(opening); lastTap = { id: '', at: 0 }; unpin(v); return }
      lastTap = { id: v.id, at: e.timeStamp }
      opening = window.setTimeout(() => o.openPerson(v.id), DOUBLE_TAP_MS)
      return
    }
    if (v.tier === undefined) o.openMe(); else o.openPerson(v.id)
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
