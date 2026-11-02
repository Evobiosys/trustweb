// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The Web view's interaction code (rings, drag, context menu), moved out of main.ts so ring features and event features stop sharing
 * hunks there. Behaviour is unchanged. What the view cannot own (the state, the sheets, the Curator) comes in through `WebViewHost`;
 * the geometry of the last draw lives here, written by main.ts's ringsView through `setRingsLayout` and read by every pointer path below.
 * View state only (I1): nothing here leaves the device.
 */
import { el } from '../../demo/src/ui/dom'
import { Ring, RINGS } from './model'
import type { AppState, Person } from './model'
import { angleFromCentre, angleOf, beyondRings, ringAt, ringsGeometry, webSlot } from './rings_layout'
import type { RingsGeometry } from './rings_layout'
import { RINGS_HIDDEN_KEY, guideDimmed, parseHidden } from './rings_hide'
import { S } from './strings'

/** The rings' own layout box (px); pointer reads are scaled back to it. */
export const RINGS_SIZE = 352
/** How close (view px) a press must be to a ring's line to count as on it. */
export const RING_LINE_HIT = 10
/** A hidden ring's guide circle stays faintly visible. */
export const HIDDEN_GUIDE_OPACITY = '.25'

/** What the Web view asks of the app around it (main.ts supplies these). */
export interface WebViewHost {
  render(): void
  save(): void
  /** A person dropped beyond the outermost ring: hidden like "hide in trustweb" (Undo for 30 s). */
  hideOnRings(p: Person): Promise<void>
  /** A placed person dropped on the unsorted ring: back to "not placed yet" (Undo for 30 s). */
  unplaceOnRings(p: Person): void
  /** A drop on a ring; `desire` only for "intending to connect". */
  dropOn(p: Person, ring: Ring, desire?: number): void
  /** The 0 to 10 chip row for "intending to connect"; nothing changes until `done(value)`. */
  askDesire(wrap: HTMLElement, p: Person, s: AppState, cancel: () => void, done: (value: number) => void): void
  /** Spaces the dots out equally (one ring, or all). */
  spaceOut(ring?: Ring): void
}

/** The drawn rings of the last render: their radii (in layout units) and the factor that fits a crowded web into the view; a drop or tap is read through both. */
let geo: RingsGeometry = ringsGeometry({} as Record<Ring, number>)
let fit = 1

export function setRingsLayout(g: RingsGeometry, k: number): void { geo = g; fit = k }
export function ringsLayout(): { geo: RingsGeometry; k: number } { return { geo, k: fit } }

export function loadHiddenRings(): ReadonlySet<Ring> {
  try { return parseHidden(window.localStorage.getItem(RINGS_HIDDEN_KEY)) } catch { return new Set() }
}

/** A pointer position in the rings' own layout px, whatever the zoom layer and the query-dock scale do to the box. */
export function localPoint(e: { clientX: number; clientY: number }, wrap: HTMLElement): { x: number; y: number } {
  const box = wrap.getBoundingClientRect()
  const k = box.width / RINGS_SIZE
  return { x: (e.clientX - box.left) / k, y: (e.clientY - box.top) / k }
}

/** The ring nearest a distance (view px) from the centre, and whether the press is within RING_LINE_HIT of its circle. */
export function ringNear(dist: number): { ring: Ring; onLine: boolean } {
  const ring = ringAt(dist / fit, geo.radius, geo.rings)
  return { ring, onLine: Math.abs(geo.radius[ring] * fit - dist) <= RING_LINE_HIT }
}

/** The picker ring (RINGS) whose circle is nearest a distance (view px) from the centre: where a tap on empty space preselects. */
export function nearestRing(dist: number): Ring {
  return RINGS.reduce((best, r) => (Math.abs(geo.radius[r] * fit - dist) < Math.abs(geo.radius[best] * fit - dist) ? r : best), Ring.Acquaintance)
}

/** A point in layout px read as a drop: the ring it is nearest, its angle from the centre, and whether it lies beyond the outermost ring. */
export function dropTargetAt(x: number, y: number): { ring: Ring; angle: number; out: boolean } {
  const dist = Math.hypot(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2) / fit
  return { ring: ringAt(dist, geo.radius, geo.rings), angle: angleFromCentre(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2), out: beyondRings(dist, geo) }
}

/**
 * Drag a person's circle to another ring (mouse: after 4 px; touch: after a 300 ms hold, so the page still scrolls). The drop is read
 * from the distance to the centre; "intending to connect" first asks how much (0..10, default 5). The ring is the same value the outliner
 * and the CRM use (changeRing / placeOnRing).
 */
export function dragOnRings(wrap: HTMLElement, s: AppState, host: WebViewHost, setDragged: (v: boolean) => void, settled?: (personId: string, ring: Ring) => void): void {
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
      const { x, y } = localPoint(e, wrap)
      node.style.left = x + 'px'
      node.style.top = y + 'px'
      ;({ ring, angle, out } = dropTargetAt(x, y))
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
        if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < (timer ? 8 : 4)) return
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
    const cancel = (): void => { const was = lifted; end(); lifted = false; setDragged(false); if (was) { host.render(); done() } }
    const up = (): void => {
      const was = lifted
      end(); lifted = false
      setTimeout(() => setDragged(false), 0)
      if (!was) return
      if (out) { void host.hideOnRings(p).then(done); return }
      if (ring === Ring.Unsorted && p.ring === Ring.Family) { host.render(); done(); return }
      // The dot keeps the angle it was dropped at.
      if (ring === webSlot(p)) { p.angle = angle; host.save(); host.render(); done(); return }
      if (ring === Ring.Unsorted) { p.angle = angle; host.unplaceOnRings(p); done(); return }
      if (ring === Ring.Intending) host.askDesire(wrap, p, s, () => { host.render(); done() }, (v) => { p.angle = angle; host.dropOn(p, ring, v); done() })
      else { p.angle = angle; host.dropOn(p, ring); done() }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
  })
}

/** Right click, or a 500 ms hold that moved under 6 px, on empty web space or a ring line: a small menu to space the dots out equally. */
export function ringsMenuOn(wrap: HTMLElement, host: Pick<WebViewHost, 'spaceOut'>, setHeld: (v: boolean) => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  let from = { x: 0, y: 0 }
  const open = (e: MouseEvent): void => {
    const at = localPoint(e, wrap)
    const { x, y } = at
    const dist = Math.hypot(x - RINGS_SIZE / 2, y - RINGS_SIZE / 2)
    const { ring: near, onLine } = ringNear(dist)
    const item = (label: string, ring?: Ring): HTMLElement => el('button', { class: 'btn btn-ghost btn-sm', 'data-space-out': ring ?? 'all', onclick: () => host.spaceOut(ring) }, [label])
    wrap.querySelector('.ctx-menu')?.remove()
    const menu = el('div', { class: 'ctx-menu', role: 'menu' }, [onLine ? item(S.ringsSpaceRing(S.ringLabel[near].toLowerCase()), near) : null, item(S.ringsSpaceAll)])
    menu.style.left = Math.min(at.x, RINGS_SIZE - 170) + 'px'
    menu.style.top = Math.min(at.y, RINGS_SIZE - 70) + 'px'
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
