/** View-only zoom and pan of the Web screen body (never stored). Content point c shows at c * k + (x, y); pure, no DOM. */
export interface RingsZoom { k: number; x: number; y: number }

export const RINGS_ZOOM_MAX = 4
export const RINGS_ZOOM_HOME: RingsZoom = { k: 1, x: 0, y: 0 }

/** Content box (w, h, unzoomed) shown through a clip box (cw, ch), all in px. */
export interface ZoomView { w: number; h: number; cw: number; ch: number }

/** Keeps the content from leaving the clip empty; at k = 1 that means no pan. */
function clampPan(k: number, x: number, y: number, v: ZoomView): RingsZoom {
  if (k === 1) return { ...RINGS_ZOOM_HOME }
  return { k, x: Math.min(0, Math.max(Math.min(0, v.cw - v.w * k), x)), y: Math.min(0, Math.max(Math.min(0, v.ch - v.h * k), y)) }
}

/** Scales by factor around the layer point (px, py); the content point under it stays under it. */
export function zoomAt(z: RingsZoom, factor: number, px: number, py: number, v: ZoomView): RingsZoom {
  const k = Math.min(RINGS_ZOOM_MAX, Math.max(1, z.k * factor))
  return clampPan(k, px - ((px - z.x) / z.k) * k, py - ((py - z.y) / z.k) * k, v)
}

export function panBy(z: RingsZoom, dx: number, dy: number, v: ZoomView): RingsZoom {
  return clampPan(z.k, z.x + dx, z.y + dy, v)
}

export const transformOf = (z: RingsZoom): string => z.k === 1 ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.k})`
