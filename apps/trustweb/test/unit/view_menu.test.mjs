// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Web screen view chooser (wave 25): Web, Network; the expand flag shows everyone. No Desk. */
import { viewMenuEntries, pinnedViews, togglePin, viewHeading, webViewOf, expandedOf, screenViews } from '../../src/view_menu.ts'

describe('view_menu', () => {
  it('viewMenuEntries lists Web, Network, Simple list, Table, Map first, whoever is in the web', () => {
    const main = viewMenuEntries({ current: 'rings', hasMap: true, pins: [] }).filter((i) => i.group === 'main').map((i) => i.view)
    expect(main).toEqual(['rings', 'network', 'people', 'complete', 'map'])
  })
  it('lists Web, Network, Simple list, Table, then Other views: Dex, Contacts compact; the current one is on', () => {
    const m = viewMenuEntries({ current: 'rings', hasMap: true, pins: [] })
    expect(m.map((i) => i.view)).toEqual(['rings', 'network', 'people', 'complete', 'map', 'dex', 'compact', 'groups'])
    expect(m.filter((i) => i.other).map((i) => i.view)).toEqual(['dex', 'compact', 'groups'])
    expect(m.find((i) => i.on)?.view).toBe('rings')
    expect(viewMenuEntries({ current: 'dex', hasMap: true, pins: [] }).find((i) => i.on)?.view).toBe('dex')
  })
  it('hides only Map while no map exists', () => {
    expect(viewMenuEntries({ current: 'rings', hasMap: false, pins: [] }).map((i) => i.view)).toEqual(['rings', 'network', 'people', 'complete', 'dex', 'compact', 'groups'])
  })
  it('never lists a desk', () => {
    expect(viewMenuEntries({ current: 'rings', hasMap: true, pins: [] }).map((i) => i.view)).not.toContain('desk')
  })
  it('marks pinned views and pins in menu order, skipping unknown or unavailable ones', () => {
    expect(viewMenuEntries({ current: 'rings', hasMap: false, pins: ['dex'] }).find((i) => i.view === 'dex')?.pinned).toBe(true)
    expect(pinnedViews(['dex', 'network', 'nope', 'map'], false)).toEqual(['network', 'dex'])
    expect(pinnedViews(undefined, true)).toEqual([])
    expect(pinnedViews(['network'], true)).toEqual(['network'])
  })
  it('toggles a pin on and off', () => {
    expect(togglePin(undefined, 'network')).toEqual(['network'])
    expect(togglePin(['network', 'dex'], 'network')).toEqual(['dex'])
  })
  it('names the view as heading only when it is not Web', () => {
    expect(viewHeading('rings')).toBeNull()
    expect(viewHeading('network')).toBe('network')
    expect(viewHeading('map')).toBe('map')
  })
  it('reads the stored choice; anything else is Web', () => {
    expect(webViewOf('network')).toBe('network')
    expect(webViewOf('complete')).toBe('rings')
    expect(webViewOf('map')).toBe('map')
    expect(webViewOf('desk')).toBe('rings')
    expect(webViewOf(null)).toBe('rings')
  })
  it('expand is on only for the stored flag "1", and only on Web', () => {
    expect(expandedOf('1', 'rings')).toBe(true)
    expect(expandedOf('1', 'network')).toBe(false)
    expect(expandedOf(null, 'rings')).toBe(false)
    expect(expandedOf('0', 'rings')).toBe(false)
  })
  it('groups Contacts compact under Other views and Dex under Alternative UI (beta)', () => {
    const m = viewMenuEntries({ current: 'rings', hasMap: true, pins: [] })
    expect(m.map((i) => i.group)).toEqual(['main', 'main', 'main', 'main', 'main', 'alt', 'other', 'other'])
    expect(m.filter((i) => i.other).map((i) => i.view)).toEqual(['dex', 'compact', 'groups'])
  })
  it('lists the calendar and inventory views; Solar calendar is non-core and greyed until its module is there', () => {
    expect(screenViews('events', false)).toEqual([{ key: 'calendar', core: true, available: true }, { key: 'list', core: true, available: true }, { key: 'solar', core: false, available: false }])
    expect(screenViews('events', true).find((v) => v.key === 'solar')?.available).toBe(true)
    expect(screenViews('inventory', false).map((v) => v.key)).toEqual(['list', 'outline', 'matches', 'notes'])
  })
  it('keeps the eye menu on the People page: People is the view that is on, the others stay to switch to', () => {
    const m = viewMenuEntries({ current: 'people', hasMap: true, pins: [] })
    expect(m.find((i) => i.on)?.view).toBe('people')
    expect(m.map((i) => i.view)).toEqual(['rings', 'network', 'people', 'complete', 'map', 'dex', 'compact', 'groups'])
  })
  it('wave 33: Notes lives under Resources; a stale stored notes pin is dropped without a throw', () => {
    expect(viewMenuEntries({ current: 'rings', hasMap: true, pins: ['notes'] }).some((i) => i.view === 'notes')).toBe(false)
    expect(pinnedViews(['notes', 'people'], true)).toEqual(['people'])
    expect(screenViews('inventory', false).some((v) => v.key === 'notes')).toBe(true)
  })
})
