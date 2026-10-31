// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Web screen view chooser (wave 25): Membranes, Network; the expand flag shows everyone. No Desk. */
import { viewMenuItems, viewHeading, webViewOf, expandedOf } from '../../src/view_menu.ts'

describe('view_menu', () => {
  it('lists Membranes and Network with the current one ticked', () => {
    expect(viewMenuItems('rings', true)).toEqual([{ view: 'rings', on: true }, { view: 'network', on: false }])
    expect(viewMenuItems('network', true)[1].on).toBe(true)
  })
  it('offers no Network while nobody is in the web', () => {
    expect(viewMenuItems('rings', false).map((i) => i.view)).toEqual(['rings'])
  })
  it('never lists a desk', () => {
    expect(viewMenuItems('rings', true).map((i) => i.view)).not.toContain('desk')
  })
  it('names the view as heading only when it is not Membranes', () => {
    expect(viewHeading('rings')).toBeNull()
    expect(viewHeading('network')).toBe('network')
  })
  it('reads the stored choice; anything else, or nobody in the web, is Membranes', () => {
    expect(webViewOf('network', true)).toBe('network')
    expect(webViewOf('complete', true)).toBe('rings')
    expect(webViewOf('network', false)).toBe('rings')
    expect(webViewOf('desk', true)).toBe('rings')
    expect(webViewOf(null, true)).toBe('rings')
  })
  it('expand is on only for the stored flag "1", and only on Membranes', () => {
    expect(expandedOf('1', 'rings')).toBe(true)
    expect(expandedOf('1', 'network')).toBe(false)
    expect(expandedOf(null, 'rings')).toBe(false)
    expect(expandedOf('0', 'rings')).toBe(false)
  })
})
