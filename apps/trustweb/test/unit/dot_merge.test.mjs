// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32: dragging one dot onto another and holding there offers a merge (dot_merge.ts); nothing merges without a tap on Merge. */
import { HOLD_MS, holdEnabled, holdStart, holdStep, hitDot } from '../../src/dot_merge.ts'

describe('dot merge hold', () => {
  it('starts with nothing', () => {
    expect(holdStart()).toEqual({ phase: 'none' })
  })
  it('moving over another dot is pending, and the offer comes only after the hold time', () => {
    let s = holdStep(holdStart(), { type: 'move', over: 'b', at: 100 })
    expect(s.phase).toBe('pending')
    s = holdStep(s, { type: 'elapsed', at: 100 + HOLD_MS - 1 })
    expect(s.phase).toBe('pending')
    s = holdStep(s, { type: 'elapsed', at: 100 + HOLD_MS })
    expect(s).toEqual({ phase: 'offer', over: 'b', since: 100 })
  })
  it('moving within the same dot keeps the clock; another dot restarts it', () => {
    let s = holdStep(holdStart(), { type: 'move', over: 'b', at: 0 })
    s = holdStep(s, { type: 'move', over: 'b', at: 300 })
    expect(holdStep(s, { type: 'elapsed', at: HOLD_MS }).phase).toBe('offer')
    s = holdStep(s, { type: 'move', over: 'c', at: 400 })
    expect(s).toMatchObject({ phase: 'pending', over: 'c', since: 400 })
    expect(holdStep(s, { type: 'elapsed', at: HOLD_MS }).phase).toBe('pending')
  })
  it('leaving the dot (over null or leave) ends pending and offer', () => {
    const pending = holdStep(holdStart(), { type: 'move', over: 'b', at: 0 })
    const offer = holdStep(pending, { type: 'elapsed', at: HOLD_MS })
    expect(holdStep(pending, { type: 'move', over: null, at: 10 })).toEqual({ phase: 'none' })
    expect(holdStep(offer, { type: 'move', over: null, at: HOLD_MS + 10 })).toEqual({ phase: 'none' })
    expect(holdStep(offer, { type: 'leave' })).toEqual({ phase: 'none' })
  })
  it('an elapsed tick with nothing pending changes nothing', () => {
    expect(holdStep(holdStart(), { type: 'elapsed', at: 5000 })).toEqual({ phase: 'none' })
  })
  it('hitDot finds the other dot whose box holds the pointer, never itself', () => {
    const dots = [{ id: 'a', left: 0, top: 0, right: 40, bottom: 40 }, { id: 'b', left: 30, top: 0, right: 70, bottom: 40 }]
    expect(hitDot(dots, 'a', 50, 20)).toBe('b')
    expect(hitDot(dots, 'a', 35, 20)).toBe('b')
    expect(hitDot(dots, 'b', 35, 20)).toBe('a')
    expect(hitDot(dots, 'a', 10, 20)).toBeNull()
    expect(hitDot(dots, 'a', 200, 200)).toBeNull()
  })
})

describe('merge offer while the select tool is on (wave 37 regression)', () => {
  it('a plain drag of one dot still offers a merge when select mode is on with nothing ticked', () => {
    expect(holdEnabled({ canMerge: true, groupSize: 1 })).toBe(true)
  })
  it('select mode off: offered', () => expect(holdEnabled({ canMerge: true, groupSize: 1 })).toBe(true))
  it('a drag that carries several ticked dots never merges', () => expect(holdEnabled({ canMerge: true, groupSize: 3 })).toBe(false))
  it('without a merge route (solo) never', () => expect(holdEnabled({ canMerge: false, groupSize: 1 })).toBe(false))
})
