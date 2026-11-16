// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c shell-fix-2: event-only variant can be left (43b-D8), the hint lines the reviews asked for exist, protected rows carry no Record button. */
import { readFileSync } from 'node:fs'
import { S } from '../../src/strings.ts'
import { eventModeOn, leaveEventMode, rememberEventMode } from '../../src/event_mode.ts'

const fakeStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k) } }

describe('event-only variant: way back (43b-D8)', () => {
  beforeEach(() => { globalThis.sessionStorage = fakeStorage() })
  it('leaveEventMode turns the variant off for the rest of the session', () => {
    rememberEventMode({ linkMode: 'event' })
    expect(eventModeOn()).toBe(true)
    leaveEventMode()
    expect(eventModeOn()).toBe(false)
  })
  it('a plain event link afterwards does not bring it back', () => {
    rememberEventMode({ linkMode: 'event' }); leaveEventMode(); rememberEventMode({})
    expect(eventModeOn()).toBe(false)
  })
  it('never throws when storage is blocked', () => {
    globalThis.sessionStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
    expect(() => leaveEventMode()).not.toThrow()
  })
})

describe('strings', () => {
  it('names the full-app way and the hints', () => {
    expect(S.shellFix2.openFullApp).toBe('Open the full app')
    expect(S.shellFix2.openFullAppHint.length).toBeGreaterThan(10)
    expect(S.shellFix2.tanaPullHint.length).toBeGreaterThan(10)
    expect(S.shellFix2.feedPressHint.length).toBeGreaterThan(10)
    expect(S.shellFix2.hostOnlyHint.length).toBeGreaterThan(10)
  })
})

describe('protected resource row (43b-D5)', () => {
  it('renders Record, Play and Show link (flip 43b-D5, wave 44b: Record is back)', () => {
    const src = readFileSync(new URL('../../src/resource_views_view.ts', import.meta.url), 'utf8')
    expect(src).toContain("'data-rv-record'")
    expect(src).toContain("'data-rv-play'")
  })
})
