// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Web screen view chooser (wave 25): Web, Network; the expand flag shows everyone. No Desk. */
import { viewMenu, pinnedViews, togglePin, viewHeading, webViewOf, expandedOf, screenViews } from '../../src/view_menu.ts'

describe('view_menu', () => {
  it('lists Web, Network, People, then Other views: Dex, Contacts compact; the current one is on', () => {
    const m = viewMenu('rings', true, true, [])
    expect(m.map((i) => i.view)).toEqual(['rings', 'network', 'people', 'map', 'dex', 'compact'])
    expect(m.filter((i) => i.other).map((i) => i.view)).toEqual(['dex', 'compact'])
    expect(m.find((i) => i.on)?.view).toBe('rings')
    expect(viewMenu('dex', true, true, []).find((i) => i.on)?.view).toBe('dex')
  })
  it('hides Network and People while nobody is in the web, and Map while no map exists', () => {
    expect(viewMenu('rings', false, false, []).map((i) => i.view)).toEqual(['rings', 'dex', 'compact'])
  })
  it('never lists a desk', () => {
    expect(viewMenu('rings', true, true, []).map((i) => i.view)).not.toContain('desk')
  })
  it('marks pinned views and pins in menu order, skipping unknown or unavailable ones', () => {
    expect(viewMenu('rings', true, false, ['dex']).find((i) => i.view === 'dex')?.pinned).toBe(true)
    expect(pinnedViews(['dex', 'network', 'nope', 'map'], true, false)).toEqual(['network', 'dex'])
    expect(pinnedViews(undefined, true, true)).toEqual([])
    expect(pinnedViews(['network'], false, true)).toEqual([])
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
  it('reads the stored choice; anything else, or nobody in the web, is Web', () => {
    expect(webViewOf('network', true)).toBe('network')
    expect(webViewOf('complete', true)).toBe('rings')
    expect(webViewOf('map', true)).toBe('map')
    expect(webViewOf('map', false)).toBe('rings')
    expect(webViewOf('network', false)).toBe('rings')
    expect(webViewOf('desk', true)).toBe('rings')
    expect(webViewOf(null, true)).toBe('rings')
  })
  it('expand is on only for the stored flag "1", and only on Web', () => {
    expect(expandedOf('1', 'rings')).toBe(true)
    expect(expandedOf('1', 'network')).toBe(false)
    expect(expandedOf(null, 'rings')).toBe(false)
    expect(expandedOf('0', 'rings')).toBe(false)
  })
  it('groups Contacts compact under Other views and Dex under Alternative UI (beta)', () => {
    const m = viewMenu('rings', true, true, [])
    expect(m.map((i) => i.group)).toEqual(['main', 'main', 'main', 'main', 'alt', 'other'])
    expect(m.filter((i) => i.other).map((i) => i.view)).toEqual(['dex', 'compact'])
  })
  it('lists the calendar and inventory views; Solar calendar is non-core and greyed until its module is there', () => {
    expect(screenViews('events', false)).toEqual([{ key: 'calendar', core: true, available: true }, { key: 'list', core: true, available: true }, { key: 'solar', core: false, available: false }])
    expect(screenViews('events', true).find((v) => v.key === 'solar')?.available).toBe(true)
    expect(screenViews('inventory', false).map((v) => v.key)).toEqual(['list', 'outline', 'matches'])
  })
  it('keeps the eye menu on the People page: People is the view that is on, the others stay to switch to', () => {
    const m = viewMenu('people', true, true, [])
    expect(m.find((i) => i.on)?.view).toBe('people')
    expect(m.map((i) => i.view)).toEqual(['rings', 'network', 'people', 'map', 'dex', 'compact'])
  })
})
