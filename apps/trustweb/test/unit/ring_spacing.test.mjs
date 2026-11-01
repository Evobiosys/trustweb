// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Labels and dots on one ring keep their room when the web is zoomed (src/ring_spacing.ts). */
import { labelGap, labelScale, spreadOnRing } from '../../src/ring_spacing.ts'

const chord = (a, b, r) => {
  const d = (((b - a) % 360) + 360) % 360
  return 2 * r * Math.sin((Math.min(d, 360 - d) * Math.PI) / 360)
}

describe('ring spacing', () => {
  it('keeps labels at screen size: the scale is 1 / zoom, never above 1', () => {
    expect(labelScale(1)).toBe(1)
    expect(labelScale(2)).toBe(0.5)
    expect(labelScale(0.5)).toBe(1)
  })

  it('the room a label needs on the ring shrinks as the zoom grows', () => {
    expect(labelGap(1, 40)).toBe(40)
    expect(labelGap(2, 40)).toBe(20)
    expect(labelGap(3, 40)).toBeCloseTo(13.33, 1)
  })

  for (const zoom of [1, 2, 3]) {
    it(`12 people bunched on one ring do not overlap at zoom ${zoom}`, () => {
      const r = 84
      const angles = Array.from({ length: 12 }, (_, i) => 10 + i * 2)
      const out = spreadOnRing(angles, r, labelGap(zoom, 40))
      const sorted = [...out].sort((a, b) => a - b)
      for (let i = 0; i < sorted.length; i++) {
        const next = sorted[(i + 1) % sorted.length]
        expect(chord(sorted[i], next, r)).toBeGreaterThanOrEqual(labelGap(zoom, 40) - 0.5)
      }
    })
  }

  it('leaves people who already have room where they are', () => {
    expect(spreadOnRing([0, 90, 180, 270], 84, 20)).toEqual([0, 90, 180, 270])
  })

  it('never moves people past an even spread when the ring is too small', () => {
    const out = spreadOnRing([0, 1, 2, 3], 10, 100)
    expect(out.map((a) => Math.round(a))).toEqual([0, 90, 180, 270])
  })
})
