// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30 filter-panel: the active tag/person chips as rows, and the folded-toggle count. Pure. */
import { activeFilters, activeCountLabel } from '../../src/filter_active.ts'

const tags = [{ id: 'family', label: 'family', colour: '#111111' }, { id: 'work', colour: '#222222' }]
const people = [{ id: 'a', name: 'Anna' }]

describe('activeFilters', () => {
  it('no ui or no chips: nothing', () => {
    expect(activeFilters(undefined, tags, people)).toEqual([])
    expect(activeFilters({ show: [], hide: [] }, tags, people)).toEqual([])
  })
  it('show chips read "Only", hide chips read "Hide"', () => {
    expect(activeFilters({ show: ['tag:family', 'person:a'], hide: ['tag:work'] }, tags, people)).toEqual([
      { chip: 'tag:family', label: 'Only #family' },
      { chip: 'person:a', label: 'Only @Anna' },
      { chip: 'tag:work', label: 'Hide #work' },
    ])
  })
  it('unknown ids fall back to the id', () => expect(activeFilters({ show: ['tag:gone'] }, tags, people)[0].label).toBe('Only #gone'))
})

describe('activeCountLabel', () => {
  it('empty for none, count otherwise', () => {
    expect(activeCountLabel(0)).toBe('')
    expect(activeCountLabel(1)).toBe(' (1 active)')
    expect(activeCountLabel(3)).toBe(' (3 active)')
  })
})
