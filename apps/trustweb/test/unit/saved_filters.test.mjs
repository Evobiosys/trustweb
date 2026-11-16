// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b filters-communities (item 3): saved filter states (in/out chips), pinned above the filter row. */
import { applySavedFilter, pinSavedFilter, pinnedFilters, repairSavedFilters, saveFilterState, SAVED_FILTERS_MAX } from '../../src/saved_filters.ts'
import { migrate, SCHEMA_VERSION } from '../../src/schema_version.ts'

const rec = (over = {}) => ({ uiRings: { show: ['tag:iyg', 'person:a'], hide: ['tag:work'] }, ...over })

describe('saved filter states', () => {
  it('saves the current in/out chips under a name', () => {
    const s = rec()
    const f = saveFilterState(s, 'My IYG')
    expect(f).toMatchObject({ name: 'My IYG', show: ['tag:iyg', 'person:a'], hide: ['tag:work'] })
    expect(s.savedFilters).toHaveLength(1)
  })
  it('the same name replaces; an empty name or an empty filter saves nothing', () => {
    const s = rec()
    saveFilterState(s, 'x'); s.uiRings.show = ['tag:b']; saveFilterState(s, 'X')
    expect(s.savedFilters).toHaveLength(1)
    expect(s.savedFilters[0].show).toEqual(['tag:b'])
    expect(saveFilterState(s, '  ')).toBeNull()
    expect(saveFilterState({ uiRings: { show: [], hide: [] } }, 'e')).toBeNull()
  })
  it('at most SAVED_FILTERS_MAX', () => {
    const s = rec()
    for (let i = 0; i < SAVED_FILTERS_MAX + 3; i++) saveFilterState(s, 'n' + i)
    expect(s.savedFilters).toHaveLength(SAVED_FILTERS_MAX)
  })
  it('apply writes its chips back into uiRings', () => {
    const s = rec()
    const f = saveFilterState(s, 'a')
    s.uiRings = { show: [], hide: [] }
    expect(applySavedFilter(s, f.id)).toBe(true)
    expect(s.uiRings).toMatchObject({ show: ['tag:iyg', 'person:a'], hide: ['tag:work'] })
    expect(applySavedFilter(s, 'nope')).toBe(false)
  })
  it('pin / unpin; pinned lists only pinned ones', () => {
    const s = rec()
    const f = saveFilterState(s, 'a')
    saveFilterState(s, 'b')
    expect(pinnedFilters(s)).toEqual([])
    expect(pinSavedFilter(s, f.id, true)).toBe(true)
    expect(pinnedFilters(s).map((x) => x.name)).toEqual(['a'])
    pinSavedFilter(s, f.id, false)
    expect(pinnedFilters(s)).toEqual([])
    expect(pinSavedFilter(s, 'nope', true)).toBe(false)
  })
})

describe('schema 4 repair', () => {
  it('SCHEMA_VERSION is 4', () => expect(SCHEMA_VERSION).toBe(4))
  it('malformed entries go, good ones stay; empty list is dropped', () => {
    const s = { savedFilters: [{ id: 'a', name: 'ok', show: ['tag:x'], hide: [] }, { id: 3 }, 'junk', { id: 'b', name: 'b', show: 'bad', hide: [] }] }
    expect(repairSavedFilters(s)).toBe(true)
    expect(s.savedFilters.map((f) => f.id)).toEqual(['a'])
    const t = { savedFilters: [] }
    expect(repairSavedFilters(t)).toBe(true)
    expect('savedFilters' in t).toBe(false)
    expect(repairSavedFilters({})).toBe(false)
  })
  it('migrate runs it', () => {
    const s = { schemaVersion: 3, people: [], savedFilters: 'x' }
    migrate(s)
    expect(s.savedFilters).toBeUndefined()
    expect(s.schemaVersion).toBe(4)
  })
})
