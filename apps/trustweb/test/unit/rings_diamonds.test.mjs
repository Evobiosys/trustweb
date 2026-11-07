// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 34 rings-diamonds: diamonds on their ring, closest n, recent m per ring, wording. */
import { ringPoints, HANDLE } from '../../src/ring_handles.ts'
import { closestLimit, effectiveLimit, CLOSEST_LIMIT, closest150 } from '../../src/membranes_five.ts'
import { activeFilters } from '../../src/filter_active.ts'
import { S } from '../../src/strings.ts'
import { Ring } from '../../src/model.ts'

describe('ringPoints: each diamond on its ring at 6 o\'clock', () => {
  it('left = centre, top = centre + radius * k', () => {
    const pts = ringPoints([40, 90, 140], 176, 0.5, HANDLE)
    expect(pts.map((p) => p.left)).toEqual([176, 176, 176])
    expect(pts.map((p) => p.top)).toEqual([176 + 20, 176 + 45, 176 + 70])
  })
  it('innermost ring = topmost diamond', () => {
    const pts = ringPoints([40, 90, 140], 176, 1, HANDLE)
    expect(pts[0].top).toBeLessThan(pts[1].top)
    expect(pts[1].top).toBeLessThan(pts[2].top)
  })
  it('crowded rings: the outer diamond is pushed down by the minimum so none overlap', () => {
    const pts = ringPoints([40, 50, 52], 176, 1, HANDLE)
    expect(pts[0].top).toBe(216)
    expect(pts[1].top).toBe(216 + HANDLE + 4)
    expect(pts[2].top).toBe(216 + 2 * (HANDLE + 4))
  })
  it('well-spaced rings are not moved; empty = empty', () => {
    expect(ringPoints([40, 80], 176, 1, HANDLE).map((p) => p.top)).toEqual([216, 256])
    expect(ringPoints([], 176, 1, HANDLE)).toEqual([])
  })
})

describe('closestLimit', () => {
  it('absent or junk = 150; clamped 1..5000', () => {
    expect(closestLimit(undefined)).toBe(150)
    expect(closestLimit({})).toBe(150)
    expect(closestLimit({ closestN: 'x' })).toBe(150)
    expect(closestLimit({ closestN: NaN })).toBe(150)
    expect(closestLimit({ closestN: 50.7 })).toBe(50)
    expect(closestLimit({ closestN: 0 })).toBe(1)
    expect(closestLimit({ closestN: 99999 })).toBe(5000)
    expect(CLOSEST_LIMIT).toBe(150)
  })
  it('closest150 takes the limit', () => {
    const ps = Array.from({ length: 20 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, ring: 'friend', context: '', metAt: i, lines: [] }))
    expect(closest150(ps, {}, Date.now(), 7)).toHaveLength(7)
    expect(closest150(ps, {}, Date.now())).toHaveLength(20)
  })
})

describe('effectiveLimit', () => {
  it('on (default) = the membrane limit; off = everyone', () => {
    expect(effectiveLimit(undefined, {})).toBe(5)
    expect(effectiveLimit({}, { membraneLimit: 8 })).toBe(8)
    expect(effectiveLimit({ perRingLimitOff: true }, { membraneLimit: 8 })).toBe(Infinity)
  })
})

describe('filter chips', () => {
  it('closest chip names n', () => {
    const f = activeFilters({ closest150: true, closestN: 50 }, [], [])
    expect(f).toEqual([{ chip: 'closest150', label: 'Only the 50 closest' }])
    expect(activeFilters({ closest150: true }, [], [])[0].label).toBe('Only the 150 closest')
  })
  it('per ring chip only when on and m != 5', () => {
    expect(activeFilters({}, [], [], 5)).toEqual([])
    expect(activeFilters({}, [], [], 8)).toEqual([{ chip: 'perRing', label: '8 per ring' }])
    expect(activeFilters({ perRingLimitOff: true }, [], [], 8)).toEqual([])
  })
})

describe('wording', () => {
  it('Intending reads "Intending to connect" everywhere', () => {
    expect(S.ringLabel[Ring.Intending]).toBe('Intending to connect')
    expect(S.profViewerZone.intending).toBe('Someone on Intending to connect')
  })
  it('hover card: ring name first, then "Everyone:"', () => {
    expect(S.ringCardEveryone('Anna, Ben')).toBe('Everyone: Anna, Ben')
    expect(S.ringCardAria('Closest few', 'Anna, Ben')).toBe('Closest few, everyone: Anna, Ben')
  })
  it('filter sentence parts', () => {
    expect(S.closestBefore + S.closestAfter).toContain('closest to you')
  })
})
