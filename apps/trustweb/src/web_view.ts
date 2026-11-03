// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The Web view of the Membranes tab: the rings drawing, a person dragged between rings, the right-click / long-press menu
 * that spaces the dots out, zoom and pan over the Web screen, and the tap that adds someone. Moved out of main.ts so ring
 * work no longer shares merge hunks with the rest of the app; the page around it (webPage, the small card, the ask marks)
 * stays in main.ts. The pure helpers at the top carry the maths and the drop decision, so they are tested in node; the
 * DOM part is createWebView, which gets every main.ts closure it needs through WebViewDeps. Everything local (I1).
 */
import { el } from '../../demo/src/ui/dom'
import { arcsGradient, loadColourTags, tagColours } from './colour_tags'
import { isBlocked, isNonResponsive } from './non_responsive'
import { DESIRE_DEFAULT, RINGS_LABEL_CAP, angleFromCentre, angleOf, beyondRings, lapRadius, placeOnRing, restoreAngles, ringAt, ringsGeometry, spaceOut, webSlot, WEB_RINGS } from './rings_layout'
import type { RingsGeometry } from './rings_layout'
import { RINGS_HIDDEN_KEY, guideDimmed, parseHidden, serializeHidden, toggleHidden, togglePoints, visiblePeople } from './rings_hide'
import { displayName } from '../../../packages/person-fields/src/display_name'
import { isConnected } from './card_view'
import { HintId, isDemoPerson, Ring, RINGS, REACH_OUT_INK, ringColor } from './model'
import type { AppState, Person } from './model'
import { S } from './strings'
import type { Curator, LentRings } from './curator'
import { intendingReminder, knownWays, lastMessagedAt } from './intending_reminder'
import { shortLabel } from './short_label'
import { limitOf, pickFive, withTag } from './membranes_five'
import { communityOf, filledRings, isArchived, inZones, toggleRing, toneVar, zoneFor } from './trustzones'
import { filterByChips } from './tag_filter'
import { dueMoves, releaseTies } from './engagement'
import { membraneAll } from './membranes_five_view'
import { onHoverOrLongPress, singleOrDouble } from './press'
import { contextPress } from './context_press'
import { labelScale } from './ring_spacing'
import { RINGS_ZOOM_HOME, type RingsZoom, type ZoomView, fitZoom, panBy, transformOf, zoomAt } from './rings_zoom'
import type { Layout } from './layout_pick'

/** The rings' own layout size (px): the viewBox, and the box a pointer is read against. */
export const RINGS_SIZE = 352

/** How close (view px) a press must be to a ring's line to count as on it. */
export const RING_LINE_HIT = 10

/** How long the ripple plays on its own before the add-someone sheet opens. */
export const RIPPLE_LEAD_MS = 360

export const HIDDEN_GUIDE_OPACITY = '.25'

const NS = 'http://www.w3.org/2000/svg'

/** A pointer position in the rings' own layout px, whatever the zoom layer and the query-dock scale do to the box. */
export function localPoint(e: { clientX: number; clientY: number }, box: { left: number; top: number; width: number }): { x: number; y: number } {
  const k = box.width / RINGS_SIZE
  return { x: (e.clientX - box.left) / k, y: (e.clientY - box.top) / k }
}

/** The ring whose line is closest to a tap `dist` view px from the centre (the add-someone sheet preselects it); acquaintance by default. */
export function nearestRing(dist: number, geo: Pick<RingsGeometry, 'radius'>, k: number): Ring {
  return RINGS.reduce((best, r) => (Math.abs(geo.radius[r] * k - dist) < Math.abs(geo.radius[best] * k - dist) ? r : best), Ring.Acquaintance)
}

/** The context menu's ring: the one nearest the press, and whether the press sits on its line (within RING_LINE_HIT view px). */
export function menuTarget(at: { x: number; y: number }, geo: Pick<RingsGeometry, 'radius' | 'rings'>, k: number): { near: Ring; onLine: boolean } {
  const { x, y } = at
  const dist = Math.hypot(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2)
  const near = ringAt(dist / k, geo.radius, geo.rings)
  const onLine = Math.abs(geo.radius[near] * k - dist) <= RING_LINE_HIT
  return { near, onLine }
}

/** Where the context menu opens: at the press, kept inside the rings (the menu is about 170 x 70 px). */
export function menuPlace(at: { x: number; y: number }): { left: number; top: number } {
  return { left: Math.min(at.x, RINGS_SIZE - 170), top: Math.min(at.y, RINGS_SIZE - 70) }
}

/** A pressed dot starts to drag once the pointer moved 4 px (mouse), or 8 px while a touch hold is pending (`held`). */
export function dragStarts(dx: number, dy: number, held: boolean): boolean {
  return !(Math.hypot(dx, dy) < (held ? 8 : 4))
}

export type DropOutcome = 'hide' | 'family-stays' | 'same-ring' | 'unplace' | 'ask-desire' | 'move'

