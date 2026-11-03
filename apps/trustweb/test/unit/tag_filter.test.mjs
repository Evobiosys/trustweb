// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28b zones-network-2: the TrustZones tag filters, "show only" and "hide" (src/tag_filter.ts). Pure. */
import { filterByChips } from '../../src/tag_filter.ts'

const tags = [{ id: 'club', colour: '#111111' }, { id: 'work', colour: '#222222' }]
const p = (id, tag) => ({ id, ring: 'friend', fields: tag ? { [tag]: 'true' } : {} })
const people = [p('a', 'club'), p('b', 'work'), p('c'), p('d', 'club')]
const ids = (r) => r.map((x) => x.id)

describe('filterByChips', () => {
  it('no chips: everyone', () => expect(ids(filterByChips(people, tags, [], []))).toEqual(['a', 'b', 'c', 'd']))
  it('show only a tag keeps its holders', () => expect(ids(filterByChips(people, tags, ['tag:club'], []))).toEqual(['a', 'd']))
  it('show only people and tags adds up', () => expect(ids(filterByChips(people, tags, ['tag:club', 'person:c'], []))).toEqual(['a', 'c', 'd']))
  it('hide removes', () => expect(ids(filterByChips(people, tags, [], ['tag:club', 'person:b']))).toEqual(['c']))
  it('hide wins over show only', () => expect(ids(filterByChips(people, tags, ['tag:club'], ['person:a']))).toEqual(['d']))
})
