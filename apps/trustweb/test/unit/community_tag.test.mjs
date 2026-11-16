// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b filters-communities (item 8): the community meta tag: #community:<name> in the app, community_<name> in code. */
import { COMMUNITY_CHIP, communityLabel, communityTag, communityPickerRows } from '../../src/community_tag.ts'
import { suggest, candidates } from '../../src/share_page.ts'
import { filterByChips } from '../../src/tag_filter.ts'
import { activeFilters, showCommunity } from '../../src/filter_active.ts'

describe('communityTag / communityLabel', () => {
  it('code form community_<name>, app label #community:<name>', () => {
    expect(communityTag('IYG')).toBe('community_IYG')
    expect(communityTag('Rigdzin Group')).toBe('community_Rigdzin_Group')
    expect(communityLabel('IYG')).toBe('#community:IYG')
    expect(communityLabel('  IYG ')).toBe('#community:IYG')
  })
})

const tags = [{ id: 'iyg', label: 'IYG', colour: '#1', community: true }, { id: 'rigdzin', label: 'Rigdzin', colour: '#2', community: true }, { id: 'work', label: 'work', colour: '#3' }]
const p = (id, ...t) => ({ id, name: id, ring: 'friend', fields: Object.fromEntries(t.map((x) => [x, 'true'])) })

describe('tag picker', () => {
  const all = candidates({ people: [], tags })
  it('community tags show as #community:<name>; the bare community candidate sits beside them', () => {
    expect(all.find((c) => c.id === 'tag:iyg').label).toBe('community:IYG')
    expect(all.find((c) => c.id === COMMUNITY_CHIP).label).toBe('community')
    expect(all.find((c) => c.id === 'tag:work').label).toBe('work')
  })
  it('#IYG finds #community:IYG', () => expect(suggest('#IYG', all, []).map((c) => c.id)).toContain('tag:iyg'))
  it('#community lists the bare tag and every community tag', () => {
    const ids = suggest('#community', all, []).map((c) => c.id)
    expect(ids).toEqual(expect.arrayContaining([COMMUNITY_CHIP, 'tag:iyg', 'tag:rigdzin']))
    expect(ids).not.toContain('tag:work')
  })
  it('no community tag: no bare candidate', () => expect(candidates({ people: [], tags: [tags[2]] }).some((c) => c.id === COMMUNITY_CHIP)).toBe(false))
  it('communityPickerRows names the rows a query offers', () => expect(communityPickerRows('#community', tags).map((r) => r.label)).toEqual(['#community', '#community:IYG', '#community:Rigdzin']))
})

describe('the bare community chip', () => {
  const people = [p('a', 'iyg'), p('b', 'rigdzin'), p('c', 'work'), p('d')]
  it('keeps everyone who shares any community with me', () => expect(filterByChips(people, tags, [COMMUNITY_CHIP], []).map((x) => x.id)).toEqual(['a', 'b']))
  it('hide works the same way', () => expect(filterByChips(people, tags, [], [COMMUNITY_CHIP]).map((x) => x.id)).toEqual(['c', 'd']))
  it('shows in the active-filter list', () => expect(activeFilters({ show: [COMMUNITY_CHIP] }, tags, [])).toEqual([{ chip: 'community', label: 'Only #community' }]))
  it('a community tag chip reads #community:<name>', () => expect(activeFilters({ show: ['tag:iyg'] }, tags, [])[0].label).toBe('Only #community:IYG'))
})

describe('Eye > Community (item 1)', () => {
  it('turns the community filter on silently: one chip, nothing else, idempotent', () => {
    const s = { uiRings: { show: ['tag:work'] } }
    expect(showCommunity(s)).toBe(true)
    expect(s.uiRings.show).toEqual(['tag:work', COMMUNITY_CHIP])
    expect(showCommunity(s)).toBe(false)
    expect(s.uiRings.show).toEqual(['tag:work', COMMUNITY_CHIP])
  })
  it('lifts a hide of the same chip', () => {
    const s = {}
    showCommunity(s)
    expect(s.uiRings).toEqual({ show: [COMMUNITY_CHIP], hide: [] })
  })
})