/** What a drop on `ring` does (`out`: beyond the rings), in the order the drop handler checks it. */
export function dropOutcome(p: Pick<Person, 'ring' | 'fields' | 'ringSuggested'>, ring: Ring, out: boolean): DropOutcome {
  if (out) return 'hide'
  if (ring === Ring.Unsorted && p.ring === Ring.Family) return 'family-stays'
  if (ring === webSlot(p)) return 'same-ring'
  if (ring === Ring.Unsorted) return 'unplace'
  if (ring === Ring.Intending) return 'ask-desire'
  return 'move'
}

/** The main.ts closures the Web view needs; getters for the values that change (tagFilter, ownPictureUrl). */
export interface WebViewDeps {
  st(): AppState
  save(): void
  render(): void
  toast(msg: string): void
  showNotice(title: string, body: string, actions: HTMLElement[], autoHideMs?: number): void
  hideNotice(): void
  curator: Pick<Curator, 'hide' | 'unhide' | 'ring'>
  openWebPage(page: { kind: 'card'; id: string } | { kind: 'more'; ring: Ring }): void
  toggleCardExpanded(): void
  editNameSheet(fromWeb?: boolean): void
  addPersonSheet(ring: Ring): void
  openHint(id: HintId): void
  hintHidden(id: HintId): boolean
  touchUi(): boolean
  curatorPerson(personId: string): void
  dummyChip(): HTMLElement
  avatar(name: string, id: string, cls?: string): HTMLElement
  pictured(face: HTMLElement, url: string | undefined): HTMLElement
  ownPictureUrl(): string | undefined
  demoPhone(): boolean
  changeRing(p: Person, ring: Ring): void
  ripple(e: MouseEvent): void
  tagFilter(): string | null
  currentLayout(): Layout
  solo: boolean
}

export interface WebView {
  ringsView(s: AppState, marks?: Map<string, 'asked' | 'shared'>, desk?: LentRings, opts?: { complete?: boolean }): HTMLElement
  zoomOnWeb(clip: HTMLElement, layer: HTMLElement): void
  /** Leaving the Web screen: the next visit starts at home zoom. */
  resetZoom(): void
  hideOnRings(p: Person): Promise<void>
  /** A Web view ring change goes on to Tana through the Curator's sync. */
  ringToTana(p: Person, ring: Ring): void
  spaceOutWeb(ring?: Ring): void
}

