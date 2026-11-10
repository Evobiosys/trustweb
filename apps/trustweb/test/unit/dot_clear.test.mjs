// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39 small-ui-a: bubbles never overlap; they shrink when they must (src/dot_clear.ts). */
import { MIN_DOT_R, clearDots } from '../../src/dot_clear.ts'

const gap = (a, b, r) => Math.hypot(a.x - b.x, a.y - b.y) - r.get(a.id) - r.get(b.id)

describe('clearDots', () => {
  it('leaves dots that already clear each other at their size', () => {
    const r = clearDots([{ id: 'a', x: 0, y: 0, r: 10 }, { id: 'b', x: 40, y: 0, r: 10 }], [])
    expect(r.get('a')).toBe(10); expect(r.get('b')).toBe(10)
  })
  it('shrinks two overlapping dots until they no longer overlap', () => {
    const a = { id: 'a', x: 0, y: 0, r: 20 }, b = { id: 'b', x: 30, y: 0, r: 20 }
    const r = clearDots([a, b], [])
    expect(gap(a, b, r)).toBeGreaterThanOrEqual(0)
    expect(r.get('a')).toBeLessThan(20)
  })
  it('shrinks a crowd evenly enough that no pair overlaps', () => {
    const dots = Array.from({ length: 12 }, (_, i) => ({ id: `d${i}`, x: 60 * Math.cos(i / 2), y: 60 * Math.sin(i / 2), r: 21 }))
    const r = clearDots(dots, [])
    for (const a of dots) for (const b of dots) if (a.id < b.id) expect(gap(a, b, r)).toBeGreaterThanOrEqual(-0.01)
  })
  it('keeps clear of a fixed disc (the you avatar) without moving it', () => {
    const a = { id: 'a', x: 30, y: 0, r: 20 }
    const r = clearDots([a], [{ x: 0, y: 0, r: 22 }])
    expect(Math.hypot(a.x, a.y) - r.get('a') - 22).toBeGreaterThanOrEqual(0)
  })
  it('never goes below the least size, even for dots on the same spot', () => {
    const r = clearDots([{ id: 'a', x: 5, y: 5, r: 20 }, { id: 'b', x: 5, y: 5, r: 20 }], [])
    expect(r.get('a')).toBe(MIN_DOT_R); expect(r.get('b')).toBe(MIN_DOT_R)
  })
  it('does not depend on the zoom: positions and sizes are layout px', () => {
    const dots = [{ id: 'a', x: 0, y: 0, r: 20 }, { id: 'b', x: 30, y: 0, r: 20 }]
    expect(clearDots(dots, [])).toEqual(clearDots(dots.map((d) => ({ ...d })), []))
  })
  it('handles an empty or a single dot', () => {
    expect(clearDots([], []).size).toBe(0)
    expect(clearDots([{ id: 'a', x: 1, y: 1, r: 9 }], []).get('a')).toBe(9)
  })
})
