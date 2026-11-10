// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Connect Google behind a flag (src/google_flag.ts): off by default, on by the switch or a configured client id; the dismissible nudge. */
import { dismissNudge, googleConnectOn, googleFlagSet, nudgeShown, setGoogleConnect } from '../../src/google_flag.ts'

const memStore = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), m }
}
const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }

describe('googleConnectOn', () => {
  it('is off by default', () => {
    expect(googleConnectOn(memStore(), null)).toBe(false)
    expect(googleConnectOn(memStore(), '')).toBe(false)
    expect(googleConnectOn(memStore(), '   ')).toBe(false)
  })
  it('is on when the switch is on', () => {
    const s = memStore()
    setGoogleConnect(s, true)
    expect(googleConnectOn(s, null)).toBe(true)
    setGoogleConnect(s, false)
    expect(googleConnectOn(s, null)).toBe(false)
  })
  it('is on when a client id is configured and the switch was never touched; switched off wins (review wave 40)', () => {
    const s = memStore()
    expect(googleConnectOn(s, '123-abc.apps.googleusercontent.com')).toBe(true)
    setGoogleConnect(s, false)
    expect(googleConnectOn(s, '123-abc.apps.googleusercontent.com')).toBe(false)
    expect(googleFlagSet(s)).toBe(false)
  })
  it('is off when storage is blocked', () => {
    expect(googleConnectOn(throwing, null)).toBe(false)
    expect(() => setGoogleConnect(throwing, true)).not.toThrow()
  })
})

describe('the nudge', () => {
  it('shows only while connected and not dismissed', () => {
    const s = memStore()
    expect(nudgeShown(s, null)).toBe(false)
    expect(nudgeShown(s, 'tok')).toBe(true)
    dismissNudge(s)
    expect(nudgeShown(s, 'tok')).toBe(false)
  })
  it('stays dismissed after a reconnect', () => {
    const s = memStore()
    dismissNudge(s)
    expect(nudgeShown(s, 'another-token')).toBe(false)
  })
  it('shows again nowhere it cannot be remembered, but never throws', () => {
    expect(() => dismissNudge(throwing)).not.toThrow()
    expect(nudgeShown(throwing, 'tok')).toBe(true)
  })
})
