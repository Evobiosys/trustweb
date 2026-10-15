/** View-only zoom and pan of the Web rings (never stored). Content point c shows at c * k + (x, y); pure, no DOM. */
export interface RingsZoom { k: number; x: number; y: number }

export const RINGS_ZOOM_MAX = 4
export const RINGS_ZOOM_HOME: RingsZoom = { k: 1, x: 0, y: 0 }

/** Keeps the content from leaving the 0..size box empty; at k = 1 that means no pan. */
function clampPan(k: number, x: number, y: number, size: number): RingsZoom {
  const lo = size * (1 - k)
  return { k, x: Math.min(0, Math.max(lo, x)), y: Math.min(0, Math.max(lo, y)) }
}

/** Scales by factor around the wrap point (px, py); the content point under it stays under it. */
export function zoomAt(z: RingsZoom, factor: number, px: number, py: number, size = 352): RingsZoom {
  const k = Math.min(RINGS_ZOOM_MAX, Math.max(1, z.k * factor))
  if (k === 1) return { ...RINGS_ZOOM_HOME }
  const cx = (px - z.x) / z.k
  const cy = (py - z.y) / z.k
  return clampPan(k, px - cx * k, py - cy * k, size)
}

export function panBy(z: RingsZoom, dx: number, dy: number, size: number): RingsZoom {
  return clampPan(z.k, z.x + dx, z.y + dy, size)
}

/** Wrap px to unzoomed content px (what the ring and angle maths expects). */
export function toLocal(z: RingsZoom, px: number, py: number): { x: number; y: number } {
  return { x: (px - z.x) / z.k, y: (py - z.y) / z.k }
}

export const transformOf = (z: RingsZoom): string => z.k === 1 ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.k})`
