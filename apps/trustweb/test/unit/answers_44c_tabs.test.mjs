// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c answers-44c item 2 (Jakob 20:22): Community bar = Home (tile board) then Web (rings); Personal bar = Web (rings), Home opt-in. */
import { readFileSync } from 'node:fs'
import { webDefaultOf, webTabLabel, webTabTarget } from '../../src/web_default_view.ts'
import { readSetting, writeSetting } from '../../src/settings_registry.ts'
import { communityLead } from '../../src/ext/community_mode/mode.ts'
import { S } from '../../src/strings.ts'

describe('answers-44c tabs: personal bar', () => {
  it('a record without a pin opens the rings again; Home only when chosen', () => {
    expect(webDefaultOf({})).toBe('rings')
    expect(webDefaultOf({ uiViews: {} })).toBe('rings')
    expect(webDefaultOf({ uiViews: { webDefault: 'home' } })).toBe('home')
  })
  it('the first tab reads "Web" and opens the web', () => {
    expect(webTabLabel({}, { rings: 'Web', home: 'Home' })).toBe('Web')
    expect(webTabTarget({}, false)).toBe('rings')
  })
  it('Settings > Home "Open Home first": off by default, opt-in stores home, off again = rings', () => {
    const r = {}
    expect(readSetting(r, 'home.start')).toBe(false)
    writeSetting(r, 'home.start', true)
    expect(r.uiViews.webDefault).toBe('home')
    expect(webTabTarget(r, false)).toBe('home')
    writeSetting(r, 'home.start', false)
    expect(readSetting(r, 'home.start')).toBe(false)
    expect(webDefaultOf(r)).toBe('rings')
    const p = { uiViews: { webDefault: 'network' } }
    writeSetting(p, 'home.start', false)
    expect(p.uiViews.webDefault).toBe('network')
  })
})

describe('answers-44c tabs: community bar', () => {
  it('first tab is named Home, the tab next to it Web', () => {
    expect(S.community.nav.home).toBe('Home')
    expect(communityLead(['chat', 'web', 'events'], 'community:home').slice(0, 2)).toEqual(['community:home', 'web'])
  })
  it('the Web tab in the community view always opens the web (rings), even with Home pinned', () => {
    expect(webTabTarget({ uiViews: { webDefault: 'home' } }, true)).toBe('rings')
    expect(webTabTarget({}, true)).toBe('rings')
  })
  it('main.ts routes the Web tab through webTabTarget with the community interface', () => {
    const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
    expect(src).toContain("webTabTarget(state, modeShell.now() === 'community')")
  })
})
