// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 35 views-pin-default: the pinned default view of Web, its tab label, advanced mode; pure. */
import { CONTACTS_TAB_LABEL, isAdvanced, setWebDefault, shownAtOnce, webDefaultOf, webTabLabel } from '../../src/web_default_view.ts'

const names = { rings: 'Web', network: 'Network', map: 'Map', people: 'People' }

describe('web_default_view', () => {
  it('without a pin the Web tab keeps "Web" and opens Home (wave44c)', () => {
    expect(webDefaultOf({})).toBe('home')
    expect(webTabLabel({}, names)).toBe('Web')
  })
  it('a pinned view names the tab', () => {
    expect(webTabLabel({ uiViews: { webDefault: 'network' } }, names)).toBe('Network')
    expect(webTabLabel({ uiViews: { webDefault: 'map' } }, names)).toBe('Map')
  })
  it('pinning the rings, or an unknown view, reads as "Web"', () => {
    expect(webTabLabel({ uiViews: { webDefault: 'rings' } }, names)).toBe('Web')
    expect(webTabLabel({ uiViews: { webDefault: 'zzz' } }, names)).toBe('Web')
  })
  it('setWebDefault stores a view, the rings too (wave44c: absent = Home)', () => {
    expect(setWebDefault(undefined, 'network')).toEqual({ webDefault: 'network' })
    expect(setWebDefault({ webDefault: 'network' }, 'rings')).toEqual({ webDefault: 'rings' })
  })
  it('the complete view can be the default of Web and names the tab', () => {
    expect(setWebDefault(undefined, 'complete')).toEqual({ webDefault: 'complete' })
    expect(webDefaultOf({ uiViews: { webDefault: 'complete' } })).toBe('complete')
    expect(webTabLabel({ uiViews: { webDefault: 'complete' } }, { ...names, complete: 'Table' })).toBe('Table')
  })
  it('advanced mode = the Advanced pin is on', () => {
    expect(isAdvanced({})).toBe(false)
    expect(isAdvanced({ uiPins: { views: [], header: ['advanced'] } })).toBe(true)
    expect(isAdvanced({ uiPins: { views: ['advanced'] } })).toBe(true)
    expect(isAdvanced({ uiPins: { views: [], header: ['dnd'] } })).toBe(false)
  })
})

describe('wave43c chat-notices: Contacts wording and the pin', () => {
  it('the Web tab keeps "Web" unless the switch hands in the Contacts word; a pinned view still names the tab', () => {
    expect(CONTACTS_TAB_LABEL).toBe(false)
    expect(webTabLabel({}, names, CONTACTS_TAB_LABEL ? 'Contacts' : undefined)).toBe('Web')
    expect(webTabLabel({}, names, 'Contacts')).toBe('Contacts')
    expect(webTabLabel({ uiViews: { webDefault: 'network' } }, names, 'Contacts')).toBe('Network')
  })
  it('pinning a remembered view (rings, network, map) shows it at once; pages (people, dex) wait for the next tap', () => {
    for (const v of ['rings', 'network', 'map']) expect(shownAtOnce(v)).toBe(true)
    for (const v of ['people', 'complete', 'dex', 'compact', 'groups', 'circles']) expect(shownAtOnce(v)).toBe(false)
  })
  it('Settings texts call the Web view Contacts', async () => {
    const { S } = await import('../../src/strings.ts')
    for (const t of [S.viewPinDefault, S.viewPinned, S.webDefaultLabel, S.setDefaultRecordingNote, S.setMembraneLimitHint(5), S.agentConnected('now')]) expect(t).toContain('Contacts')
    expect(S.barNames.web).toBe('Web')
  })
})

// review-fixes-43c (Jakob Ω): the Settings select "Default view of Contacts" shows the chosen view on the Web screen at once, like the eye-menu pin.
import { webViewAfterDefault } from '../../src/web_default_view.ts'
describe('webViewAfterDefault', () => {
  it('rings, network and map become the remembered Web view at once; page views open on the next tap (null)', () => {
    expect(webViewAfterDefault('network')).toBe('network')
    expect(webViewAfterDefault('map')).toBe('map')
    expect(webViewAfterDefault('rings')).toBe('rings')
    expect(webViewAfterDefault('people')).toBe(null)
    expect(webViewAfterDefault('groups')).toBe(null)
  })
})
