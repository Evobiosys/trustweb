/**
 * The Network view of the Web tab (wave 7): the force graph from network_graph.ts on a plain 2D canvas. Pan and zoom with
 * pointer, wheel and pinch; labels only when zoomed in or hovered (Logseq's behaviour); the search box highlights;
 * a tap on a person opens their card. Everything local (I1): the record never leaves this phone.
 */
import { el } from '../../demo/src/ui/dom'
import type { Person } from './model'
import { Ring } from './model'
import type { AppState } from './model'
import { filterSection } from './trustzones_view'
import { ringShown } from './rings_filter'
import { communityOf, zoneFor } from './trustzones'
import { ringColor } from './ring_palette'
import { needleAt, needleHead, settleTarget, startUnpin, unpinAt } from './network_pin'
import type { UnpinTween } from './network_pin'
import type { ColourTag } from './colour_tags'
import { DEFAULT_FORCES, LAYOUT_ITERATIONS, alphaAt, dotRadiusAt, labelPx, applyPins, buildGraph, isArchived, labelAt, mutualIds, pinsOf, matchIds, shake, step, tierOf, FAMILY_COLOUR } from './network_graph'
import type { Forces, Graph, GraphEdge, GraphNode, LabelBox, Pins } from './network_graph'
import { fitBounds, refitCamera } from './network_fit'
import type { Camera, Size } from './network_fit'
import { LONG_PRESS_MS, PRESS_SLOP, canvasScale, isLongPress, menuActions, placeMenu } from './network_menu'
import type { MenuAction } from './network_menu'
import { S } from './strings'
import { shortLabel } from './short_label'
import { skinOf } from './skins'
import { dotLook } from './network_dots'

export interface NetworkOptions {
  me: { id: string; displayName: string }
  people: readonly Person[]
  openPerson: (id: string) => void
  openMe: () => void
  /** Wave 28b: the Filter (advanced) block (acquaintances, not yet sorted, community tag) lives here; absent = no block, no filtering. */
  ui?: { s: AppState; tags: readonly ColourTag[]; save: () => void }
}

const SETTINGS_KEY = 'trustweb.ui.netSettings'
const PINS_KEY = 'trustweb.ui.netPins'
const DOUBLE_TAP_MS = 320
const LOGSEQ = { bg: '#00323a', edge: '#b8d2d6', node: '#8c9ea2', lit: '#eef6f7', label: '#c5d6d9' }
const STEPS_PER_FRAME = 20
const TAP_SLOP = PRESS_SLOP

/** Per device: the Logseq look, the forces, whether people outside my web (tier "outside") are drawn, and whether people connected only to me are. */
interface Settings { logseq: boolean; showAll: boolean; showOthers: boolean; forces: Forces }
function loadSettings(): Settings {
  try {
    const v = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>
    return { logseq: v.logseq === true, showAll: v.showAll === true, showOthers: v.showOthers === true, forces: { ...DEFAULT_FORCES, ...v.forces } }
  } catch { return { logseq: false, showAll: false, showOthers: false, forces: { ...DEFAULT_FORCES } } }
}
function saveSettings(v: Settings): void {
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(v)) } catch { /* not remembered */ }
}

/** Pins per device, by person id: they survive reloads and "Shake". */
function loadPins(): Pins {
  try { return JSON.parse(window.localStorage.getItem(PINS_KEY) ?? '{}') as Pins } catch { return {} }
}
function savePins(g: Graph): void {
  const pins = pinsOf(g)
  for (const id of unpinning.keys()) delete pins[id] // a dot gliding home is already unpinned for the next load
  try { window.localStorage.setItem(PINS_KEY, JSON.stringify(pins)) } catch { /* not remembered */ }
}

/** Dots gliding back to their natural place after the needle was pressed (wave 28b), by person id; any view of the same graph advances them. */
const unpinning = new Map<string, { node: GraphNode; tween: UnpinTween }>()

