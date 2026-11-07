// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33: "Show only the 150 people closest to you" (membranes_five.ts closest150). */
import { Ring } from '../../src/model.ts'
import { closest150, CLOSEST_LIMIT } from '../../src/membranes_five.ts'
import { activeFilters } from '../../src/filter_active.ts'

const NOW = Date.UTC(2026, 10, 7, 12, 0)
const person = (i, o = {}) => ({ id: 'p' + String(i).padStart(3, '0'), name: 'p' + i, context: '', ring: Ring.Friend, metAt: i + 1, ...o })
const many = (n, o = {}) => Array.from({ length: n }, (_, i) => person(i, o))

describe('closest150', () => {
  it('keeps exactly 150, ranked pinned first then most recent', () => {
    const ps = many(200)
    ps[3] = person(3, { pinned: true, metAt: 1 })
    const out = closest150(ps, {}, NOW)
    expect(CLOSEST_LIMIT).toBe(150)
    expect(out).toHaveLength(150)
    expect(out[0].id).toBe('p003')
    expect(out[1].id).toBe('p199')
    expect(out.map((p) => p.id)).not.toContain('p000')
  })
  it('is stable on ties (by id)', () => {
    const ps = many(160, { metAt: 5 })
    expect(closest150([...ps].reverse(), {}, NOW).map((p) => p.id)).toEqual(ps.slice(0, 150).map((p) => p.id))
  })
  it('returns everyone when there are 150 or fewer', () => {
    expect(closest150(many(150), {}, NOW)).toHaveLength(150)
    expect(closest150(many(7), {}, NOW)).toHaveLength(7)
    expect(closest150([], {}, NOW)).toEqual([])
  })
  it('only ranks the people it is given (expanse-hidden ones stay out)', () => {
    const ps = many(200).filter((p) => p.id !== 'p199')
    expect(closest150(ps, {}, NOW).map((p) => p.id)).not.toContain('p199')
  })
})

describe('closest150 filter row', () => {
  it('lists as an active filter when on, not when off', () => {
    expect(activeFilters({ closest150: true }, [], []).map((f) => f.chip)).toContain('closest150')
    expect(activeFilters({}, [], [])).toEqual([])
    expect(activeFilters(undefined, [], [])).toEqual([])
  })
})
