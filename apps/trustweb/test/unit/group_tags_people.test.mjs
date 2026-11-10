// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 group-tags: group tags over real people (colour tags), the Web filter and the support audience. */
import { memberIds, memberTagsOf } from '../../src/colour_tags.ts'
import { filterByChips } from '../../src/tag_filter.ts'
import { audience } from '../../src/support_ask.ts'
import { Ring } from '../../src/model.ts'

const p = (id, tags = [], ring = Ring.Friend) => ({ id, name: id, ring, peerId: 'peer-' + id, fields: Object.fromEntries(tags.map((x) => [x, 'true'])) })
const people = [p('a', ['c1']), p('b', ['c1', 'c2']), p('c', ['c2']), p('d', ['other']), p('e')]
const ct = (id, extra = {}) => ({ id, colour: '#2e7d32', label: id.toUpperCase(), ...extra })
const tags = [ct('iyg', { kind: 'group', excludes: ['b'] }), ct('c1', { parents: ['iyg'] }), ct('c2', { parents: ['iyg'] }), ct('other')]
const ids = (l) => l.map((x) => x.id)

describe('group tags over people', () => {
  it('memberIds resolves children minus excludes; a plain tag is its holders', () => {
    expect(memberIds(people, tags, 'iyg').sort()).toEqual(['a', 'c'])
    expect(memberIds(people, tags, 'c1').sort()).toEqual(['a', 'b'])
    expect(memberIds(people, tags, 'unknown')).toEqual([])
  })

  it('memberTagsOf lists the plain tags a person holds and the groups it resolves into', () => {
    expect(memberTagsOf(people[0], people, tags).map((t) => t.id)).toEqual(['iyg', 'c1'])
    expect(memberTagsOf(people[1], people, tags).map((t) => t.id)).toEqual(['c1', 'c2'])
  })

  it('the Web filter: a group chip shows its members, hide wins', () => {
    expect(ids(filterByChips(people, tags, ['tag:iyg'], []))).toEqual(['a', 'c'])
    expect(ids(filterByChips(people, tags, ['tag:c1'], ['tag:iyg']))).toEqual(['b'])
    expect(ids(filterByChips(people, tags, [], ['tag:iyg']))).toEqual(['b', 'd', 'e'])
  })

  it('the support audience takes a group tag as its zone', () => {
    const has = (x, t) => memberIds(people, tags, t).includes(x.id)
    expect(ids(audience(people, { zone: 'tag:iyg' }, has))).toEqual(['a', 'c'])
  })
})

import { completeRows } from '../../src/complete_view_model.ts'

describe('curate rows', () => {
  it('a person shows the groups they resolve into as inherited tags (not removable), excluded ones not', () => {
    const rows = completeRows({ s: { people: people.map((x) => ({ ...x, context: '', metAt: 0, lines: [] })) }, tags, now: 0 }, { query: '', overdueOnly: false })
    const of = (id) => rows.find((r) => r.id === id).tags.map((t) => `${t.id}${t.own ? '' : '*'}`)
    expect(of('a')).toEqual(['c1', 'iyg*'])
    expect(of('b')).toEqual(['c1', 'c2'])
  })
})
