// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37: the per-ring list card is resizable and remembers its size per ring (localStorage). Pure, DOM-free. */

export const MIN_OVERLAY_W = 140
export const MIN_OVERLAY_H = 90

export interface OverlaySize { w: number; h: number }

export const overlayKey = (ring: string): string => `tw.overlaySize.${ring}`

export const serializeSize = (s: OverlaySize): string => JSON.stringify({ w: Math.round(s.w), h: Math.round(s.h) })

const sane = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 10_000

export function parseSize(raw: string | null): OverlaySize | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { w?: unknown; h?: unknown }
    return sane(v.w) && sane(v.h) ? { w: v.w, h: v.h } : null
  } catch { return null }
}

/** At least the minimum, at most the room left in the viewport (the room wins, so the page never scrolls sideways). */
export const clampSize = (s: OverlaySize, room: OverlaySize): OverlaySize => ({ w: Math.min(Math.max(s.w, MIN_OVERLAY_W), room.w), h: Math.min(Math.max(s.h, MIN_OVERLAY_H), room.h) })
