// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Room for dots and labels on one ring while the web is zoomed (Jakob 2026-10-29: "the people should still adjust"). Pure; the view applies it. */

/** Labels keep their screen size under the zoom layer's transform, so in layout px they shrink by 1 / zoom. */
export const labelScale = (zoom: number): number => 1 / Math.max(1, zoom)

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
