// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Where a ring's handles (the ⊖/⊕ toggle and the ⛶ fill button beside it) sit so they never cover a person dot. Pure; web_view.ts applies it. */

/** Handle button size (px) and the free margin kept around it. */
export const HANDLE = 16
export const HANDLE_MARGIN = 4
/** Half the button's diagonal: its corners must clear a dot too. */
const REACH = HANDLE * Math.SQRT1_2
/** The fill button sits this far right of the toggle (along the ring's tangent). */
const MORE_OFFSET = 16
/** Arc candidates, degrees clockwise from 12 o'clock: 12, 1:30, 10:30, 3, 9, 4:30, 7:30, 6. */
const ARCS = [0, 45, -45, 90, -90, 135, -135, 180] as const
/** Tab rows tried per corner, and their pitch (px). */
const TAB_ROWS = 6
const TAB_PITCH = HANDLE + 4

export interface Disc { x: number; y: number; r: number }
export interface Point { left: number; top: number }
export interface Handles { kind: 'arc' | 'tab'; angle?: number; toggle: Point; more?: Point }
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
  more: boolean
}

const free = (ps: readonly Point[], dots: readonly Disc[]): boolean =>
  ps.every((p) => dots.every((d) => Math.hypot(p.left - d.x, p.top - d.y) >= REACH + d.r + HANDLE_MARGIN))

const pair = (toggle: Point, dx: number, more: boolean): Point[] => (more ? [toggle, { left: toggle.left + dx, top: toggle.top }] : [toggle])

/** Prefer 12 o'clock on the ring, then the nearest free arc; a ring too dense for any arc gets its handles on a tab in a corner outside the rings. */
export function placeHandles(i: HandleInput): Handles {
  for (const angle of ARCS) {
    const a = (angle * Math.PI) / 180
    const toggle = { left: i.centre + i.radius * Math.sin(a), top: i.centre - i.radius * Math.cos(a) }
    const dx = MORE_OFFSET * Math.cos(a)
    const dy = MORE_OFFSET * Math.sin(a)
    const ps = [toggle, ...(i.more ? [{ left: toggle.left + dx, top: toggle.top + dy }] : [])]
    if (free(ps, i.dots)) return { kind: 'arc', angle, toggle, ...(i.more ? { more: ps[1] } : {}) }
  }
  const lo = HANDLE / 2 + 2
  const hi = i.size - HANDLE / 2 - 2
  for (let row = 0; row < TAB_ROWS; row++) {
    const top = lo + row * TAB_PITCH
    for (const left of [lo, hi - MORE_OFFSET]) {
      const toggle = { left, top }
      const ps = pair(toggle, MORE_OFFSET, i.more)
      if (ps.every((p) => Math.hypot(p.left - i.centre, p.top - i.centre) > i.outer + HANDLE) && free(ps, i.dots)) return { kind: 'tab', toggle, ...(i.more ? { more: ps[1] } : {}) }
    }
  }
  const toggle = { left: lo, top: lo }
  return { kind: 'tab', toggle, ...(i.more ? { more: { left: lo + MORE_OFFSET, top: lo } } : {}) }
}
