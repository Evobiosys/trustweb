/** Pure parts of the Network view's person menu (right-click / long-press) and its canvas sizing; no DOM. */
export const LONG_PRESS_MS = 600
export const PRESS_SLOP = 8
export const MAX_DPR = 4
export const MAX_CANVAS_PX = 8192

export type MenuAction = 'pin' | 'unpin' | 'inspect' | 'hide'

/** A press is a long press once it was held long enough without moving past the slop. */
export const isLongPress = (heldMs: number, travelled: number): boolean => heldMs >= LONG_PRESS_MS && travelled <= PRESS_SLOP

export const menuActions = (pinned: boolean): MenuAction[] => [pinned ? 'unpin' : 'pin', 'inspect', 'hide']

/** Top-left of a menu of size (mw, mh) opened at (x, y) inside a box (w, h): flips/clamps so it stays fully inside. */
export function placeMenu(x: number, y: number, mw: number, mh: number, w: number, h: number): { x: number; y: number } {
  return { x: Math.max(0, Math.min(x, w - mw)), y: Math.max(0, Math.min(y, h - mh)) }
}

/** Backing-store scale for a w x h css canvas: the device pixel ratio, capped at 4x and at 8192 px per side. */
export const canvasScale = (dpr: number, w: number, h: number): number =>
  Math.max(1, Math.min(dpr, MAX_DPR, MAX_CANVAS_PX / Math.max(w, h, 1)))
