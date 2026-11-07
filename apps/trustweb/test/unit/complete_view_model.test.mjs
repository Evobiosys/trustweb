// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { completeRows, sortRows, toggleSort, DEFAULT_SORT, visibleWindow, addTagToPeople, setPersonTag, tagLabel } from '../../src/complete_view_model.ts'
import { Ring } from '../../src/model.ts'

const DAY = 86_400_000
const NOW = 5000 * DAY
const person = (id, o = {}) => ({ id, name: id, context: '', ring: Ring.Friend, metAt: NOW - 100 * DAY, lines: [], ...o })
const ctx = (people, extra = {}) => ({ s: { people, shareProfiles: [], ...extra }, tags: [], now: NOW })
const rows = (people, extra, opts = {}) => completeRows(ctx(people, extra), { query: '', overdueOnly: false, ...opts })

describe('completeRows', () => {
  it('lists everyone except archived and deleted people', () => {
    const r = rows([person('a'), person('b', { ring: Ring.None }), person('c', { deleted_at: '2026-01-01T00:00:00Z', ring: Ring.None })])
    expect(r.map((x) => x.id)).toEqual(['a'])
  })
  it('carries last contact, cadence, next reminder and overdue', () => {
    const [r] = rows([person('a', { cadenceDays: 30, metAt: NOW - 40 * DAY })])
    expect(r.last).toBe(NOW - 40 * DAY)
    expect(r.cadence).toBe(30)
    expect(r.next).toBe(NOW - 10 * DAY)
    expect(r.overdue).toBe(true)
  })
  it('counts notes without keeping their text', () => {
    const [r] = rows([person('a', { lines: [{ id: '1' }, { id: '2' }], generalNote: 'secret', sharedNotes: [{}] })])
    expect(r.notes).toBe(4)
    expect(JSON.stringify(r)).not.toContain('secret')
  })
  it('shows colour tags, zone tags, groups and channels', () => {
    const tags = [{ id: 'gardener', colour: '#123456', label: 'Gardener' }, { id: 'z', colour: '#654321', label: 'Zone tag' }]
    const people = [person('a', { fields: { gardener: 'true' }, channels: { signal: '+4312345678', matrix: '' } })]
    const s = { people, shareProfiles: [{ id: 'g', name: 'Choir', members: ['person:a'] }, { id: 'h', name: 'Gardens', members: ['tag:gardener'] }, { id: 'i', name: 'Other', members: ['person:b'] }], zoneTags: { [Ring.Friend]: { ids: ['z'], stamp: 1 } } }
    const [r] = completeRows({ s, tags, now: NOW }, { query: '', overdueOnly: false })
    expect(r.tags).toEqual([{ id: 'gardener', label: 'Gardener', own: true }, { id: 'z', label: 'Zone tag', own: false }])
    expect(r.groups).toEqual(['Choir', 'Gardens'])
    expect(r.channels).toEqual(['signal'])
  })
  it('reads the affiliation from the fields, else the first line of the context', () => {
    const r = rows([person('a', { fields: { organization: 'Acme', 'job title': 'Cook' } }), person('b', { context: 'Met at the fair\nsecond line' }), person('c')])
    expect(r.map((x) => x.affil)).toEqual(['Acme · Cook', 'Met at the fair', ''])
  })
  it('filters by search text (accents ignored), overdue, hidden rings and tag chips', () => {
    const people = [person('José', { context: 'baker' }), person('Ann', { cadenceDays: 7, metAt: NOW - 30 * DAY }), person('Bo', { ring: Ring.Unsorted })]
    expect(rows(people, {}, { query: 'jose' }).map((x) => x.id)).toEqual(['José'])
    expect(rows(people, {}, { query: 'BAKER' }).map((x) => x.id)).toEqual(['José'])
    expect(rows(people, {}, { overdueOnly: true }).map((x) => x.id)).toEqual(['Ann'])
    expect(rows(people, { uiRings: { hidden: [Ring.Unsorted] } }).map((x) => x.id).sort()).toEqual(['Ann', 'José'])
    expect(rows(people, { uiRings: { hide: ['person:Ann'] } }).map((x) => x.id).sort()).toEqual(['Bo', 'José'])
    expect(rows(people, { uiRings: { show: ['person:Bo'] } }).map((x) => x.id)).toEqual(['Bo'])
  })
})

