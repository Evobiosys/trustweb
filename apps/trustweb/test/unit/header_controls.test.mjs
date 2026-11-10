// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 views-header: the header controls per screen (left to right), the pins beneath Settings, and what the QR button shows. */
import { showsSettingsGear, headerControls, headerPins, togglePinned, qrTarget, advancedKeyOf } from '../../src/header_controls.ts'

describe('header_controls', () => {
  it('orders search, views, pins, QR, settings left to right on web, events and inventory', () => {
    for (const s of ['web', 'events', 'inventory']) expect(headerControls(s)).toEqual(['search', 'views', 'pins', 'qr', 'settings'])
  })
  it('gives People the same search as every first-level screen (wave 30)', () => {
    expect(headerControls('people')).toEqual(['search', 'views', 'pins', 'qr', 'settings'])
  })
  it('puts search first, then views or the chat switch, then QR, then settings on every first-level screen', () => {
    for (const s of ['web', 'chat', 'people', 'events', 'inventory']) {
      const c = headerControls(s)
      const at = (k) => c.indexOf(k)
      expect(at('search')).toBe(0)
      expect(at('views') > -1 || at('switch') > -1).toBe(true)
      expect(Math.max(at('views'), at('switch'))).toBeLessThan(at('qr'))
      expect(at('qr')).toBeLessThan(at('settings'))
    }
  })
  it('gives Chat no views (expand) button but the messenger switch', () => {
    expect(headerControls('chat')).toEqual(['search', 'switch', 'pins', 'qr', 'settings'])
  })
  it('leaves Record and every other screen to its own header', () => {
    for (const s of ['record', 'meeting', 'meet', 'start', 'review']) expect(headerControls(s)).toBeUndefined()
  })
  it('pins nothing by default (Do Not Disturb lives in Settings > Chat; the select tool is a Tools row again since wave 40), and an explicit list is kept', () => {
    expect(headerPins(undefined)).toEqual([])
    expect(headerPins(['select', 'dnd'])).toEqual(['dnd'])
    expect(headerPins(['dnd'])).toEqual(['dnd'])
    expect(headerPins([])).toEqual([])
    expect(headerPins(['advanced', 'bogus'])).toEqual(['advanced'])
  })
  it('toggles a pin from the default and back', () => {
    expect(togglePinned(undefined, 'dnd')).toEqual(['dnd'])
    expect(togglePinned(undefined, 'advanced')).toEqual(['advanced'])
    expect(togglePinned(['qr-only'], 'qr-only')).toEqual([])
  })
  it('QR shows the open event, then the tag filter, else the connect code', () => {
    expect(qrTarget({ eventOpen: true, tag: 'x' })).toBe('event')
    expect(qrTarget({ eventOpen: false, tag: 'x' })).toBe('tag')
    expect(qrTarget({ eventOpen: false })).toBe('web-root')
  })
  it('names the Advanced section of each settings group', () => {
    expect(advancedKeyOf('web')).toBe('advanced-web')
    expect(advancedKeyOf('inventory')).toBe('advanced-inventory')
    expect(advancedKeyOf('record')).toBe('advanced-record')
    expect(advancedKeyOf('chat')).toBe('advanced')
    expect(advancedKeyOf(undefined)).toBe('advanced')
  })
})

import { disclosureGlyph } from '../../src/disclosure.ts'
describe('disclosure', () => {
  it('points right when collapsed and down when expanded', () => {
    expect(disclosureGlyph(false)).toBe('▸')
    expect(disclosureGlyph(true)).toBe('▾')
  })
  it('every screen but Start carries the settings gear, Meet included', () => {
    for (const s of ['web', 'chat', 'people', 'events', 'inventory', 'record', 'meeting', 'meet', 'review', 'place', 'notes', 'feed']) expect(showsSettingsGear(s)).toBe(true)
    expect(showsSettingsGear('start')).toBe(false)
  })
})
