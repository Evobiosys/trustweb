// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The Expanse (src/expanse.ts): people hidden from the rings that keep their ring membership. */
import { hideInExpanse, bringBack, bringAllBack, inExpanse, expanseList, overControl } from '../../src/expanse.ts'

describe('expanse', () => {
  it('hides a person once, in order, without touching the people', () => {
    const s = {}
    hideInExpanse(s, 'a'); hideInExpanse(s, 'b'); hideInExpanse(s, 'a')
    expect(s.expanse).toEqual(['a', 'b'])
    expect(inExpanse(s, 'a')).toBe(true)
    expect(inExpanse(s, 'c')).toBe(false)
  })
  it('brings one back, then all; an empty expanse leaves no key', () => {
    const s = { expanse: ['a', 'b'] }
    bringBack(s, 'a')
    expect(s.expanse).toEqual(['b'])
    bringBack(s, 'zzz')
    expect(s.expanse).toEqual(['b'])
    bringBack(s, 'b')
    expect('expanse' in s).toBe(false)
    s.expanse = ['a', 'b']
    bringAllBack(s)
    expect('expanse' in s).toBe(false)
  })
  it('lists only people that still exist', () => {
    const s = { expanse: ['a', 'gone', 'b'], people: [{ id: 'b' }, { id: 'a' }] }
    expect(expanseList(s).map((p) => p.id)).toEqual(['a', 'b'])
    expect(expanseList({ people: [] })).toEqual([])
  })
  it('reads a pointer over the control by its box', () => {
    const box = { left: 10, top: 10, right: 40, bottom: 40 }
    expect(overControl(box, 20, 20)).toBe(true)
    expect(overControl(box, 41, 20)).toBe(false)
    expect(overControl(box, 20, 5)).toBe(false)
  })
})
