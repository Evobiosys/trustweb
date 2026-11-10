// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { Tab, headerTarget } from '../../src/nav'
import { TabbarMode } from '../../src/tabbar'

describe('headerTarget (wave 39: the timeline icon toggles)', () => {
  it('opens the timeline from anywhere', () => {
    for (const mode of [TabbarMode.Always, TabbarMode.Hover, TabbarMode.Hidden]) expect(headerTarget(Tab.Timeline, Tab.People, mode)).toBe(Tab.Timeline)
  })
  it('a second press closes it back to People in every tab-bar mode', () => {
    for (const mode of [TabbarMode.Always, TabbarMode.Hover, TabbarMode.Hidden]) expect(headerTarget(Tab.Timeline, Tab.Timeline, mode)).toBe(Tab.People)
  })
  it('the gear keeps its rule: it only toggles while the tab bar is hidden', () => {
    expect(headerTarget(Tab.Settings, Tab.Settings, TabbarMode.Hidden)).toBe(Tab.People)
    expect(headerTarget(Tab.Settings, Tab.Settings, TabbarMode.Always)).toBe(Tab.Settings)
    expect(headerTarget(Tab.Settings, Tab.People, TabbarMode.Hidden)).toBe(Tab.Settings)
  })
})
