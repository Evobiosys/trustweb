import { describe, expect, it } from 'vitest'
import { Pick, joinPoints, linesToAdd, mergeEdits, mergeRows, repoint } from '../../src/merge'
import { ContactPointKind, InteractionKind } from '../../src/model'

describe('merge', () => {
  it('rows: only differing fields; the non-empty one by default, the newer on conflict', () => {
    const rows = mergeRows({ a: 'x', b: 'same', c: '', d: 'old' }, { a: '', b: 'same', c: 'y', d: 'new', e: true }, true)
    expect(rows.map((r) => [r.key, r.pick])).toEqual([['a', Pick.Keep], ['c', Pick.Other], ['d', Pick.Other], ['e', Pick.Other]])
    expect(mergeRows({ d: 'old' }, { d: 'new' }, false)[0].pick).toBe(Pick.Keep)
  })
  it('edits: the other side of the picked rows only', () => {
    const rows = mergeRows({ a: 'x', d: 'old' }, { c: 'y', d: 'new' }, false)
    expect(mergeEdits(rows, {})).toEqual([['c', 'y']])
    expect(mergeEdits(rows, { d: Pick.Other, a: Pick.Other })).toEqual([['d', 'new'], ['c', 'y']])
  })
  it('re-points records and reports the ids', () => {
    const list = [{ id: '1', personId: 'b', at: 0, kind: InteractionKind.Note, text: '' }, { id: '2', personId: 'c', at: 0, kind: InteractionKind.Note, text: '' }]
    expect(repoint(list, 'b', 'a')).toEqual(['1'])
    expect(list.map((x) => x.personId)).toEqual(['a', 'c'])
  })
  it('joins contact points and lines without doubles; ring markers stay behind', () => {
    const p = { kind: ContactPointKind.Phone, value: '+43 660 5550001' }
    expect(joinPoints([p], [p, { kind: ContactPointKind.Email, value: 'a@example.at' }])).toHaveLength(2)
    const l = (text: string, tag = 'note') => ({ text, tag })
    expect(linesToAdd([l('x')], [l('x'), l('y'), l('ring: derived'), l('x', 'custom')])).toEqual([l('y'), l('x', 'custom')])
  })
})
