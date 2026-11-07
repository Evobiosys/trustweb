// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Where a ring's toggle handle sits so they never cover a person dot. Pure; web_view.ts applies it. */

/** Handle button size (px) and the free margin kept around it. */
export const HANDLE = 16
export const HANDLE_MARGIN = 4
/** Half the button's diagonal: its corners must clear a dot too. */
const REACH = HANDLE * Math.SQRT1_2
/** Arc candidates, degrees clockwise from 12 o'clock: 12, 1:30, 10:30, 3, 9, 4:30, 7:30, 6. */
const ARCS = [0, 45, -45, 90, -90, 135, -135, 180] as const
/** Tab rows tried per corner, and their pitch (px). */
const TAB_ROWS = 6
const TAB_PITCH = HANDLE + 4

export interface Disc { x: number; y: number; r: number }
export interface Point { left: number; top: number }
export interface Handles { kind: 'arc' | 'tab'; angle?: number; toggle: Point }
export interface HandleInput {
  centre: number
  /** Ring radius in px (already scaled). */
  radius: number
  /** Everything the handles must keep off: person dots and the handles already placed. */
  dots: readonly Disc[]
  /** Outermost extent of any dot from the centre; a tab sits beyond it. */
  outer: number
  /** Side of the square the rings are drawn in. */
  size: number
}

const free = (ps: readonly Point[], dots: readonly Disc[]): boolean =>
  ps.every((p) => dots.every((d) => Math.hypot(p.left - d.x, p.top - d.y) >= REACH + d.r + HANDLE_MARGIN))

/** Prefer 12 o'clock on the ring, then the nearest free arc; a ring too dense for any arc gets its handles on a tab in a corner outside the rings. */
export function placeHandles(i: HandleInput): Handles {
  for (const angle of ARCS) {
    const a = (angle * Math.PI) / 180
    const toggle = { left: i.centre + i.radius * Math.sin(a), top: i.centre - i.radius * Math.cos(a) }
    if (free([toggle], i.dots)) return { kind: 'arc', angle, toggle }
  }
  const lo = HANDLE / 2 + 2
  const hi = i.size - HANDLE / 2 - 2
  for (let row = 0; row < TAB_ROWS; row++) {
    const top = lo + row * TAB_PITCH
    for (const left of [lo, hi]) {
      const toggle = { left, top }
      if (Math.hypot(toggle.left - i.centre, toggle.top - i.centre) > i.outer + HANDLE && free([toggle], i.dots)) return { kind: 'tab', toggle }
    }
  }
  return { kind: 'tab', toggle: { left: lo, top: lo } }
}

/** Wave 33: a ring's expand button sits this far right of its diamond (same row). */
export const EXPAND_DX = TAB_PITCH

/** Wave 33: the diamonds' ONE column: `count` row centres on x = `centre`, the first at the bottom edge of the `size` square, each next one `HANDLE + 4` px higher (toward the centre). */
export const chainPoints = (count: number, centre: number, size: number): Point[] =>
  Array.from({ length: count }, (_, i) => ({ left: centre, top: size - HANDLE / 2 - 2 - i * TAB_PITCH }))

/** Wave 34: each ring's diamond ON its drawn line at 6 o'clock: `radii` innermost first (layout px), scaled by `k`; the innermost is topmost, an outer one is pushed down just far enough to keep a diamond's pitch from the one above. */
export const ringPoints = (radii: readonly number[], centre: number, k: number, handle: number): Point[] => {
  let prev = -Infinity
  return radii.map((r) => {
    const top = Math.max(centre + r * k, prev + handle + 4)
    prev = top
    return { left: centre, top }
  })
}
