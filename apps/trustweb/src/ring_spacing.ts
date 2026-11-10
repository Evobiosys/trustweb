// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Room for dots and labels on one ring while the web is zoomed (Jakob 2026-10-29: "the people should still adjust"). Pure; the view applies it. */

/** Wave 39: names zoom with the web like the bubbles (the layer's transform scales both), so no counter-scale: always 1. */
export const labelScale = (_zoom: number): number => 1

/** The arc room (layout px) a label of `base` px asks for on the ring at this zoom. */
export const labelGap = (zoom: number, base: number): number => base * labelScale(zoom)

/** Angles (deg) nudged along a ring of radius `r` so neighbours sit at least `gap` px apart (chord); an even spread when the ring cannot hold them. Order of the input kept. */
export function spreadOnRing(angles: readonly number[], r: number, gap: number): number[] {
  const n = angles.length
  if (n < 2) return [...angles]
  const min = (2 * Math.asin(Math.min(1, gap / (2 * r))) * 180) / Math.PI
  const order = angles.map((a, i) => ({ a: ((a % 360) + 360) % 360, i })).sort((x, y) => x.a - y.a)
  const out = new Array<number>(n)
  let prev = -Infinity
  let last = 0
  order.forEach(({ a, i }, k) => { last = k === 0 ? a : Math.max(a, prev + min); prev = last; out[i] = last })
  if (order[0].a + 360 - last >= min) return out
  return order.reduce((acc, { i }, k) => { acc[i] = order[0].a + (360 * k) / n; return acc }, new Array<number>(n))
}

/** Wave 39: the rings keep this many layout px between neighbouring lines, and stay inside these limits when a stroke is dragged. */
export const MIN_RING_GAP = 14
export const MIN_RING_RADIUS = 30
export const MAX_RING_RADIUS = 240

/**
 * Wave 39: the radii after the stroke of `ring` was dragged to `to` (layout px). The dragged ring is clamped so all rings still fit between the limits;
 * rings outside it are pushed outward, rings inside it inward, just far enough to keep MIN_RING_GAP. `rings` lists the drawn rings inner to outer.
 */
export function dragRingTo<R extends string>(radii: Readonly<Record<R, number>>, rings: readonly R[], ring: R, to: number): Record<R, number> {
  const out = { ...radii } as Record<R, number>
  const i = rings.indexOf(ring)
  if (i < 0) return out
  out[ring] = Math.min(MAX_RING_RADIUS - MIN_RING_GAP * (rings.length - 1 - i), Math.max(MIN_RING_RADIUS + MIN_RING_GAP * i, to))
  for (let j = i + 1; j < rings.length; j++) out[rings[j]] = Math.max(out[rings[j]], out[rings[j - 1]] + MIN_RING_GAP)
  for (let j = i - 1; j >= 0; j--) out[rings[j]] = Math.min(out[rings[j]], out[rings[j + 1]] - MIN_RING_GAP)
  return out
}
