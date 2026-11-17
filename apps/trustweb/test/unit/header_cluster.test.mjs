// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c header-cluster (Jakob 14:37 δ): no tools row; top right = eye, search, QR, settings (+ai); chat switch and pins follow the title. */
import { readFileSync } from 'node:fs'
import { HEADER_RIGHT, headerAfterTitle, headerControls, headerRight } from '../../src/header_controls.ts'

const SCREENS = ['web', 'chat', 'people', 'events', 'inventory', 'feed', 'timeline', 'ask', 'notes', 'groups', 'ext']

describe('header_cluster', () => {
  it('names the top right once: eye, search, QR, settings, then the AI sparkle', () => {
    expect([...HEADER_RIGHT]).toEqual(['views', 'search', 'qr', 'settings', 'ai'])
  })
  it('keeps that order on every screen; only the screen-less controls drop out', () => {
    for (const s of SCREENS) {
      const got = headerRight(s, true)
      expect(HEADER_RIGHT.filter((c) => got.includes(c)), s).toEqual(got)
      expect(got.slice(-3), s).toEqual(['qr', 'settings', 'ai'])
    }
    expect(headerRight('web', true)).toEqual(['views', 'search', 'qr', 'settings', 'ai'])
    expect(headerRight('events', false)).toEqual(['views', 'search', 'qr', 'settings'])
    expect(headerRight('feed', false)).toEqual(['qr', 'settings'])
  })
  it('puts the chat switch and the pins after the title, never in the right set', () => {
    expect(headerAfterTitle('chat')).toEqual(['switch', 'pins'])
    expect(headerAfterTitle('web')).toEqual(['pins'])
    for (const s of SCREENS) for (const c of headerAfterTitle(s)) expect(HEADER_RIGHT.includes(c), `${s}:${c}`).toBe(false)
    for (const s of ['feed', 'ask', 'timeline']) expect(headerAfterTitle(s)).toEqual([])
  })
  it('keeps every control of headerControls exactly once between the two clusters', () => {
    for (const s of ['web', 'chat', 'people', 'events', 'inventory']) {
      expect([...headerAfterTitle(s), ...headerRight(s, false)].sort(), s).toEqual([...headerControls(s)].sort())
    }
  })
  it('draws no tools row any more', () => {
    const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
    expect(src).not.toContain("class: 'hdr-tools'")
  })
})
