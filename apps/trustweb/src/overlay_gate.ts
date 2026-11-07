// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36: when a hover card, line label or menu may open over the rings. Pure, DOM-free. */

/** The pointer (or finger) must rest this long on a ring line before its card opens. */
export const OVERLAY_DWELL_MS = 300
/** A move of this many px or more is no rest: the dwell starts over. */
export const DWELL_MOVE_PX = 6

export interface OverlayState {
  /** A dot is lifted (from the lift until pointerup / pointercancel). */
  dragging: boolean
  /** How long the pointer has rested on the line. */
  dwellMs: number
}

export const overlayAllowed = (s: OverlayState): boolean => !s.dragging && s.dwellMs >= OVERLAY_DWELL_MS

/** True while the pointer stayed within DWELL_MOVE_PX of where the rest began. */
export const restedAt = (from: { x: number; y: number }, now: { x: number; y: number }): boolean => Math.hypot(now.x - from.x, now.y - from.y) < DWELL_MOVE_PX
