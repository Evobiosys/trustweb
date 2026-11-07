// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Trust path (design system): the line from you through the people who
 * connect you, drawn as an SVG path and named in words, never scored.
 * The caller puts `d` on a `<path class="trust-path">`.
 */
export function renderTrustPath(
  points: ReadonlyArray<{ x: number; y: number }>,
  names: ReadonlyArray<string>,
): { d: string; label: string } {
  if (points.length < 2 || points.length !== names.length) {
    throw new RangeError('trust path needs at least two points and one name per point')
  }
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  return { d, label: names.join(' - ') }
}
