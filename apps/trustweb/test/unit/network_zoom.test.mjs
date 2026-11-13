// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 web-zoom-dots: Network dots and names follow the zoom linearly (clamped), no longer sqrt(k) / fixed 11 px. */
import { DOT_K_MAX, DOT_K_MIN, LABEL_K_MAX, dotRadiusAt, labelPx } from '../../src/network_graph.ts'

describe('network zoom scaling', () => {
  it('dot radius is linear in k between the clamps', () => {
    expect(dotRadiusAt(20, 1)).toBe(20)
    expect(dotRadiusAt(20, 2)).toBe(40)
    expect(dotRadiusAt(20, 2) / dotRadiusAt(20, 1)).toBe(2)
  })
  it('the old sqrt law is gone: 4x zoom is not 2x dot', () => {
    expect(dotRadiusAt(20, 3) / dotRadiusAt(20, 0.75)).toBeCloseTo(4, 5)
  })
  it('dot radius clamps: readable minimum, no giant dots', () => {
    expect(dotRadiusAt(20, 0.01)).toBe(20 * DOT_K_MIN)
    expect(dotRadiusAt(20, 8)).toBe(20 * DOT_K_MAX)
  })
  it('a boost factor (search match) multiplies after the clamp', () => {
    expect(dotRadiusAt(20, 2, 1.2)).toBeCloseTo(48, 5)
  })
  it('label px = base * clamp(k, 1, LABEL_K_MAX)', () => {
    expect(labelPx(11, 0.3)).toBe(11)
    expect(labelPx(11, 1)).toBe(11)
    expect(labelPx(11, 2)).toBe(22)
    expect(labelPx(11, 8)).toBe(11 * LABEL_K_MAX)
  })
  it('garbage k falls back to 1', () => {
    expect(dotRadiusAt(20, NaN)).toBe(20)
    expect(labelPx(11, NaN)).toBe(11)
  })
})
