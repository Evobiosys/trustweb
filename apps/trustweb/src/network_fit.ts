// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The Network view's opening camera: the graph's own bounds fitted and centred in the box, wherever the layout settled. */
export interface Camera { k: number; x: number; y: number }

const MARGIN = 24
const MAX_K = 1.5

export function fitBounds(nodes: readonly { x: number; y: number; r: number }[], w: number, h: number): Camera {
  if (!nodes.length) return { k: 1, x: w / 2, y: h / 2 }
  const minX = Math.min(...nodes.map((v) => v.x - v.r)); const maxX = Math.max(...nodes.map((v) => v.x + v.r))
  const minY = Math.min(...nodes.map((v) => v.y - v.r)); const maxY = Math.max(...nodes.map((v) => v.y + v.r))
  const k = Math.min(MAX_K, (w - MARGIN) / Math.max(1, maxX - minX), (h - MARGIN) / Math.max(1, maxY - minY))
  return { k, x: w / 2 - ((minX + maxX) / 2) * k, y: h / 2 - ((minY + maxY) / 2) * k }
}
