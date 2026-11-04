// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 30 (person-share-link): the WhatsApp deep link with a prefilled text, and the one link per person. */
import { waLink } from '../../src/channel.ts'
import { ITEMS_MAX, ITEM_MAX, parsePersonShare, personShareLink } from '../../src/person_share_link.ts'
import { Channel } from '../../src/model.ts'

const APP = 'https://app.trustweb.one/'
const CONNECT = `${APP}?connect=abc123`
const MINE = { [Channel.Signal]: 'https://signal.me/#eu/abcDEF123_-xyz', [Channel.WhatsApp]: '+436609999999' }
const TICKS = { shareOnConnect: { [Channel.Signal]: true } }

describe('waLink', () => {
  it('cleans the number to digits and encodes the text', () => {
    expect(waLink('+43 660 123 4567', 'Hi Anna & Ben?')).toBe('https://wa.me/436601234567?text=Hi%20Anna%20%26%20Ben%3F')
  })
  it('no text, or only blanks: the plain chat link', () => {
    expect(waLink('+436601234567')).toBe('https://wa.me/436601234567')
    expect(waLink('+436601234567', '  ')).toBe('https://wa.me/436601234567')
  })
  it('a share-QR link carries no number: it stays as it is, no text appended', () => {
    expect(waLink('https://wa.me/qr/ABCDEFGH12345', 'Hi')).toBe('https://wa.me/qr/ABCDEFGH12345')
  })
})

describe('personShareLink', () => {
  it('carries the connect link, the ticked contact and the zone items; no unticked channel', () => {
    const url = personShareLink(CONNECT, MINE, TICKS, ['Ladder', 'Bike'])
    expect(url.startsWith(`${CONNECT}#`)).toBe(true)
    expect(url).not.toContain('436609999999')
    const got = parsePersonShare(new URL(url).hash)
    expect(got.contact.channels[Channel.Signal]).toBe(MINE[Channel.Signal])
    expect(got.contact.channels[Channel.WhatsApp]).toBeUndefined()
    expect(got.items).toEqual(['Ladder', 'Bike'])
  })
  it('keeps a fragment the connect link already has', () => {
    const url = personShareLink(`${CONNECT}#via=SIGNAL`, MINE, TICKS, ['Ladder'])
    expect(new URLSearchParams(new URL(url).hash.slice(1)).get('via')).toBe('SIGNAL')
    expect(parsePersonShare(new URL(url).hash).items).toEqual(['Ladder'])
  })
  it('nothing ticked and nothing shared: the connect link unchanged', () => {
    expect(personShareLink(CONNECT, MINE, undefined, [])).toBe(CONNECT)
  })
  it('bounds the items', () => {
    const many = Array.from({ length: ITEMS_MAX + 4 }, (_, i) => `item ${i}`)
    expect(parsePersonShare(new URL(personShareLink(CONNECT, MINE, TICKS, many)).hash).items).toHaveLength(ITEMS_MAX)
    const long = parsePersonShare(new URL(personShareLink(CONNECT, MINE, TICKS, ['x'.repeat(ITEM_MAX + 50)])).hash)
    expect(long.items[0]).toHaveLength(ITEM_MAX)
  })
})

describe('parsePersonShare (untrusted input)', () => {
  it('a plain connect fragment, or garbage, is no person share', () => {
    expect(parsePersonShare('')).toBeNull()
    expect(parsePersonShare('#via=SIGNAL')).toBeNull()
    expect(parsePersonShare('#si=')).toBeNull()
  })
  it('strips hidden characters, drops empty items, bounds the count', () => {
    const hash = '#si=a%E2%80%AEb&si=%20&' + Array.from({ length: 20 }, (_, i) => `si=i${i}`).join('&')
    const got = parsePersonShare(hash)
    expect(got.items[0]).not.toMatch(/\u202e/)
    expect(got.items).toHaveLength(ITEMS_MAX)
    expect(got.contact).toBeNull()
  })
  it('a channel value that is no valid handle is dropped', () => {
    expect(parsePersonShare('#signal=javascript:alert(1)&si=x').contact).toBeNull()
  })
})

describe('contact and items together', () => {
  it('the contact survives a full set of long items', () => {
    const items = Array.from({ length: ITEMS_MAX }, (_, i) => `${i} ${'y'.repeat(ITEM_MAX)}`)
    const got = parsePersonShare(new URL(personShareLink(CONNECT, MINE, TICKS, items)).hash)
    expect(got.contact.channels[Channel.Signal]).toBe(MINE[Channel.Signal])
    expect(got.items).toHaveLength(ITEMS_MAX)
  })
})