function download(name: string, blob: Blob): void {
  const a = el('a', { href: URL.createObjectURL(blob), download: name }) as HTMLAnchorElement
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

interface Cached { key: string; graph: Graph; iteration: number; camera: Camera | null; touched: boolean; size: Size | null }
// People hidden from the graph this session only (never stored).
const hiddenIds = new Set<string>()
// One graph and camera per record, so a redraw of the screen keeps the picture where it settled.
let cached: Cached | null = null

function keyOf(o: NetworkOptions): string {
  return o.me.id + '|' + o.people.map((p) => p.id + p.ring + tierOf(p) + p.context + p.name + (p.knows ?? []).join(',')).join('|')
}

export function createNetworkView(o: NetworkOptions): HTMLElement {
  const settings = loadSettings()
  const community = o.ui ? communityOf(o.ui.s) : null
  const shownIn = (p: Person): boolean => {
    const t = tierOf(p)
    return !o.ui || t === 'outside' || ringShown(o.ui.s, t)
  }
  // The community tag lifts acquainted holders into the friends tier (as on the TrustZones web, display only).
  const lifted = (p: Person): Person => (community && tierOf(p) === Ring.Acquaintance && zoneFor(p, community) === Ring.Friend ? { ...p, ring: Ring.Friend } : p)
  const inWeb = (settings.showAll ? o.people : o.people.filter((p) => tierOf(p) !== 'outside')).filter((p) => !hiddenIds.has(p.id) && !isArchived(p) && shownIn(p)).map(lifted)
  // Default: only people who are connected with other contacts too; the rest (only connected with me) sit behind "Show only connected with me".
  const mutual = mutualIds(o.me, inWeb)
  const people = settings.showOthers ? inWeb : inWeb.filter((p) => mutual.has(p.id))
  const rings = skinOf(o.ui?.s ?? {}).id === 'trustweb' // Wave 32: the rings-like dots; the classic look stays a skin
  const key = keyOf({ ...o, people }) + (rings ? '+rings' : '') + (settings.showAll ? '+all' : '') + (settings.showOthers ? '+others' : '')
  if (!cached || cached.key !== key) {
    cached = { key, graph: buildGraph(o.me, people), iteration: 0, camera: null, touched: false, size: null }
    if (rings) for (const v of cached.graph.nodes) v.r = dotLook(v.name, v.tier).radius // the bigger dots keep their room in the layout
  }
  if (cached.iteration === 0 && cached.camera === null) applyPins(cached.graph, loadPins())
  const state = cached
  const g = state.graph
  const near = g.nodes.map(() => new Set<number>())
  for (const e of g.edges) { near[e.a].add(e.b); near[e.b].add(e.a) }
  let matches = new Set<string>()
  let hover: GraphNode | null = null
  let dirty = true
  let shown: LabelBox[] = [] // the labels of the last frame, for taps on a name
  let needles: { id: string; x: number; y: number; r: number; lit: boolean }[] = [] // the needles of the last frame, for taps on a red head
  let w = 0
  let h = 0

  const canvas = el('canvas', { class: 'net-canvas', role: 'img', 'aria-label': S.netAria(people.length) }) as HTMLCanvasElement
  const ctx = canvas.getContext('2d')
  const search = el('input', { class: 'field net-search', type: 'search', placeholder: S.netSearchPh, 'aria-label': S.netSearchPh, autocomplete: 'off' }) as HTMLInputElement
  const shakeBtn = el('button', { class: 'btn btn-ghost btn-sm', 'data-net-shake': '', onclick: () => { shake(g, Date.now()); state.iteration = 0; dirty = true } }, [S.netShake])
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
    shakeBtn,
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
  const othersBtn = el('button', { class: 'btn btn-ghost btn-sm net-others', 'data-net-others': '', 'aria-pressed': String(settings.showOthers),
    onclick: () => { settings.showOthers = !settings.showOthers; rebuild() } }, [settings.showOthers ? S.netHideOthers : S.netShowOthers])
  const tip = el('div', { class: 'net-tip', 'data-net-tip': '', hidden: '' })
  const pop = el('div', { class: 'net-pop', 'data-net-pop': '', hidden: '' })
  let tipTimer = 0
  // Wave 28b: the legend is plain text at the bottom left of the canvas (placed in resize).
  const legend = el('small', { class: 'net-legend', 'data-net-legend': '' }, [S.netLegend])
  // Wave 28b: Filter (advanced) moved here from the TrustZones web: folded by default, same saved state.
  const filters = o.ui ? filterSection({ s: o.ui.s, tags: o.ui.tags, onChange: () => { o.ui?.save(); root.replaceWith(createNetworkView(o)) } }) : el('span', { hidden: '' })
  const root = el('div', { class: 'net', 'data-view': 'network', 'data-own-zoom': '' }, [el('div', { class: 'net-bar' }, [search, menuBtn]), menu, filters, canvas, tip, pop, othersBtn, legend])

  const fit = (): Camera => fitBounds(g.nodes, w, h)
  const cam = (): Camera => (state.camera ??= { k: 0.8, x: w / 2, y: h / 2 })
  const hit = (px: number, py: number): GraphNode | null => {
    const c = cam()
    let best: GraphNode | null = null
    let bestD = Infinity
    for (const v of g.nodes) {
      const d = Math.hypot(v.x * c.k + c.x - px, v.y * c.k + c.y - py)
      if (d <= Math.max(dotRadiusAt(v.r, c.k), 10) + 4 && d < bestD) { best = v; bestD = d }
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
  const open = (v: GraphNode): void => { if (v.tier === undefined) o.openMe(); else o.openPerson(v.id) }
  const showTip = (e: GraphEdge): void => {
    const a = g.nodes[e.a].name; const b = g.nodes[e.b].name
    const card = (v: GraphNode): HTMLElement => el('button', { class: 'btn btn-ghost btn-sm', onclick: () => open(v) }, [S.netOpenCard(v.name)])
    tip.replaceChildren(e.knows === 'mutual' ? S.netKnowsBoth(a, b) : S.netKnows(a, b), card(g.nodes[e.a]), card(g.nodes[e.b]))
    tip.hidden = false
    clearTimeout(tipTimer)
    tipTimer = window.setTimeout(() => { tip.hidden = true }, 6000)
  }

  const colour = (v: GraphNode): string =>
    v.tier === undefined ? getComputedStyle(document.documentElement).getPropertyValue('--coral').trim() || '#FF715B' : ringColor(v.tier)

  const label = (v: GraphNode): string => (v.desire === undefined ? shortLabel(v.name) : `${shortLabel(v.name)} · ${S.netWants(v.desire)}`)

  const draw = (): void => {
    if (!ctx) return
    const c = cam()
    const dpr = canvasScale(window.devicePixelRatio || 1, w, h)
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
    ctx.font = lq ? '10px system-ui, sans-serif' : '600 11px system-ui, sans-serif'   // the names are drawn below with labelPx(…, k)
    ctx.textAlign = 'center'
    const fade = Math.min(1, c.k / settings.forces.labelZoom)
    canvas.dataset.k = String(c.k); canvas.dataset.labelPx = String(labelPx(lq ? 10 : 11, c.k))   // measurement hook (wave 42): name px at this zoom
    needles = []
    let refD = Infinity
    delete canvas.dataset.dotR
    const labels: { id: string; text: string; x: number; y: number; alpha: number; fill: string; pinned: boolean }[] = [] // drawn after every dot and edge, above the dot
    g.nodes.forEach((v, i) => {
      const lit = lq ? inFocus(i) : !filtering || matches.has(v.id) || v.tier === undefined
      const x = v.x * c.k + c.x
      const y = v.y * c.k + c.y
      if (x < -20 || y < -20 || x > w + 20 || y > h + 20) return
      const look = rings && !lq ? dotLook(v.name, v.tier) : null
      // Wave 42: dots grow linearly with the zoom (clamped, dotRadiusAt), like the Rings view; a search match is a little larger
      const match = matches.has(v.id)
      const rad = look ? dotRadiusAt(look.radius, c.k, match ? 1.2 : 1) : lq ? dotRadiusAt(1.5 + Math.sqrt(near[i].size) * 1.1, c.k, match ? 1.6 : 1) : dotRadiusAt(v.r, c.k, match ? 1.5 : 1)
      ctx.globalAlpha = lit ? (!lq && v.faint ? 0.4 : 1) : 0.15
      ctx.fillStyle = lq ? (v === hover || matches.has(v.id) ? LOGSEQ.lit : LOGSEQ.node) : colour(v)
      if (look?.you) { // the you dot: gradient face inside a white halo, as on the Web rings
        const grad = ctx.createLinearGradient(x - rad, y - rad, x + rad, y + rad)
        grad.addColorStop(0, '#FF715B'); grad.addColorStop(1, '#9A37F0')
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x, y, rad + 2, 0, Math.PI * 2); ctx.fill()
        ctx.fillStyle = grad
      }
      ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill()
      if (v.tier !== undefined && Math.hypot(x - w / 2, y - h / 2) < refD) { refD = Math.hypot(x - w / 2, y - h / 2); canvas.dataset.dotR = String(rad) }   // measurement hook (wave 42): radius of the person dot nearest the centre
      if (look && rad >= 7) {
        ctx.fillStyle = look.ink; ctx.font = `700 ${Math.round(rad * 0.84)}px system-ui, sans-serif`; ctx.textBaseline = 'middle'
        ctx.fillText(look.initial, x, y + 0.5); ctx.textBaseline = 'alphabetic'
      }
      if (v.family) {
        ctx.strokeStyle = FAMILY_COLOUR; ctx.lineWidth = 2.5; ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(x, y, rad + 3, 0, Math.PI * 2); ctx.stroke()
        ctx.lineWidth = lq ? 0.6 : 1
      }
      if (v.pinned && v.tier !== undefined && !unpinning.has(v.id)) needles.push({ id: v.id, x, y, r: rad, lit })
      if (lq) {
        const a = lit ? fade : fade * 0.15
        if (a < 0.5 * (lit ? 1 : 0.15) && v !== hover && !matches.has(v.id)) return
        labels.push({ id: v.id, text: label(v), x, y: y - rad - 4, alpha: v === hover || matches.has(v.id) ? 1 : a, fill: v === hover ? LOGSEQ.lit : LOGSEQ.label, pinned: v.pinned && v.tier !== undefined })
      } else if (v === hover || matches.has(v.id) || v.tier === undefined || (c.k >= settings.forces.labelZoom && lit)) {
        labels.push({ id: v.id, text: label(v), x, y: y - rad - 4, alpha: 1, fill: ink, pinned: v.pinned && v.tier !== undefined })
      }
    })
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5
    ctx.strokeStyle = lq ? LOGSEQ.bg : css.getPropertyValue('--linen').trim() || '#FFFFFF' // halo: readable over edges
    // Names in the body font, pinned people's in the second family (--font-pinned); the boxes make a name tappable.
    const bodyFont = getComputedStyle(document.body).fontFamily || 'system-ui, sans-serif'
    const pinnedFont = css.getPropertyValue('--font-pinned').trim() || 'ui-monospace, Menlo, monospace'
    shown = []
    for (const l of labels) {
      ctx.font = `${l.pinned ? '500' : lq ? '400' : '600'} ${labelPx(lq ? 10 : 11, c.k)}px ${l.pinned ? pinnedFont : bodyFont}`
      ctx.globalAlpha = l.alpha; ctx.strokeText(l.text, l.x, l.y); ctx.fillStyle = l.fill; ctx.fillText(l.text, l.x, l.y)
      shown.push({ id: l.id, x: l.x, y: l.y, w: ctx.measureText(l.text).width })
    }
    // Wave 28b: a pinned dot's needle (thin line, red head), over the names so the head always shows; a press on the head unpins.
    for (const n of needles) {
      const head = needleHead(n.x, n.y, n.r)
      ctx.globalAlpha = n.lit ? 1 : 0.3
      ctx.strokeStyle = lq ? LOGSEQ.lit : ink; ctx.lineWidth = 1.4
      ctx.beginPath(); ctx.moveTo(n.x + n.r * 0.7, n.y - n.r * 0.7); ctx.lineTo(head.x, head.y); ctx.stroke()
      ctx.fillStyle = '#D93025'
      ctx.beginPath(); ctx.arc(head.x, head.y, 3.6, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  const frame = (): void => {
    if (!canvas.isConnected) { sizes.disconnect(); return } // the screen was redrawn: this view is gone
    const now = Date.now()
    for (const [id, u] of unpinning) {
      if (!g.nodes.includes(u.node)) { unpinning.delete(id); continue }
      const m = unpinAt(u.tween, now)
      u.node.x = m.x; u.node.y = m.y; dirty = true
      if (m.done) { u.node.pinned = false; unpinning.delete(id); state.iteration = Math.min(state.iteration, LAYOUT_ITERATIONS - 30) }
    }
    if (state.iteration < LAYOUT_ITERATIONS) {
      for (let i = 0; i < STEPS_PER_FRAME && state.iteration < LAYOUT_ITERATIONS; i++) step(g, alphaAt(state.iteration++), settings.forces)
      if (state.iteration >= LAYOUT_ITERATIONS && !state.touched) { state.camera = fit(); state.size = { w, h } }
      dirty = true
    }
    if (dirty) { dirty = false; draw(); placePop() }
    requestAnimationFrame(frame)
  }

  const resize = (): void => {
    const box = root.getBoundingClientRect()
    if (!box.width) return
    const nw = Math.floor(box.width) - 24
    const nh = Math.max(360, Math.floor(window.innerHeight * 0.62))
    if (nw === w && nh === h) return
    w = nw; h = nh
    const dpr = canvasScale(window.devicePixelRatio || 1, w, h)
    canvas.width = w * dpr; canvas.height = h * dpr
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px'
    legend.style.left = canvas.offsetLeft + 10 + 'px'; legend.style.top = canvas.offsetTop + h - 24 + 'px'
    // The cached camera was fitted to the size of an earlier box (another layout, window or orientation): fit it to this one.
    if (state.iteration >= LAYOUT_ITERATIONS) state.camera = refitCamera(state.camera, state.touched, g.nodes, state.size, { w, h })
    state.size = { w, h }
    dirty = true
  }

  // Pointers: one = pan (or tap), two = pinch.
  const down = new Map<number, { x: number; y: number }>()
  let travelled = 0
  const local = (e: MouseEvent): { x: number; y: number } => { const b = canvas.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top } }
  const zoomAt = (px: number, py: number, factor: number): void => {
    state.touched = true
    const c = cam()
    const k = Math.min(8, Math.max(0.2, c.k * factor))
    c.x = px - (px - c.x) * (k / c.k); c.y = py - (py - c.y) * (k / c.k); c.k = k
    dirty = true
  }
  // A node dragged becomes pinned; double-tap a pinned node unpins it; right-click or long-press opens the person menu.
  let drag: GraphNode | null = null
  let dragPinned = false
  let press = 0
  let opening = 0
  let lastTap = { id: '', at: 0 }
  // Wave 28b: unpinning glides the dot to where the layout would put it (~1.5 s, ease-out) instead of jumping.
  const unpin = (v: GraphNode): void => {
    if (unpinning.has(v.id)) return
    unpinning.set(v.id, { node: v, tween: startUnpin(v, settleTarget(g, g.nodes.indexOf(v)), Date.now()) })
    savePins(g); dirty = true
  }
  const endDrag = (): void => { clearTimeout(press); drag = null }
  // Wave 42: the person menu keeps its place beside the dot while the canvas zooms or pans (popAnchor = the press point relative to the dot, canvas px).
  let popAnchor: { node: GraphNode; dx: number; dy: number } | null = null
  const placePop = (): void => {
    if (!popAnchor || pop.hidden) return
    const c = cam(), { node, dx, dy } = popAnchor
    const at = placeMenu(canvas.offsetLeft + node.x * c.k + c.x + dx, canvas.offsetTop + node.y * c.k + c.y + dy, pop.offsetWidth, pop.offsetHeight, root.clientWidth, root.clientHeight)
    pop.style.left = at.x + 'px'; pop.style.top = at.y + 'px'
  }
  const closePop = (): void => { pop.hidden = true; popAnchor = null }
  const act = (v: GraphNode, a: MenuAction): void => {
    closePop()
    if (a === 'pin') { v.pinned = true; savePins(g); reheat() } else if (a === 'unpin') unpin(v)
    else if (a === 'inspect') open(v)
    else { hiddenIds.add(v.id); root.replaceWith(createNetworkView(o)) }
  }
  const openPop = (v: GraphNode, p: { x: number; y: number }): void => {
    endDrag(); travelled = Infinity
    const labels: Record<MenuAction, string> = { pin: S.netPin, unpin: S.netUnpin, inspect: S.netInspect, hide: S.netHide }
    pop.replaceChildren(...menuActions(v.pinned).map((a) => el('button', { class: 'btn btn-ghost btn-sm', onclick: () => act(v, a) }, [labels[a]])))
    pop.hidden = false
    const c = cam()
    popAnchor = { node: v, dx: p.x - (v.x * c.k + c.x), dy: p.y - (v.y * c.k + c.y) }
    placePop()
  }
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    const p = local(e)
    const v = hit(p.x, p.y)
    if (v && v.tier !== undefined) openPop(v, p)
  })
  canvas.addEventListener('pointerdown', (e) => {
    closePop()
    if (e.button > 0) return
    state.touched = true
    canvas.setPointerCapture(e.pointerId)
    const p = local(e)
    down.set(e.pointerId, p)
    travelled = 0
    if (down.size > 1) { if (drag) drag.pinned = dragPinned; endDrag(); return }
    const v = hit(p.x, p.y)
    if (!v || v.tier === undefined) return
    drag = v; dragPinned = v.pinned
    press = window.setTimeout(() => { if (drag === v && isLongPress(LONG_PRESS_MS, travelled)) openPop(v, p) }, LONG_PRESS_MS)
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
    const needle = needleAt(needles, local(e).x, local(e).y)
    const pinnedNode = needle ? g.nodes.find((n) => n.id === needle) : undefined
    if (pinnedNode) { clearTimeout(opening); unpin(pinnedNode); return }
    const lid = labelAt(shown, local(e).x, local(e).y)
    const v = hit(local(e).x, local(e).y) ?? g.nodes.find((n) => n.id === lid) ?? null
    if (!v) { const ed = hitEdge(local(e).x, local(e).y); if (ed) showTip(ed); return }
    if (v.pinned && v.tier !== undefined) {
      if (lastTap.id === v.id && e.timeStamp - lastTap.at < DOUBLE_TAP_MS) { clearTimeout(opening); lastTap = { id: '', at: 0 }; unpin(v); return }
      lastTap = { id: v.id, at: e.timeStamp }
      opening = window.setTimeout(() => open(v), DOUBLE_TAP_MS)
      return
    }
    open(v)
  }
  canvas.addEventListener('pointerup', (e) => release(e, true))
  canvas.addEventListener('pointercancel', (e) => release(e, false))
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; dirty = true } })
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); closePop(); const p = local(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)) }, { passive: false })
  search.addEventListener('input', () => { matches = matchIds(g, search.value); dirty = true })

  // Root = width; the page = window height (the canvas height follows it); the canvas = whatever else resizes it.
  const sizes = new ResizeObserver(resize)
  sizes.observe(root); sizes.observe(canvas); sizes.observe(document.documentElement)
  // The box settles late (bottom bar, header, orientation, browser chrome): measure again on the next two frames and on viewport changes.
  const settle = (): void => { if (canvas.isConnected) resize(); else window.visualViewport?.removeEventListener('resize', settle) }
  window.visualViewport?.addEventListener('resize', settle)
  requestAnimationFrame(() => { resize(); requestAnimationFrame(resize) })
  requestAnimationFrame(frame)
  return root
}
