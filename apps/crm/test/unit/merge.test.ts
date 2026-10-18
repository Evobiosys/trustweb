import { describe, expect, it } from 'vitest'
import { Pick, clearedCount, customAllowed, dismiss, joinPoints, linesToAdd, mergeEdits, mergeRows, neitherAllowed, repoint } from '../../src/merge'
import { LAST_NAME_KEY } from '../../src/placement'
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
  it('adds both values, joins notes on a new line, and lets a side be dismissed', () => {
    const rows = mergeRows({ a: 'x', IVe9VSySDcS1: 'n1' }, { a: 'y', IVe9VSySDcS1: 'n2' }, true)
    expect(mergeEdits(rows, { a: Pick.Both, IVe9VSySDcS1: Pick.Both })).toEqual([['a', 'x · y'], ['IVe9VSySDcS1', 'n1\nn2']])
    expect(mergeEdits(rows, { a: Pick.Neither })).toContainEqual(['a', ''])
    expect(dismiss(Pick.Keep, Pick.Keep)).toBe(Pick.Neither)
    expect(dismiss(Pick.Both, Pick.Keep)).toBe(Pick.Other)
    expect(dismiss(Pick.Other, Pick.Keep)).toBe(Pick.Other)
  })
  it('neither: never for the ring; a name part only while the other part keeps a value; cleared count', () => {
    const rows = mergeRows({ 'tw-ring': 'friend', 'tw-first': 'Ann', a: 'x' }, { 'tw-ring': 'acquaintance', 'tw-first': 'Anna', a: 'y' }, true)
    expect(neitherAllowed('tw-ring', rows, {}, {})).toBe(false)
    expect(neitherAllowed('a', rows, {}, {})).toBe(true)
    expect(neitherAllowed('tw-first', rows, {}, {})).toBe(false)
    expect(neitherAllowed('tw-first', rows, {}, { [LAST_NAME_KEY]: 'Muster' })).toBe(true)
    const both = mergeRows({ 'tw-first': 'Ann', [LAST_NAME_KEY]: 'M' }, { 'tw-first': 'Anna', [LAST_NAME_KEY]: 'Muster' }, true)
    expect(neitherAllowed(LAST_NAME_KEY, both, { 'tw-first': Pick.Neither }, {})).toBe(false)
    expect(neitherAllowed(LAST_NAME_KEY, both, { 'tw-first': Pick.Both }, {})).toBe(true)
    expect(clearedCount(rows, { a: Pick.Neither, 'tw-first': Pick.Neither })).toBe(2)
  })
  it('custom: a typed value replaces both; empty keeps the survivor; never for the ring; counts as a value for the name guard', () => {
    const rows = mergeRows({ 'tw-ring': 'friend', 'tw-first': 'Ann', a: 'x' }, { 'tw-ring': 'acquaintance', 'tw-first': 'Anna', a: 'y' }, true)
    expect(mergeEdits(rows, { a: Pick.Custom }, { a: '  z  ' })).toContainEqual(['a', 'z'])
    expect(mergeEdits(rows, { a: Pick.Custom }, { a: '   ' }).some(([k]) => k === 'a')).toBe(false)
    expect(mergeEdits(rows, { 'tw-ring': Pick.Custom }, { 'tw-ring': 'close' }).some(([k]) => k === 'tw-ring')).toBe(false)
    expect(customAllowed('tw-ring')).toBe(false)
    expect(customAllowed('a')).toBe(true)
    const both = mergeRows({ 'tw-first': 'Ann', [LAST_NAME_KEY]: 'M' }, { 'tw-first': 'Anna', [LAST_NAME_KEY]: 'Muster' }, true)
    expect(neitherAllowed(LAST_NAME_KEY, both, { 'tw-first': Pick.Custom }, {}, { 'tw-first': 'Anne' })).toBe(true)
    expect(neitherAllowed(LAST_NAME_KEY, both, { 'tw-first': Pick.Custom }, {}, {})).toBe(false)
  })
})
