/** View-only zoom and pan of the Web screen body (never stored). Content point c shows at c * k + (x, y); pure, no DOM. */
export interface RingsZoom { k: number; x: number; y: number }

export const RINGS_ZOOM_MAX = 4
export const RINGS_ZOOM_HOME: RingsZoom = { k: 1, x: 0, y: 0 }

/** Content box (w, h, unzoomed) shown through a clip box (cw, ch), all in px. */
export interface ZoomView { w: number; h: number; cw: number; ch: number; /** Wave 41: the zoom-out floor (minZoom); absent = 1. */ minK?: number }

/** Keeps the content from leaving the clip empty; at k = 1 that means no pan. */
function clampPan(k: number, x: number, y: number, v: ZoomView): RingsZoom {
  if (k === 1) return { ...RINGS_ZOOM_HOME }
  // Wave 41: where a floor above 1 applies (desktop fit), content shorter than the clip sits centred instead of top-aligned.
  const centreY = (v.minK ?? 1) > 1 && v.h * k < v.ch
  return { k, x: Math.min(0, Math.max(Math.min(0, v.cw - v.w * k), x)), y: centreY ? (v.ch - v.h * k) / 2 : Math.min(0, Math.max(Math.min(0, v.ch - v.h * k), y)) }
}

/** Scales by factor around the layer point (px, py); the content point under it stays under it. */
export function zoomAt(z: RingsZoom, factor: number, px: number, py: number, v: ZoomView): RingsZoom {
  const k = Math.min(RINGS_ZOOM_MAX, Math.max(v.minK ?? 1, z.k * factor))
  return clampPan(k, px - ((px - z.x) / z.k) * k, py - ((py - z.y) / z.k) * k, v)
}

export function panBy(z: RingsZoom, dx: number, dy: number, v: ZoomView): RingsZoom {
  return clampPan(z.k, z.x + dx, z.y + dy, v)
}

export const transformOf = (z: RingsZoom): string => z.k === 1 ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.k})`

/** Wave 41: the gap (layout px) kept between the outermost ring and the clip's edge at the zoom-out floor (screenshot 44c47d0b: k about 1.43 in a 624 px clip). */
export const RINGS_FIT_MARGIN = 40

/**
 * Wave 41: the smallest zoom, where the outermost ring (`extent`, layout px from the centre to the outer edge of the outermost avatar) just
 * fits the shorter side of the clip (cw, ch) with RINGS_FIT_MARGIN to spare; never under 1, so a phone keeps the layout it has.
 */
export function minZoom(extent: number, cw: number, ch: number): number {
  if (extent <= 0 || cw <= 0 || ch <= 0) return 1
  return Math.max(1, Math.min(cw, ch) / (2 * (extent + RINGS_FIT_MARGIN)))
}

/** The most the responsive layout zooms in by itself (dots and labels stay crisp enough; a pinch may go further). */
export const RINGS_ZOOM_FIT_MAX = 2.4

/**
 * Wave 25 (Jakob 2026-10-29, the layout without a phone frame): the factor that fits the rings box (w, h) into the clip (cw, ch) with a
 * margin, capped; 1 when the clip is phone-sized or the gain would be small (under 15 %), so a phone or a narrow window keeps its rings.
 */
export function fitZoom(w: number, h: number, cw: number, ch: number): number {
  if (w <= 0 || h <= 0 || ch <= 560) return 1
  const k = Math.min(RINGS_ZOOM_FIT_MAX, (ch - 48) / h, (cw - 24) / w)
  return k > 1.15 ? k : 1
}