export function createWebView(deps: WebViewDeps): WebView {
  const { st, save, render, toast, showNotice, hideNotice, curator, openWebPage, toggleCardExpanded, editNameSheet, addPersonSheet, openHint, hintHidden, touchUi, curatorPerson, dummyChip, avatar, pictured, demoPhone, changeRing, ripple, currentLayout, solo } = deps
  /** The drawn rings of the last render: their radii (in layout units) and the factor that fits a crowded web into the view; a drop or tap is read through both. */
  let ringsGeo: RingsGeometry = ringsGeometry({} as Record<Ring, number>)
  let ringsK = 1

  /** `desk`: the rings lent to the Desk's Web page (curator.ts LentRings): a tap picks the person there, no phone sheets, no add-someone tap or space-out menu. */
  function ringsView(s: AppState, marks: Map<string, 'asked' | 'shared'> = new Map(), desk?: LentRings, opts: { complete?: boolean } = {}): HTMLElement {
    const C = 176
    const counts = {} as Record<Ring, number>
    const everyone: Partial<Record<Ring, Person[]>> = {}
    // Wave 28: archived contacts never; the Desk's lent rings keep every filter off (they are where the unsorted get sorted), the phone's rings follow the saved filters.
    const community = communityOf(s)
    // Wave 28b: the sidebar's tag filters (show only / hide, hide wins) thin the dots of the phone's rings.
    for (const p of desk ? s.people.filter((x) => !isBlocked(x) && !isArchived(x)) : filterByChips(inZones(s.people, s), loadColourTags(), s.uiRings?.show ?? [], s.uiRings?.hide ?? [])) (everyone[zoneFor(p, community)] ??= []).push(p)
    // Wave 25: the closest five per membrane (membranes_five.ts); the complete view and the Desk's lent rings show everyone.
    const complete = opts.complete === true || desk !== undefined
    const members: Partial<Record<Ring, Person[]>> = {}
    const rest: Partial<Record<Ring, Person[]>> = {}
    const filled = filledRings(s)
    for (const [r, ps] of Object.entries(everyone) as [Ring, Person[]][]) {
      if (complete) { members[r] = ps; continue }
      // Wave 28: a filled ring (the + became a triangle) draws everyone; the others the closest five, the rest behind the list button.
      const f = pickFive(withTag(ps, deps.tagFilter()), s, filled.includes(r) ? Infinity : limitOf(s), Date.now())
      members[r] = f.shown; rest[r] = f.rest
    }
    // Wave 28: a dot keeps its angle (dropped, else fixed from its id): slotAngle (membranes_five.ts, kept) no longer moves dots between renders, a ring change only moves them radially.
    const angleOfP = (p: Person): number => angleOf(p)
    const quiet = new Map(desk ? [] : dueMoves(s, Date.now()).map((m) => [m.person.id, m.to] as const))
    for (const r of Object.keys(members) as Ring[]) counts[r] = members[r]!.length
    // The layout keeps every person's place; a hidden ring's people are only not drawn (and so not hit-testable).
    const hidden = loadHiddenRings()
    const angles = Object.fromEntries(Object.entries(members).map(([r, ps]) => [r, ps.map(angleOfP)]))
    // The close ring depends on the scale (the "you" avatar does not shrink), the scale on the extent: settle on the first scale whose layout still fits.
    let k = 1
    for (ringsGeo = ringsGeometry(counts, angles, k); C / ringsGeo.extent < k - 0.005; ringsGeo = ringsGeometry(counts, angles, k)) k = C / ringsGeo.extent
    ringsK = k
    const colourTags = loadColourTags()
    const wrap = el('div', { class: 'rings-wrap' + (s.people.length > RINGS_LABEL_CAP || desk?.compact ? ' compact' : ''), 'data-view': 'rings', ...(complete ? { 'data-complete': '' } : {}), title: desk ? '' : S.hintText[HintId.WebTap] })
    let dragged = false
    if (!desk) {
      wrap.addEventListener('click', (e) => { if (!dragged) onRingsTap(e as MouseEvent, wrap) })
      ringsMenuOn(wrap, (v) => { dragged = v })
    }
    if (!desk && touchUi() && !hintHidden(HintId.WebTap)) {
      wrap.appendChild(el('button', {
        class: 'hint-i rings-hint', 'aria-label': S.hintOpen(S.hintLabel[HintId.WebTap]),
        onclick: (e: Event) => { e.stopPropagation(); openHint(HintId.WebTap) },
      }, ['i']))
    }
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 352 352')
    svg.innerHTML = '<defs><linearGradient id="th" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4FD7A0"/><stop offset="1" stop-color="#12A8E3"/></linearGradient></defs>'
    for (const r of ringsGeo.rings) {
      const c = document.createElementNS(NS, 'circle')
      c.setAttribute('cx', String(C)); c.setAttribute('cy', String(C)); c.setAttribute('r', String(ringsGeo.radius[r] * k)); c.setAttribute('data-ring', r)
      c.setAttribute('fill', 'none'); c.setAttribute('stroke', ringColor({ ring: r })); c.setAttribute('stroke-opacity', r === Ring.Unsorted ? '.35' : '.55')
      c.setAttribute('stroke-width', r === Ring.Close ? '2.2' : r === Ring.Intending ? '1' : '1.4')
      if (guideDimmed(hidden.has(r), false)) c.style.opacity = HIDDEN_GUIDE_OPACITY
      c.setAttribute('stroke-dasharray', r === Ring.Intending ? '1 6' : r === Ring.Acquaintance ? '2 5' : r === Ring.Friend ? '6 4' : '')
      svg.appendChild(c)
    }
    if (ringsGeo.rings.includes(Ring.Unsorted)) {
      const t = document.createElementNS(NS, 'text')
      t.setAttribute('x', String(C + 12)); t.setAttribute('y', String(C - ringsGeo.radius[Ring.Unsorted] * k + 3)); t.setAttribute('text-anchor', 'start')
      t.setAttribute('font-size', '8'); t.setAttribute('fill', ringColor({ ring: Ring.Unsorted })); t.setAttribute('data-ring-label', Ring.Unsorted); t.setAttribute('aria-label', S.ringLabel[Ring.Unsorted])
      svg.appendChild(t)
    }
    wrap.appendChild(svg)
    for (const ring of ringsGeo.rings) {
      const dot = ringsGeo.dot[ring]
      const laps = new Map((members[ring] ?? []).map((p, i) => [p, ringsGeo.lapOf[ring]![i]]))
      visiblePeople(members[ring] ?? [], hidden).forEach((p) => {
        const lap = laps.get(p)!
        const a = ((angleOfP(p) - 90) * Math.PI) / 180
        const radius = lapRadius(ringsGeo, ring, lap) * k
        const x = C + radius * Math.cos(a)
        const y = C + radius * Math.sin(a)
        // A crowded web (compact) draws a spoke only for people connected here: hundreds of dashed spokes read as dozens of rings.
        if (p.peerId || s.people.length <= RINGS_LABEL_CAP) {
          const path = document.createElementNS(NS, 'path')
          const mx = (C + x) / 2 + (y - C) * 0.12
          const my = (C + y) / 2 + (C - x) * 0.12
          path.setAttribute('d', `M${C} ${C} Q${mx} ${my} ${x} ${y}`)
          path.setAttribute('fill', 'none'); path.setAttribute('stroke', 'url(#th)')
          path.setAttribute('stroke-width', ring === Ring.Close ? '2.6' : ring === Ring.Friend ? '1.8' : ring === Ring.Acquaintance ? '1.2' : '0.8')
          path.setAttribute('opacity', p.peerId ? '0.85' : '0.35')
          if (!p.peerId) path.setAttribute('stroke-dasharray', '3 4')
          svg.appendChild(path)
        }
        const mark = (p.peerId ? marks.get(p.peerId) : undefined) ?? (p.doorPeerId ? marks.get(p.doorPeerId) : undefined)
        const arcs = arcsGradient(tagColours(p, colourTags))
        const face = avatar(p.name, p.id)
        face.style.background = p.reachedOut && ring === Ring.Intending ? ringColor(p) : toneVar(ring)
        if (p.reachedOut && ring === Ring.Intending) face.style.color = REACH_OUT_INK
        if (!isConnected(p)) { // outline only until connected on TrustWeb: dashed stroke in the fill colour, ink text
          face.classList.add('unconnected'); face.style.borderColor = face.style.background; face.style.background = ''; face.style.color = ''
        }
        pictured(face, p.theirProfile?.picture)
        const press = singleOrDouble(() => openWebPage({ kind: 'card', id: p.id }), () => { openWebPage({ kind: 'card', id: p.id }); toggleCardExpanded() })
        const b = el('button', {
          class: 'node' + (mark ? ' ' + mark : '') + (arcs ? ' tagged' : '') + (isNonResponsive(p) ? ' nonresp' : '') + (p.pinned === true ? ' pinned' : ''), 'data-pid': p.id, 'data-tone': String(WEB_RINGS.indexOf(ring)),
          onclick: () => { if (!dragged) (desk ? desk.onPick(p.id) : press()) },
        }, [
          face,
          el('span', { title: displayName(p.name).title || p.name, 'aria-label': displayName(p.name).text }, [shortLabel(displayName(p.name).text)]),
          isDemoPerson(s, p.id) ? dummyChip() : null,
          st().showRingNames ? el('em', { class: 'lvl' }, [S.ringLabel[p.ring]]) : null,
        ])
        if (!desk) contextPress(b, () => curatorPerson(p.id))
        b.style.left = x + 'px'
        b.style.top = y + 'px'
        if (arcs) b.style.setProperty('--arcs', arcs)
        b.style.setProperty('--d', dot * k + 'px')
        if (dot * k < 11) b.classList.add('nl')
        wrap.appendChild(b)
        const to = quiet.get(p.id)
        if (to) { // Wave 28: a note, never a move: tap accepts this one move
          const z = el('button', { class: 'zzz', 'data-zzz': p.id, 'aria-label': S.zoneZzzAria(p.name, S.ringLabel[to]), title: S.zoneZzzTitle(S.ringLabel[to]),
            onpointerdown: (e: Event) => { e.stopPropagation() }, onclick: (e: Event) => { e.stopPropagation(); zzzAccept([p.id]) } }, ['zzz'])
          z.style.left = x + (dot * k) / 2 + 'px'; z.style.top = y - (dot * k) / 2 + 'px'
          wrap.appendChild(z)
        }
      })
    }
    const you = el('button', { class: 'node you', 'aria-label': S.meNameAria(s.me.displayName), tabindex: desk ? '-1' : false, onclick: () => { if (!desk) editNameSheet(true) } }, [pictured(avatar(s.me.displayName, s.me.id), deps.ownPictureUrl()), el('span', {}, [shortLabel(s.me.displayName)])])
    you.style.left = C + 'px'
    you.style.top = C + 'px'
    wrap.appendChild(you)
    dragOnRings(wrap, s, (v) => { dragged = v }, desk?.onRing)
    // Re-render IN PLACE: the Desk slots this very element (slot name, styles, its fit() transform) and the phone's zoom layer wraps it,
    // so a replaceWith() made the rings vanish from the Desk (Jakob 20:05). `live` = the element the pressed button sits in.
    const toggle = (next: ReadonlySet<Ring>, live: HTMLElement): void => {
      try { window.localStorage.setItem(RINGS_HIDDEN_KEY, serializeHidden(next)) } catch { /* not remembered */ }
      const fresh = ringsView(s, marks, desk, opts)
      live.className = fresh.className
      live.replaceChildren(...fresh.childNodes)
    }
    // Hover (desktop) == long press (phone) on a membrane's diamond: everyone in that circle, small names; gone on leave or the next press.
    const hideAll = (): void => { wrap.querySelector('[data-membrane-all]')?.remove() }
    const showAll = (r: Ring, top: number): void => {
      hideAll()
      const box = membraneAll(S.ringLabel[r], everyone[r] ?? [])
      box.style.top = top + 14 + 'px'
      wrap.appendChild(box)
    }
    const column = togglePoints(ringsGeo.rings.map((r) => ringsGeo.radius[r]), C, k)
    ringsGeo.rings.forEach((r, i) => {
      const at = column[i]
      const diamond = ringToggle(r, hidden.has(r), at.top, at.left, (btn) => toggle(toggleHidden(hidden, r), btn.parentElement ?? wrap))
      wrap.appendChild(diamond)
      if (!desk) onHoverOrLongPress(diamond, () => showAll(r, at.top), hideAll)
      if (!hidden.has(r) && !complete && (rest[r]?.length || filled.includes(r)) && (everyone[r]?.length ?? 0) > limitOf(s)) ringMore(r, filled.includes(r), at.top, at.left, (btn) => { toggleRing(st(), 'filled', r); s.uiRings = st().uiRings; save(); toggle(hidden, btn.parentElement ?? wrap) }).forEach((n) => wrap.appendChild(n))
    })
    wrap.addEventListener('pointerdown', hideAll)
    // Wave 28b: the floating "+" moved into the TrustZones sidebar (zoneColumn), next to expand all.
    return wrap
  }

  /** Wave 28 (was the "+" that opened the list): beside a membrane's diamond an outliner triangle. The first press fills the ring with everyone in it (a list button appears to its right, the triangle stays in place), the second folds it back to the closest few. */
  function ringMore(ring: Ring, filled: boolean, top: number, left: number, onFill: (btn: HTMLElement) => void): HTMLElement[] {
    // Wave 28b (Jakob): the fill control is the expand glyph, not the outliner triangle (that looks like "play").
    const fill = el('button', { type: 'button', class: 'ring-more fill-expand' + (filled ? ' on' : ''), 'data-membrane-more': ring, 'aria-pressed': String(filled), 'aria-label': filled ? S.zoneFillAria(S.ringLabel[ring], filled) : S.zoneExpandTitle, title: filled ? S.zoneFillAria(S.ringLabel[ring], filled) : S.zoneExpandTitle,
      style: `--rc:${toneVar(ring)}; left:${left + 16}px; top:${top}px`, onpointerdown: (e: Event) => { e.stopPropagation() }, onclick: (e: Event) => { e.stopPropagation(); onFill(fill) } }, ['⛶'])
    const list = el('button', {
      class: 'ring-more ring-list', 'data-membrane-list': ring, style: `--rc:${toneVar(ring)}; left:${left + 34}px; top:${top}px`,
      'aria-label': S.zoneListAria(S.ringLabel[ring]), title: S.zoneListAria(S.ringLabel[ring]),
      onpointerdown: (e: Event) => { e.stopPropagation() },
      onclick: (e: Event) => { e.stopPropagation(); openWebPage({ kind: 'more', ring }) },
    }, ['☰'])
    return filled ? [fill, list] : [fill]
  }

  /** Wave 28: the zzz tap(s): these people move one ring outward (their suggestion), nobody else. */
  function zzzAccept(ids: readonly string[]): void {
    if (releaseTies(st(), Date.now(), new Set(ids)).length) { save(); render() }
  }

  function loadHiddenRings(): ReadonlySet<Ring> {
    try { return parseHidden(window.localStorage.getItem(RINGS_HIDDEN_KEY)) } catch { return new Set() }
  }

  /** The small round button on a ring's guide circle at 12 o'clock: ⊖ while the ring's people show, ⊕ while they are hidden. */
  function ringToggle(ring: Ring, off: boolean, top: number, left: number, onToggle: (btn: HTMLElement) => void): HTMLElement {
    const b = el('button', {
      class: 'ring-toggle' + (off ? ' off' : ''), 'data-hide-ring': ring, 'aria-pressed': String(off), style: `--rc:${ringColor({ ring })}; left:${left}px; top:${top}px`,
      'aria-label': (off ? S.ringShowAria : S.ringHideAria)(S.ringLabel[ring]), title: S.ringLabel[ring],
      // The zoom/pan layer captures every pointer on the rings (setPointerCapture), which retargets the click away from this button.
      onpointerdown: (e: Event) => { e.stopPropagation() },
      onclick: (e: Event) => { e.stopPropagation(); onToggle(e.currentTarget as HTMLElement) },
    }, [off ? '+' : '−'])
    return b
  }

  /** Zoom and pan of the Web screen's content; survives render() and resets when the Web screen is left. View state only (I1). */
  let ringsZoom: RingsZoom = RINGS_ZOOM_HOME

  /**
   * Pinch (trackpad ctrl + wheel, Safari gestures, two fingers), pan (one pointer past 6 px at k > 1) and double tap home over the whole
   * Web screen body, and only there: outside the phone, the header and the tab bar the browser zooms as ever. Only the inner layer moves.
   */
  function zoomOnWeb(clip: HTMLElement, layer: HTMLElement): void {
    // Wave 27: the rings' fit zoom (ringsZoom, kept for the way back) must not scale a Network layer: it blew the canvas up and pushed it off-centre.
    if (layer.querySelector('[data-own-zoom]')) return
    // [data-own-zoom] (the Network view) pans and zooms itself in its draw loop, so it stays crisp: this layer leaves it alone.
    const skip = '.node, .ctx-menu, .desire, .hint-i, button, a, input, textarea, [data-own-zoom]'
    const apply = (z: RingsZoom): void => {
      ringsZoom = z
      layer.style.transform = transformOf(z)
      layer.style.setProperty('--rz', String(labelScale(z.k)))
      clip.classList.toggle('zoomed', z.k !== 1)
      layer.querySelector<HTMLElement>('.rings-wrap')?.setAttribute('data-rings-zoom', String(z.k))
    }
    apply(ringsZoom)
    const view = (): ZoomView => ({ w: layer.offsetWidth, h: layer.offsetHeight, cw: clip.clientWidth, ch: clip.clientHeight })
    // Wave 25: without the phone frame the rings fit the window once (after the layer is in the DOM); a later home (k = 1) is a copy, so it is not refit.
    if (ringsZoom === RINGS_ZOOM_HOME && currentLayout() === 'trustweb' && !solo) {
      requestAnimationFrame(() => {
        const wrap = layer.querySelector<HTMLElement>('.rings-wrap')
        if (!wrap || ringsZoom !== RINGS_ZOOM_HOME || !clip.isConnected) return
        const k = fitZoom(wrap.offsetWidth, wrap.offsetHeight, clip.clientWidth, clip.clientHeight)
        if (k > 1) apply(zoomAt(ringsZoom, k, wrap.offsetLeft + wrap.offsetWidth / 2, wrap.offsetTop + wrap.offsetHeight / 2, view()))
      })
    }
    const zoom = (factor: number, e: { clientX: number; clientY: number }): void => {
      if (ringsZoom.k === 1) clip.scrollTop = 0
      const box = layer.getBoundingClientRect()
      apply(zoomAt(ringsZoom, factor, e.clientX - box.left + ringsZoom.x, e.clientY - box.top + ringsZoom.y, view()))
    }
    clip.addEventListener('wheel', (e) => {
      if (!e.ctrlKey || (e.target as HTMLElement).closest('[data-own-zoom]')) return
      e.preventDefault()
      zoom(Math.exp(-e.deltaY * 0.01), e)
    }, { passive: false })
    let last = 1
    type Gesture = Event & { scale: number; clientX: number; clientY: number }
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      clip.addEventListener(ev, (e) => {
        if ((e.target as HTMLElement).closest('[data-own-zoom]')) return
        e.preventDefault()
        const g = e as Gesture
        if (ev === 'gesturestart') last = 1
        else if (ev === 'gesturechange') { zoom(g.scale / last, g); last = g.scale }
      })
    }
    // A pan ends in a click on the same spot; the rings must not read it as a tap.
    let panned = false
    clip.addEventListener('click', (e) => { if (panned) e.stopPropagation() }, true)
    const down = new Map<number, { x: number; y: number }>()
    const spread = (): number => { const [a, b] = [...down.values()]; return Math.hypot(a.x - b.x, a.y - b.y) }
    let start: { x: number; y: number } | undefined
    let panning = false
    clip.addEventListener('pointerdown', (e) => {
      panned = false
      if ((e.target as HTMLElement).closest('[data-own-zoom]')) return
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
      start = down.size === 1 && !(e.target as HTMLElement).closest(skip) ? { x: e.clientX, y: e.clientY } : undefined
      if (down.size === 2) { start = undefined; clip.setPointerCapture(e.pointerId) }
    })
    clip.addEventListener('pointermove', (e) => {
      const was = down.get(e.pointerId)
      if (!was) return
      if (down.size === 2) {
        const before = spread()
        down.set(e.pointerId, { x: e.clientX, y: e.clientY })
        const [a, b] = [...down.values()]
        if (before > 0) zoom(spread() / before, { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
        return
      }
      if (!start || ringsZoom.k === 1) return
      if (!panning) {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) <= 6) return
        panning = panned = true
        clip.setPointerCapture(e.pointerId)
      }
      apply(panBy(ringsZoom, e.clientX - was.x, e.clientY - was.y, view()))
      down.set(e.pointerId, { x: e.clientX, y: e.clientY })
    })
    const lift = (e: PointerEvent): void => {
      down.delete(e.pointerId)
      start = undefined
      if (panning && down.size === 0) { panning = false; setTimeout(() => { panned = false }, 0) }
    }
    clip.addEventListener('pointerup', lift)
    clip.addEventListener('pointercancel', lift)
    clip.addEventListener('dblclick', (e) => {
      if (ringsZoom.k === 1 || (e.target as HTMLElement).closest(skip)) return
      clearTimeout(addTimer)
      apply(RINGS_ZOOM_HOME)
    })
  }

  /**
   * Drag a person's circle to another ring (mouse: after 4 px; touch: after a 300 ms hold, so the page still scrolls). The drop is read
   * from the distance to the centre; "intending to connect" first asks how much (0..10, default 5). The ring is the same value the outliner
   * and the CRM use (changeRing / placeOnRing).
   */
  function dragOnRings(wrap: HTMLElement, s: AppState, setDragged: (v: boolean) => void, settled?: (personId: string, ring: Ring) => void): void {
    let lifted = false
    wrap.addEventListener('touchmove', (e) => { if (lifted) e.preventDefault() }, { passive: false })
    wrap.addEventListener('pointerdown', (down) => {
      const node = (down.target as HTMLElement).closest<HTMLElement>('.node:not(.you)')
      const p = s.people.find((x) => x.id === node?.dataset.pid)
      if (!node || !p) return
      let ring = webSlot(p)
      let out = false
      let angle = angleOf(p)
      // While a person is held, every ring guide shows in full so the drop target is visible.
      const hiddenNow = loadHiddenRings()
      const guides = (dragging: boolean): void => wrap.querySelectorAll<SVGCircleElement>('circle[data-ring]').forEach((c) => { c.style.opacity = guideDimmed(hiddenNow.has(c.getAttribute('data-ring') as Ring), dragging) ? HIDDEN_GUIDE_OPACITY : '' })
      guides(true)
      const place = (e: PointerEvent): void => {
        const { x, y } = localPoint(e, wrap.getBoundingClientRect())
        node.style.left = x + 'px'
        node.style.top = y + 'px'
        const dist = Math.hypot(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2) / ringsK
        angle = angleFromCentre(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2)
        out = beyondRings(dist, ringsGeo)
        ring = ringAt(dist, ringsGeo.radius, ringsGeo.rings)
        wrap.classList.toggle('hide-zone', out)
        wrap.querySelectorAll('circle').forEach((c) => c.classList.toggle('drop', !out && c.getAttribute('data-ring') === ring))
      }
      const lift = (): void => { lifted = true; node.classList.add('lifted'); setDragged(true) }
      const timer = down.pointerType === 'mouse' ? 0 : window.setTimeout(lift, 300)
      // A second finger is a pinch: the lift ends without moving the dot.
      const second = (e: PointerEvent): void => { if (!e.isPrimary) cancel() }
      wrap.addEventListener('pointerdown', second)
      const move = (e: PointerEvent): void => {
        if (!lifted) {
          if (!dragStarts(e.clientX - down.clientX, e.clientY - down.clientY, Boolean(timer))) return
          if (timer) { end(); return }
          lift()
        }
        place(e)
      }
      const end = (): void => {
        clearTimeout(timer)
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', cancel)
        wrap.removeEventListener('pointerdown', second)
        guides(false)
        wrap.querySelectorAll('circle.drop').forEach((c) => c.classList.remove('drop'))
        wrap.classList.remove('hide-zone')
      }
      // The Desk's lent rings redraw from the Desk (settled), the phone's from render() inside each path.
      const done = (): void => settled?.(p.id, p.ring)
      const cancel = (): void => { const was = lifted; end(); lifted = false; setDragged(false); if (was) { render(); done() } }
      const up = (): void => {
        const was = lifted
        end(); lifted = false
        setTimeout(() => setDragged(false), 0)
        if (!was) return
        const outcome = dropOutcome(p, ring, out)
        if (outcome === 'hide') { void hideOnRings(p).then(done); return }
        if (outcome === 'family-stays') { render(); done(); return }
        // The dot keeps the angle it was dropped at.
        if (outcome === 'same-ring') { p.angle = angle; save(); render(); done(); return }
        if (outcome === 'unplace') { p.angle = angle; unplaceOnRings(p); done(); return }
        if (outcome === 'ask-desire') askDesire(wrap, p, intendingReminder(displayName(p.name).text, knownWays(p), lastMessagedAt(s.chats?.[p.peerId ?? ''])), () => { render(); done() }, (v) => { p.angle = angle; dropOn(p, ring, v); done() })
        else { p.angle = angle; dropOn(p, ring); done() }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', cancel)
    })
  }

  /** Right click, or a 500 ms hold that moved under 6 px, on empty web space or a ring line: a small menu to space the dots out equally. */
  function ringsMenuOn(wrap: HTMLElement, setHeld: (v: boolean) => void): void {
    let timer: ReturnType<typeof setTimeout> | undefined
    let from = { x: 0, y: 0 }
    const open = (e: MouseEvent): void => {
      const at = localPoint(e, wrap.getBoundingClientRect())
      const { near, onLine } = menuTarget(at, ringsGeo, ringsK)
      const item = (label: string, ring?: Ring): HTMLElement => el('button', { class: 'btn btn-ghost btn-sm', 'data-space-out': ring ?? 'all', onclick: () => spaceOutWeb(ring) }, [label])
      wrap.querySelector('.ctx-menu')?.remove()
      const menu = el('div', { class: 'ctx-menu', role: 'menu' }, [onLine ? item(S.ringsSpaceRing(S.ringLabel[near].toLowerCase()), near) : null, item(S.ringsSpaceAll)])
      const place = menuPlace(at)
      menu.style.left = place.left + 'px'
      menu.style.top = place.top + 'px'
      wrap.appendChild(menu)
      document.addEventListener('pointerdown', (d) => { if (!menu.contains(d.target as Node)) menu.remove() }, { once: true })
    }
    const stop = (): void => { clearTimeout(timer); timer = undefined }
    wrap.addEventListener('pointerdown', (e) => {
      setHeld(false)
      if (!e.isPrimary) { stop(); return }
      if ((e.target as HTMLElement).closest('.node, .ctx-menu, .desire, .hint-i') || e.pointerType === 'mouse') return
      from = { x: e.clientX, y: e.clientY }
      timer = setTimeout(() => { timer = undefined; setHeld(true); navigator.vibrate?.(15); open(e) }, 500)
    })
    wrap.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 6) stop() })
    for (const ev of ['pointerup', 'pointercancel']) wrap.addEventListener(ev, stop)
    wrap.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      if (!(e.target as HTMLElement).closest('.node')) open(e)
    })
  }

  /** Spaces the dots out equally (one ring, or all); Undo for 30 s restores every angle. */
  function spaceOutWeb(ring?: Ring): void {
    const s = st()
    const before = spaceOut(s, ring)
    save()
    render()
    showNotice(S.ringsSpaced, '', [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-space': '', onclick: () => { hideNotice(); restoreAngles(st(), before); save(); render() } }, [S.ringsHiddenUndo]),
    ], 30000)
  }

  /** A person dragged beyond the outermost ring: hidden like "hide in trustweb" (Curator Settings lists them, with unhide); Undo for 30 s. */
  function hideOnRings(p: Person): Promise<void> {
    const name = displayName(p.name).text
    return curator.hide(p.id).then(() => {
      showNotice(S.ringsHidden(name), S.ringsHiddenBody, [
        el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-hide': p.id, onclick: () => { hideNotice(); void curator.unhide(p.id) } }, [S.ringsHiddenUndo]),
      ], 30000)
    })
  }

  /** A Web view ring change goes on to Tana through the Curator's sync; the real record only (no solo, demo persona or test account). */
  function ringToTana(p: Person, ring: Ring): void {
    if (demoPhone()) return
    curator.ring(p.id, ring).catch((e: unknown) => console.warn('ring to Tana', e))
  }

  /** A placed person dragged out to the unsorted ring: back to "not placed yet"; Undo for 30 s restores the ring (and its intending value). */
  function unplaceOnRings(p: Person): void {
    const name = displayName(p.name).text
    const { ring, intending } = p
    changeRing(p, Ring.Unsorted)
    ringToTana(p, Ring.Unsorted)
    placeOnRing(p, Ring.Unsorted, Date.now())
    save()
    render()
    showNotice(S.ringsUnplaced(name), S.ringsUnplacedBody, [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-unplace': p.id, onclick: () => { hideNotice(); changeRing(p, ring); ringToTana(p, ring); p.intending = intending; if (!intending) delete p.intending; save(); render() } }, [S.ringsHiddenUndo]),
    ], 30000)
  }

  function dropOn(p: Person, ring: Ring, desire?: number): void {
    const { ring: was, intending, ringSuggested } = p
    if (p.ring === Ring.Family) save()
    else { changeRing(p, ring); ringToTana(p, ring) }
    placeOnRing(p, ring, Date.now(), desire)
    delete p.ringSuggested
    save()
    render()
    if (!ringSuggested) { toast(`${displayName(p.name).text}: ${S.ringLabel[ring].toLowerCase()}`); return }
    // A grey (suggested) dot dropped on a ring confirms it; Undo for 30 s puts the suggestion back.
    showNotice(S.ringsConfirmed(displayName(p.name).text, S.ringLabel[ring].toLowerCase()), '', [
      el('button', { class: 'btn btn-ghost btn-sm', 'data-undo-confirm': p.id, onclick: () => {
        hideNotice(); changeRing(p, was); ringToTana(p, was); p.intending = intending; if (!intending) delete p.intending; p.ringSuggested = true; save(); render()
      } }, [S.ringsHiddenUndo]),
    ], 30000)
  }

  /** The 0 to 10 chip row for "intending to connect" (default 5); nothing changes until "Move here". */
  function askDesire(wrap: HTMLElement, p: Person, reminder: string[], cancel: () => void, done: (value: number) => void): void {
    let value = DESIRE_DEFAULT
    const row = el('div', { class: 'desire', role: 'group', 'aria-label': S.desireAsk(displayName(p.name).text) })
    // A chip is replaced by draw() and Move here by render() while the click is still bubbling: the web's "add someone" tap must not see it.
    row.addEventListener('click', (e) => e.stopPropagation())
    const draw = (): void => row.replaceChildren(
      el('p', {}, [S.desireAsk(displayName(p.name).text)]),
      ...reminder.map((line) => el('p', { class: 'reminder', 'data-intending-reminder': '' }, [line])),
      el('div', { class: 'rchips' }, Array.from({ length: 11 }, (_, n) => el('button', {
        class: 'rchip' + (n === value ? ' on' : ''), style: `--rc:${ringColor({ ring: Ring.Intending })}`, 'aria-pressed': String(n === value),
        onclick: () => { value = n; draw() },
      }, [String(n)]))),
      el('div', { class: 'desire-go' }, [
        el('button', { class: 'btn btn-sm', onclick: () => done(value) }, [S.desireMove]),
        el('button', { class: 'btn btn-ghost btn-sm', onclick: cancel }, [S.desireCancel]),
      ]),
    )
    draw()
    wrap.appendChild(row)
  }

  /**
   * Tap on empty space in the web: "Add someone to your web?". The ring is
   * preselected by how far from you the tap landed. Works while the rings are
   * scaled for the query dock, because it measures the rendered box.
   */
  function onRingsTap(e: MouseEvent, wrap: HTMLElement): void {
    if ((e.target as HTMLElement).closest('.node, .ctx-menu')) return
    ripple(e)
    const at = localPoint(e, wrap.getBoundingClientRect())
    const dx = at.x - RINGS_SIZE / 2
    const dy = at.y - RINGS_SIZE / 2
    const dist = Math.hypot(dx, dy)
    const ring = nearestRing(dist, ringsGeo, ringsK)
    // Let the ripple show before the sheet rises over it.
    clearTimeout(addTimer)
    addTimer = setTimeout(() => addPersonSheet(ring), RIPPLE_LEAD_MS)
  }

  let addTimer: ReturnType<typeof setTimeout> | undefined
  return {
    ringsView,
    zoomOnWeb,
    resetZoom: () => { ringsZoom = RINGS_ZOOM_HOME },
    hideOnRings,
    ringToTana,
    spaceOutWeb,
  }
}
