// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { toggle, selectGroup, clearSelection, snapshot, restoreSnapshot, BULK_RINGS } from '../../src/multi_select.ts'

describe('selection model (multi_select.ts)', () => {
  it('toggle adds and removes one id without touching the old set', () => {
    const a = new Set(['x'])
    const b = toggle(a, 'y')
    expect([...b]).toEqual(['x', 'y'])
    expect([...a]).toEqual(['x'])
    expect([...toggle(b, 'x')]).toEqual(['y'])
  })
  it('selectGroup selects the whole group, or unselects it when it was all selected', () => {
    expect([...selectGroup(new Set(['a']), ['a', 'b', 'c'])].sort()).toEqual(['a', 'b', 'c'])
    expect([...selectGroup(new Set(['a', 'b', 'z']), ['a', 'b'])]).toEqual(['z'])
  })
  it('selectGroup of an empty group changes nothing', () => {
    expect([...selectGroup(new Set(['a']), [])]).toEqual(['a'])
  })
  it('clearSelection is empty', () => expect(clearSelection().size).toBe(0))
})

describe('bulk undo (multi_select.ts)', () => {
  it('a snapshot puts ring, prevRing and the suggestion mark back', () => {
    const people = [{ id: 'a', ring: 'close', ringSuggested: true }, { id: 'b', ring: 'friend', prevRing: 'close' }, { id: 'c', ring: 'closest' }]
    const snap = snapshot(people, new Set(['a', 'b']))
    expect(snap.map((s) => s.id)).toEqual(['a', 'b'])
    people[0].ring = 'none'; delete people[0].ringSuggested
    people[1].ring = 'none'; delete people[1].prevRing
    restoreSnapshot(people, snap)
    expect(people[0]).toEqual({ id: 'a', ring: 'close', ringSuggested: true })
    expect(people[1]).toEqual({ id: 'b', ring: 'friend', prevRing: 'close' })
    expect(people[2]).toEqual({ id: 'c', ring: 'closest' })
  })
})

describe('rings offered by Move to ring', () => {
  it('the five rings and Not yet sorted', () => expect(BULK_RINGS).toEqual(['closest', 'close', 'friend', 'acquaintance', 'intending', 'unsorted']))
})
