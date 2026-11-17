// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-placement: Ask lives in the bottom bar when the preset carries it, else as the overlay pill; never in the header. */
import { askFloating } from '../../src/bottom_bar.ts'
import { HEADER_RIGHT, headerRight } from '../../src/header_controls.ts'
import { readFileSync } from 'node:fs'

describe('steer_ask_placement', () => {
  it('shows the overlay pill when the bar has no Ask item', () => {
    expect(askFloating(['web', 'chat', 'feed', 'events', 'inventory'])).toBe(true)
  })
  it('hides the pill when the bar carries the Ask item', () => {
    expect(askFloating(['web', 'chat', 'ask', 'events', 'inventory'])).toBe(false)
  })
  it('keeps the pill on Web, Chat and Resources only; the header sparkle is back (steer-ask-placement-2)', () => {
    const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
    const fn = src.slice(src.indexOf('function mountAskButton'), src.indexOf('function inboxButton'))
    for (const s of ['Screen.Web', 'Screen.Chat', 'Screen.Inventory']) expect(fn).toContain(s)
    expect(src).toContain('mountAiButton()')
    expect([...HEADER_RIGHT]).toEqual(['views', 'search', 'qr', 'settings', 'ai']) // wave44c header-cluster
    expect(headerRight('web', true)).toContain('ai')
  })
  it('opens the community event editor directly, with no assistant gate', () => {
    const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
    const at = src.indexOf("twBus.on('new-event'")
    const handler = src.slice(at, src.indexOf("twBus.on('open-chat'", at))
    expect(handler).not.toContain('assistantNeeded')
    expect(handler).not.toContain('isEnabled')
    expect(handler).toContain('eventsView.openForm(undefined, tag)')
  })
})
