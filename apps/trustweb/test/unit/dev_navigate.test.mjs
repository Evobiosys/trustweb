// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30 (P2/P5): the taps that bring the app to a catalogue row's view before its steps, and the feature flag read from URL or storage. */
import { navPlan, navNote, readFlag, flagSteps } from '../../src/dev_navigate.ts'

const sels = (p) => p.taps.map((t) => t.selector)

describe('navPlan', () => {
  it('needs no tap when the app is on the row\'s screen and view already', () => {
    expect(navPlan('chat', 'chat')).toEqual({ taps: [], path: 'Chat' })
    expect(navPlan('web', 'web', 'rings').taps).toEqual([])
    expect(navPlan('map', 'web', 'map').taps).toEqual([])
    expect(navPlan('people', 'people').taps).toEqual([])
  })

  it('web -> map opens the eye and picks Map (a pinned Map skips the eye)', () => {
    const p = navPlan('map', 'web', 'rings')
    expect(sels(p)).toEqual(['.view-menu-btn', '[data-view-pin="map"], .view-opt[data-view="map"]'])
    expect(p.taps[0].skipIf).toBe('[data-view-pin="map"]')
    expect(p.path).toBe('Web > Map')
  })

  it('chat -> settings is the gear', () => {
    expect(sels(navPlan('settings', 'chat'))).toEqual(['[data-settings-gear]'])
  })

  it('chat -> people goes to the Web tab first, then the eye', () => {
    expect(sels(navPlan('people', 'chat'))).toEqual(['[data-go="web"]', '.view-menu-btn', '[data-view-pin="people"], .view-opt[data-view="people"]'])
  })

  it('people -> web and network -> web come back to the rings through the eye', () => {
    expect(sels(navPlan('web', 'people'))).toEqual(['.view-menu-btn', '[data-view-pin="rings"], .view-opt[data-view="rings"]'])
    expect(sels(navPlan('trustzones', 'web', 'network'))).toEqual(['.view-menu-btn', '[data-view-pin="rings"], .view-opt[data-view="rings"]'])
  })

  it('tabs: events, inventory, chat', () => {
    expect(sels(navPlan('events', 'web', 'rings'))).toEqual(['[data-go="events"]'])
    expect(navPlan('inventory', 'chat').path).toBe('Resources')
    expect(sels(navPlan('chat', 'web'))).toEqual(['[data-go="chat"]'])
  })

  it('reads the catalogue\'s TrustWeb-<View> form and any case', () => {
    expect(sels(navPlan('TrustWeb-Settings', 'web'))).toEqual(['[data-settings-gear]'])
    expect(sels(navPlan('Chat', 'web'))).toEqual(['[data-go="chat"]'])
  })

  it('the panel itself needs no navigation', () => {
    expect(navPlan('panel', 'chat')).toEqual({ taps: [], path: '' })
  })

  it('an unknown context gives no taps and a reason', () => {
    const p = navPlan('The page never scrolls; only inner panes do.', 'web')
    expect(p.taps).toEqual([])
    expect(p.reason).toMatch(/not a known view/)
    expect(navPlan(undefined, 'web').reason).toMatch(/no context/)
  })
})

describe('navNote', () => {
  it('names the way when a navigation tap is missing on this build', () => {
    expect(navNote(navPlan('map', 'chat'))).toBe('navigate to Web > Map first')
    expect(navNote(navPlan('panel', 'chat'))).toBe('')
  })
})

describe('readFlag', () => {
  const storage = (o) => ({ getItem: (k) => (k in o ? o[k] : null) })
  it('is on from the query or from storage, off otherwise', () => {
    expect(readFlag('five_rings', '?five_rings=1', storage({}))).toBe(true)
    expect(readFlag('five_rings', '', storage({ 'twp-flag-five_rings': '1' }))).toBe(true)
    expect(readFlag('five_rings', '?five_rings=0', storage({}))).toBe(false)
    expect(readFlag('five_rings', '?other=1', storage({ 'twp-flag-other': '1' }))).toBe(false)
    expect(readFlag('five_rings', '', null)).toBe(false)
  })
  it('survives a storage that throws', () => {
    expect(readFlag('x', '', { getItem: () => { throw new Error('blocked') } })).toBe(false)
  })
})

describe('flagSteps', () => {
  const sw = 'tap Try Five rings @ [data-flag-switch="five_rings"]'
  it('a flagged row with the flag off starts with the panel switch (once); others stay as they are', () => {
    expect(flagSteps({ title: 'Five rings', flag: 'five_rings', steps: ['a @ b'] }, false)).toEqual([sw, 'a @ b'])
    expect(flagSteps({ title: 'Five rings', flag: 'five_rings', steps: [sw, 'a @ b'] }, false)).toEqual([sw, 'a @ b'])
    expect(flagSteps({ title: 'X', steps: ['a @ b'] }, false)).toEqual(['a @ b'])
  })
  it('with the flag on, the switch step is done already', () => {
    expect(flagSteps({ title: 'Five rings', flag: 'five_rings', steps: [sw, 'a @ b'] }, true)).toEqual(['a @ b'])
  })
})
