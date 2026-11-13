// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42: where an overlay (ring card, menu) must move so it stays inside the clip and above the bottom bar. Pure, screen px. */
export interface Box { left: number; top: number; right: number; bottom: number }

/** The gap kept between an overlay and the bottom bar. */
export const BAR_GAP = 8

/** The shift (dx, dy) that brings `card` inside `clip` and above `barTop - BAR_GAP`; a card larger than the room is aligned to the top-left, so its title stays reachable. */
export function fitInto(card: Box, clip: Box, barTop: number | null): { dx: number; dy: number } {
  const floor = Math.min(clip.bottom, barTop === null ? Infinity : barTop - BAR_GAP)
  const axis = (lo: number, hi: number, minEdge: number, maxEdge: number): number => {
    if (hi - lo > maxEdge - minEdge || lo < minEdge) return minEdge - lo
    return hi > maxEdge ? maxEdge - hi : 0
  }
  return { dx: axis(card.left, card.right, clip.left, clip.right), dy: axis(card.top, card.bottom, clip.top, floor) }
}

/**
 * Review wave 42 (P06): the floor an overlay must stay above: the bottom bar's top, raised to the top of any floating button (the "Ask your web"
 * button) that lies below the card's top and that the card spans horizontally. null = no floor (no bar along the bottom, no such button).
 */
export function floorOf(card: Box, barTop: number | null, floats: readonly Box[]): number | null {
  const tops = floats.filter((f) => f.top > card.top && card.left < f.right && f.left < card.right).map((f) => f.top)
  const all = [...(barTop === null ? [] : [barTop]), ...tops]
  return all.length ? Math.min(...all) : null
}

/** Floating buttons an overlay must not cover. */
export const FLOAT_SEL = '.query-fab'

/** The overlays that sit in the zoomed Web layer at a layout-px left/top. */
export const OVERLAY_SEL = '[data-ring-card], .ctx-menu, [data-rel-card]'

/** Moves every open overlay under `root` back inside `clip` and above the bottom bar (`nav.tabs`, when it runs along the bottom). Call after a zoom, pan or open. */
export function fitOverlays(root: ParentNode, clip: Element): void {
  const c = clip.getBoundingClientRect()
  const bar = document.querySelector('nav.tabs')?.getBoundingClientRect()
  const barTop = bar && bar.width > bar.height && bar.top > c.top ? bar.top : null
  const floats = [...document.querySelectorAll<HTMLElement>(FLOAT_SEL)].map((f) => f.getBoundingClientRect()).filter((f) => f.width > 0 && f.top > c.top)
  root.querySelectorAll<HTMLElement>(OVERLAY_SEL).forEach((o) => {
    const r = o.getBoundingClientRect()
    if (!r.width || !o.offsetWidth) return
    const floor = floorOf(r, barTop, floats)   // review wave 42: the "Ask your web" button counts like the bar (P06)
    const room = Math.min(c.bottom, floor === null ? Infinity : floor - BAR_GAP) - c.top
    const s = r.width / o.offsetWidth   // on-screen px per layout px of the zoom layer
    // Zoomed in, a card can outgrow the clip: let it shrink to the room (its list scrolls) instead of running off the screen.
    if (r.width > c.width) { o.style.minWidth = '0'; o.style.maxWidth = Math.floor(c.width / s) + 'px' }
    if (o.getBoundingClientRect().height > room) o.style.maxHeight = Math.floor(room / s) + 'px'
    // An absolute box widens as its left edge moves left (more room to the right): measure again after each shift.
    for (let pass = 0; pass < 3; pass++) {
      const { dx, dy } = fitInto(o.getBoundingClientRect(), c, floor)
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) break
      o.style.left = (parseFloat(o.style.left) || 0) + dx / s + 'px'
      o.style.top = (parseFloat(o.style.top) || 0) + dy / s + 'px'
    }
  })
}
