// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 overlay-fixes: the ring-line card opens only when the pointer sits on the stroke; the intending line stays readable but thinner than the acquaintance line. */
import { Ring } from '../../src/model.ts'
import { RING_HIT_TOLERANCE_PX, RING_STROKE_OPACITY, RING_STROKE_WIDTH, onRingLine } from '../../src/ring_hit.ts'

const C = 176
const radius = { closest: 48, close: 78, friend: 106, acquaintance: 132, intending: 156, unsorted: 176, none: 176, family: 48 }
const geo = { radius, rings: [Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending] }

describe('ring line hit (ring_hit.ts)', () => {
  it('tolerance is 4 px each side of the stroke', () => expect(RING_HIT_TOLERANCE_PX).toBe(4))
  it('a point on the stroke hits its ring', () => {
    expect(onRingLine(geo, { x: C + 132, y: C }, 1)).toBe(Ring.Acquaintance)
    expect(onRingLine(geo, { x: C, y: C - 78 }, 1)).toBe(Ring.Close)
  })
  it('hits up to half the stroke width plus 4 px away, both sides', () => {
    const reach = RING_STROKE_WIDTH[Ring.Acquaintance] / 2 + RING_HIT_TOLERANCE_PX
    expect(onRingLine(geo, { x: C + 132 + reach, y: C }, 1)).toBe(Ring.Acquaintance)
    expect(onRingLine(geo, { x: C + 132 - reach, y: C }, 1)).toBe(Ring.Acquaintance)
    expect(onRingLine(geo, { x: C + 132 + reach + 0.5, y: C }, 1)).toBeNull()
    expect(onRingLine(geo, { x: C + 132 - reach - 0.5, y: C }, 1)).toBeNull()
  })
  it('the open space between two lines hits nothing (not the whole annulus)', () => {
    expect(onRingLine(geo, { x: C + 119, y: C }, 1)).toBeNull()
    expect(onRingLine(geo, { x: C + 90, y: C }, 1)).toBeNull()
  })
  it('the centre and beyond the outer line hit nothing', () => {
    expect(onRingLine(geo, { x: C, y: C }, 1)).toBeNull()
    expect(onRingLine(geo, { x: C + 175, y: C }, 1)).toBeNull()
  })
  it('radii are read through k', () => {
    const k = 0.8
    expect(onRingLine(geo, { x: C + 156 * k, y: C }, k)).toBe(Ring.Intending)
    expect(onRingLine(geo, { x: C + 156 * k + 12, y: C }, k)).toBeNull()
  })
})

describe('ring stroke (ring_hit.ts)', () => {
  it('the intending line is clearly thinner than the acquaintance line', () => {
    expect(RING_STROKE_WIDTH[Ring.Intending]).toBeLessThan(RING_STROKE_WIDTH[Ring.Acquaintance])
    expect(RING_STROKE_WIDTH[Ring.Intending] / RING_STROKE_WIDTH[Ring.Acquaintance]).toBeLessThanOrEqual(0.8)
  })
  it('the intending line reads clearly: opacity at least .6', () => expect(RING_STROKE_OPACITY[Ring.Intending]).toBeGreaterThanOrEqual(0.6))
})
