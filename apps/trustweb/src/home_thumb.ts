// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c home-default: the live rings thumbnail on the Home "Web" tile: a small static SVG of the rings with one dot per person on their ring
 * (capped per ring). Drawn when Home opens and when the record changes (Home redraws then); no animation, no names.
 */
import { WEB_RINGS, webSlot } from './rings_layout'
import { RING_COLORS, type Person } from './model'

export const THUMB_DOTS_MAX = 12
const SIZE = 96

export interface ThumbRing { ring: string; count: number }

/** People per web ring, innermost first, the unsorted ring last. */
export function ringsThumb(people: Partial<Person>[]): ThumbRing[] {
  const n = new Map<string, number>(WEB_RINGS.map((r) => [r, 0]))
  for (const p of people) { const r = webSlot(p as Person); n.set(r, (n.get(r) ?? 0) + 1) }
  return WEB_RINGS.map((ring) => ({ ring, count: n.get(ring) ?? 0 }))
}

const NS = 'http://www.w3.org/2000/svg'
const svg = (tag: string, attrs: Record<string, string | number>): SVGElement => {
  const e = document.createElementNS(NS, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  return e
}

/** The thumbnail element; decorative (aria-hidden), the tile's button carries the label. */
export function ringsThumbEl(people: Person[]): SVGElement {
  const root = svg('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, width: SIZE, height: SIZE, class: 'home-thumb', 'data-home-thumb': '', 'aria-hidden': 'true' })
  const rings = ringsThumb(people)
  const step = (SIZE / 2 - 4) / rings.length
  rings.forEach((r, i) => {
    // closest ring = innermost = smallest
    const radius = step * (i + 1)
    root.appendChild(svg('circle', { cx: SIZE / 2, cy: SIZE / 2, r: radius, fill: 'none', stroke: (RING_COLORS as Record<string, unknown>)[r.ring] as string ?? RING_COLORS.unsorted, 'stroke-width': 1, opacity: 0.8 }))
    const dots = Math.min(r.count, THUMB_DOTS_MAX)
    for (let k = 0; k < dots; k++) {
      const a = (2 * Math.PI * k) / dots - Math.PI / 2
      root.appendChild(svg('circle', { cx: SIZE / 2 + radius * Math.cos(a), cy: SIZE / 2 + radius * Math.sin(a), r: 2, fill: (RING_COLORS as Record<string, unknown>)[r.ring] as string ?? RING_COLORS.unsorted }))
    }
  })
  return root
}
