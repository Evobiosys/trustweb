// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 views-header: the header controls per screen (left to right), the pins beneath Settings, and what the QR button shows. */
import { headerControls, headerPins, togglePinned, qrTarget, advancedKeyOf } from '../../src/header_controls.ts'

describe('header_controls', () => {
  it('orders search, views, pins, QR, settings left to right on web, chat, events and inventory', () => {
    for (const s of ['web', 'chat', 'events', 'inventory']) expect(headerControls(s)).toEqual(['search', 'views', 'pins', 'qr', 'settings'])
  })
  it('leaves Record and every other screen to its own header', () => {
    for (const s of ['record', 'meeting', 'meet', 'start', 'review', 'people']) expect(headerControls(s)).toBeUndefined()
  })
  it('pins Do Not Disturb by default, and an explicit list replaces the default', () => {
    expect(headerPins(undefined)).toEqual(['dnd'])
    expect(headerPins([])).toEqual([])
    expect(headerPins(['advanced', 'bogus'])).toEqual(['advanced'])
  })
  it('toggles a pin from the default and back', () => {
    expect(togglePinned(undefined, 'dnd')).toEqual([])
    expect(togglePinned(undefined, 'advanced')).toEqual(['dnd', 'advanced'])
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
})
