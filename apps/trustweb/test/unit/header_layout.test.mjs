// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 header-layout: the top right is one fixed set on every screen; the screen's own tools sit in their own row. */
import { HEADER_RIGHT, headerRight, headerTools, headerControls } from '../../src/header_controls.ts'

const SCREENS = ['web', 'chat', 'people', 'events', 'inventory', 'feed', 'timeline', 'ask', 'notes', 'groups', 'ext']

describe('header_layout', () => {
  it('names the fixed right-hand set once: QR, settings; no Ask/AI control (steer-ask-placement)', () => {
    expect([...HEADER_RIGHT]).toEqual(['qr', 'settings'])
    expect(HEADER_RIGHT.some((c) => /ask|ai|query|sparkle/.test(c))).toBe(false)
  })
  it('renders exactly that set, in that order, on every screen', () => {
    for (const s of SCREENS) expect(headerRight(), s).toEqual(['qr', 'settings'])
  })
  it('keeps search, views, the chat switch and the pins out of the right set', () => {
    for (const s of SCREENS) for (const c of headerTools(s)) expect(HEADER_RIGHT.includes(c), `${s}:${c}`).toBe(false)
    expect(headerTools('web')).toEqual(['search', 'views', 'pins'])
    expect(headerTools('chat')).toEqual(['search', 'switch', 'pins'])
  })
  it('gives screens without own controls no tools row', () => {
    for (const s of ['feed', 'ask', 'timeline']) expect(headerTools(s)).toEqual([])
  })
  it('stays consistent with the wave 28 order: tools, then QR, then settings', () => {
    for (const s of ['web', 'chat', 'people', 'events', 'inventory']) expect([...headerTools(s), 'qr', 'settings']).toEqual(headerControls(s))
  })
})
