// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 small-ui-a: dragging a ring's stroke spaces the rings out (src/ring_spacing.ts dragRingTo). */
import { MIN_RING_GAP, MIN_RING_RADIUS, MAX_RING_RADIUS, dragRingTo } from '../../src/ring_spacing.ts'

const rings = ['closest', 'close', 'friend', 'acquaintance', 'intending']
const radii = { closest: 48, close: 78, friend: 106, acquaintance: 132, intending: 156 }

describe('dragRingTo', () => {
  it('moves only the dragged ring when there is room', () => {
    const r = dragRingTo(radii, rings, 'friend', 112)
    expect(r.friend).toBe(112); expect(r.close).toBe(78); expect(r.acquaintance).toBe(132)
  })
  it('pushes the rings outside it outward to keep the gap', () => {
    const r = dragRingTo(radii, rings, 'friend', 140)
    expect(r.friend).toBe(140)
    expect(r.acquaintance).toBe(140 + MIN_RING_GAP)
    expect(r.intending).toBe(140 + 2 * MIN_RING_GAP)
  })
  it('pushes the rings inside it inward, never below the least radius', () => {
    const r = dragRingTo(radii, rings, 'friend', 60)
    expect(r.close).toBe(60 - MIN_RING_GAP)
    expect(r.closest).toBeGreaterThanOrEqual(MIN_RING_RADIUS)
    expect(r.friend - r.close).toBeGreaterThanOrEqual(MIN_RING_GAP)
  })
  it('clamps the dragged ring so every ring still fits between the limits', () => {
    expect(dragRingTo(radii, rings, 'closest', 1).closest).toBe(MIN_RING_RADIUS)
    expect(dragRingTo(radii, rings, 'intending', 9999).intending).toBe(MAX_RING_RADIUS)
    expect(dragRingTo(radii, rings, 'close', 9999).intending).toBeLessThanOrEqual(MAX_RING_RADIUS)
  })
  it('does not touch the input', () => {
    const copy = { ...radii }; dragRingTo(radii, rings, 'friend', 140); expect(radii).toEqual(copy)
  })
  it('ignores a ring that is not drawn', () => {
    expect(dragRingTo(radii, ['close', 'friend'], 'unsorted', 100)).toEqual(radii)
  })
})
