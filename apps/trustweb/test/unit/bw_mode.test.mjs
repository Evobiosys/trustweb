// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// bw_mode.ts (wave 44 steer-strike-mode): the line through OFF toggles shows only in Black and white mode.
import { strikeOff, setBwMode, migrateBwMode } from '../../src/bw_mode.ts'
import { migrate } from '../../src/schema_version.ts'
import { SETTINGS_REGISTRY } from '../../src/settings_registry.ts'
import { readFileSync } from 'node:fs'

describe('strikeOff', () => {
  it('is false by default and true only when bwMode is on', () => {
    expect(strikeOff({})).toBe(false)
    expect(strikeOff(undefined)).toBe(false)
    expect(strikeOff({ bwMode: true })).toBe(true)
    expect(strikeOff({ bwMode: false })).toBe(false)
  })
})

describe('setBwMode', () => {
  it('stores only the on state', () => {
    const s = {}
    setBwMode(s, true); expect(s.bwMode).toBe(true)
    setBwMode(s, false); expect('bwMode' in s).toBe(false)
  })
})

describe('migrateBwMode', () => {
  it('maps the event-visibility key strikeSwitchedOff onto bwMode, once', () => {
    const s = { strikeSwitchedOff: true }
    expect(migrateBwMode(s)).toBe(true)
    expect(s).toEqual({ bwMode: true })
    expect(migrateBwMode(s)).toBe(false)
  })
  it('drops a false old key and never turns bwMode off', () => {
    const a = { strikeSwitchedOff: false }
    expect(migrateBwMode(a)).toBe(true); expect(a).toEqual({})
    const b = { bwMode: true, strikeSwitchedOff: false }
    migrateBwMode(b); expect(b).toEqual({ bwMode: true })
  })
  it('runs inside migrate()', () => {
    const s = { v: 1, me: { id: 'me', displayName: 'J' }, peers: [], log: [], people: [], inventory: [], meetings: [], strikeSwitchedOff: true }
    migrate(s)
    expect(s.bwMode).toBe(true); expect('strikeSwitchedOff' in s).toBe(false)
  })
})

describe('settings registry', () => {
  it('has variations.bw, default off, reachable by settings_set', () => {
    const d = SETTINGS_REGISTRY.find((x) => x.id === 'variations.bw')
    expect(d?.default).toBe(false)
    const r = {}
    d.set(r, true); expect(d.get(r)).toBe(true)
    d.set(r, false); expect(r).toEqual({})
  })
})

describe('css', () => {
  const css = readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8')
  it('plain .tw-off dims without a line; the line needs html.tw-bw', () => {
    expect(css).toMatch(/\.tw-off\{opacity:\.55\}/)
    expect(css).not.toMatch(/(^|\n)\.tw-off\{[^}]*line-through/)
    expect(css).toMatch(/html\.tw-bw \.tw-off\{text-decoration:line-through\}/)
  })
})
