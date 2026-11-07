// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 card-connected-icons: the places a person is connected with me, from the fields a card already holds. */
import { connectedPlaces } from '../../src/connected_places.ts'
import { EMAIL_FIELD } from '../../src/intending_reminder.ts'

const ids = (p) => connectedPlaces(p).map((x) => x.id)

describe('connectedPlaces', () => {
  it('a bare card has no places', () => {
    expect(connectedPlaces({ id: 'a' })).toEqual([])
  })
  it('TrustWeb comes first, with the old line as its tooltip and no link', () => {
    const [tw] = connectedPlaces({ id: 'a', peerId: 'x', channels: { signal: '+436601234567' } })
    expect(tw).toMatchObject({ id: 'trustweb', label: 'Connected on TrustWeb', icon: 'web' })
    expect(tw.href).toBeUndefined()
  })
  it('a WhatsApp and a Signal number give both icons with their deep links, plus Phone', () => {
    const p = { id: 'a', peerId: 'x', channels: { whatsapp: '+436601234567', signal: '+436601234567' } }
    expect(ids(p)).toEqual(['trustweb', 'signal', 'whatsapp', 'phone'])
    const wa = connectedPlaces(p).find((x) => x.id === 'whatsapp')
    expect(wa.href).toBe('https://wa.me/436601234567')
    expect(connectedPlaces(p).find((x) => x.id === 'phone').href).toBe('tel:+436601234567')
  })
  it('a shared (theirs) channel counts, an own value wins', () => {
    expect(ids({ id: 'a', theirChannels: { telegram: 'anna_x1' } })).toEqual(['telegram'])
  })
  it('a WhatsApp import without a number still shows WhatsApp, without a link', () => {
    const p = { id: 'a', sources: [{ source: 'whatsapp', file: 'f', importedAt: 1, key: 'k' }] }
    expect(connectedPlaces(p)).toEqual([expect.objectContaining({ id: 'whatsapp', label: 'WhatsApp' })])
    expect(connectedPlaces(p)[0].href).toBeUndefined()
  })
  it('no duplicate WhatsApp when the number and the import both exist', () => {
    const p = { id: 'a', channels: { whatsapp: '+436601234567' }, sources: [{ source: 'whatsapp', file: 'f', importedAt: 1, key: 'k' }] }
    expect(ids(p).filter((i) => i === 'whatsapp')).toHaveLength(1)
  })
  it('Matrix, Mail (Tana email field) and the Tana / notes sources', () => {
    expect(ids({ id: 'tana-1', channels: { matrix: '@a:example.org' }, fields: { [EMAIL_FIELD]: 'a@example.org' } })).toEqual(['matrix', 'mail', 'tana'])
    expect(connectedPlaces({ id: 'a', fields: { [EMAIL_FIELD]: 'a@example.org' } })[0].href).toBe('mailto:a@example.org')
    expect(ids({ id: 'local-9' })).toEqual(['notes'])
  })
  it('a link typed on the card (no channel number) is a dashed linked-only place that opens the link', () => {
    const p = { id: 'a', links: { signal: 'https://signal.me/#p/+436601234567', other: 'https://example.org/anna' } }
    expect(connectedPlaces(p)).toEqual([
      expect.objectContaining({ id: 'link:signal', linked: true, href: 'https://signal.me/#p/+436601234567', label: 'Signal: linked, not connected on TrustWeb' }),
      expect.objectContaining({ id: 'link:other', linked: true, href: 'https://example.org/anna' }),
    ])
  })
  it('a link whose channel is already a place is not listed twice', () => {
    const p = { id: 'a', channels: { signal: '+436601234567' }, links: { signal: 'https://signal.me/#p/+436601234567' } }
    expect(ids(p)).toEqual(['signal', 'phone'])
    expect(connectedPlaces(p)[0].linked).toBeUndefined()
  })
})