describe('sortRows', () => {
  const people = [
    person('b', { ring: Ring.Acquaintance, metAt: NOW - 1 * DAY, cadenceDays: 90 }),
    person('a', { ring: Ring.Closest, metAt: NOW - 50 * DAY }),
    person('c', { ring: Ring.Friend, metAt: NOW - 10 * DAY, cadenceDays: 7 }),
  ]
  const ids = (key, dir) => sortRows(rows(people), { key, dir }).map((x) => x.id)
  it('starts with the most drifted contact first', () => {
    expect(DEFAULT_SORT).toEqual({ key: 'last', dir: 1 })
    expect(ids('last', 1)).toEqual(['a', 'c', 'b'])
    expect(ids('last', -1)).toEqual(['b', 'c', 'a'])
  })
  it('sorts rings by closeness, not by the alphabet', () => {
    expect(ids('ring', 1)).toEqual(['a', 'c', 'b'])
  })
  it('sorts by name, cadence and next reminder; people without come last either way', () => {
    expect(ids('name', -1)).toEqual(['c', 'b', 'a'])
    expect(ids('cadence', 1)).toEqual(['c', 'b', 'a'])
    expect(ids('cadence', -1)).toEqual(['b', 'c', 'a'])
    expect(ids('next', 1)).toEqual(['c', 'b', 'a'])
  })
  it('toggles the direction on the same column and starts ascending on a new one', () => {
    expect(toggleSort({ key: 'last', dir: 1 }, 'last')).toEqual({ key: 'last', dir: -1 })
    expect(toggleSort({ key: 'last', dir: -1 }, 'name')).toEqual({ key: 'name', dir: 1 })
  })
})

describe('visibleWindow', () => {
  it('shows a slice with overscan, clamped to the list', () => {
    expect(visibleWindow(0, 40, 400, 5000, 5)).toEqual({ start: 0, end: 15 })
    expect(visibleWindow(4000, 40, 400, 5000, 5)).toEqual({ start: 95, end: 115 })
    expect(visibleWindow(999999, 40, 400, 5000, 5)).toEqual({ start: 4985, end: 5000 })
    expect(visibleWindow(0, 40, 400, 3, 5)).toEqual({ start: 0, end: 3 })
  })
  it('keeps the slice small for 5000 rows', () => {
    const { start, end } = visibleWindow(123456, 44, 700, 5000, 10)
    expect(end - start).toBeLessThan(50)
  })
})

describe('tags on people', () => {
  it('sets and clears a tag on a person', () => {
    const p = person('a')
    setPersonTag(p, 'x', true)
    expect(p.fields.x).toBe('true')
    setPersonTag(p, 'x', false)
    expect(p.fields.x).toBeUndefined()
  })
  it('tags the selected people, creates an unknown tag, and undoes it', () => {
    const people = [person('a'), person('b'), person('c')]
    const out = addTagToPeople(people, new Set(['a', 'c']), [], 'Choir')
    expect(out.tags).toHaveLength(1)
    const id = out.tags[0].id
    expect(tagLabel(out.tags[0])).toBe('Choir')
    expect(people.map((p) => p.fields?.[id])).toEqual(['true', undefined, 'true'])
    out.undo()
    expect(people.map((p) => p.fields?.[id])).toEqual([undefined, undefined, undefined])
  })
  it('reuses a tag with the same name', () => {
    const tags = [{ id: 'choir', colour: '#123456', label: 'Choir' }]
    const out = addTagToPeople([person('a')], new Set(['a']), tags, ' choir ')
    expect(out.tags).toBe(tags)
  })
})
