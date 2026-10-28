// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Web screen view chooser (wave 24): Membranes, Network, Desk. */
import { viewMenuItems, viewHeading } from '../../src/view_menu.ts'

describe('view_menu', () => {
  it('lists Membranes, Network, Desk with the current one ticked', () => {
    expect(viewMenuItems('rings', true)).toEqual([{ view: 'rings', on: true }, { view: 'network', on: false }, { view: 'desk', on: false }])
    expect(viewMenuItems('network', true)[1].on).toBe(true)
  })
  it('offers no Network while nobody is in the web', () => {
    expect(viewMenuItems('rings', false).map((i) => i.view)).toEqual(['rings', 'desk'])
  })
  it('names the view as heading only when it is not Membranes', () => {
    expect(viewHeading('rings')).toBeNull()
    expect(viewHeading('network')).toBe('network')
  })
})
