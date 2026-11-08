// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 35 views-pin-default: the pinned default view of Web, its tab label, advanced mode; pure. */
import { isAdvanced, setWebDefault, webDefaultOf, webTabLabel } from '../../src/web_default_view.ts'

const names = { rings: 'Web', network: 'Network', map: 'Map', people: 'People' }

describe('web_default_view', () => {
  it('without a pin the Web tab keeps "Web" and the rings', () => {
    expect(webDefaultOf({})).toBe('rings')
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
  it('setWebDefault stores a view and drops the pin for the rings', () => {
    expect(setWebDefault(undefined, 'network')).toEqual({ webDefault: 'network' })
    expect(setWebDefault({ webDefault: 'network' }, 'rings')).toBeUndefined()
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
