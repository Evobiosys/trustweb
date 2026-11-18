// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 header-layout: the top right is one fixed set on every screen; the screen's own tools sit in their own row. */
import { HEADER_RIGHT, HEADER_LEFT, headerRight } from '../../src/header_controls.ts'

const SCREENS = ['web', 'chat', 'people', 'events', 'inventory', 'feed', 'timeline', 'ask', 'notes', 'groups', 'ext']

describe('header_layout', () => {
  it('puts the logo leftmost, then the title, then the inbox and the bell (Jakob steering 2)', () => {
    expect([...HEADER_LEFT]).toEqual(['logo', 'title', 'inbox', 'bell'])
  })
  // wave44c header-cluster superseded the fixed QR/settings/AI set and the tools row: see header_cluster.test.mjs
  it('still ends the right cluster with QR, settings, then the AI sparkle on every screen', () => {
    for (const s of SCREENS) expect(headerRight(s, true).slice(-3), s).toEqual(['qr', 'settings', 'ai'])
    expect([...HEADER_RIGHT].slice(-3)).toEqual(['qr', 'settings', 'ai'])
  })
})
