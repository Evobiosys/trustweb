// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Web screen view chooser (wave 25): Membranes, Network, Complete network. No Desk. */
import { viewMenuItems, viewHeading, webViewOf } from '../../src/view_menu.ts'

describe('view_menu', () => {
  it('lists Membranes, Network, Complete network with the current one ticked', () => {
    expect(viewMenuItems('rings', true)).toEqual([{ view: 'rings', on: true }, { view: 'network', on: false }, { view: 'complete', on: false }])
    expect(viewMenuItems('network', true)[1].on).toBe(true)
    expect(viewMenuItems('complete', true)[2].on).toBe(true)
  })
  it('offers neither Network nor Complete network while nobody is in the web', () => {
    expect(viewMenuItems('rings', false).map((i) => i.view)).toEqual(['rings'])
  })
  it('never lists a desk', () => {
    expect(viewMenuItems('rings', true).map((i) => i.view)).not.toContain('desk')
  })
  it('names the view as heading only when it is not Membranes', () => {
    expect(viewHeading('rings')).toBeNull()
    expect(viewHeading('network')).toBe('network')
    expect(viewHeading('complete')).toBe('complete')
  })
  it('reads the stored choice; anything else, or nobody in the web, is Membranes', () => {
    expect(webViewOf('network', true)).toBe('network')
    expect(webViewOf('complete', true)).toBe('complete')
    expect(webViewOf('complete', false)).toBe('rings')
    expect(webViewOf('desk', true)).toBe('rings')
    expect(webViewOf(null, true)).toBe('rings')
  })
})
