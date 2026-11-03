// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** E3 name reveal per event (events.ts): what an event link may say about me; the setting itself never travels. */
import { DEFAULT_NAME_REVEAL, NAME_REVEALS, firstName, localSettings, nameRevealOf, newEvent, revealedBy } from '../../src/events.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'

const NOW = new Date('2026-10-15T12:00').getTime()
const ORIGIN = 'https://app.example.org'
const ev = (over = {}) => ({ ...newEvent({ name: 'Probe Forum', from: '2026-10-12', where: 'Probe Town' }, 'e1', NOW), ...over })
const BY = { name: 'Ada Probe', did: 'did:key:z6MkProbe' }
const payload = (link) => JSON.parse(Buffer.from(link.split(/#ev(?:_host)?=/)[1].split('&')[0], 'base64url').toString())

describe('the choices', () => {
  it('full, first, hidden; full by default (today\'s behaviour)', () => {
    expect(NAME_REVEALS).toEqual(['full', 'first', 'hidden'])
    expect(DEFAULT_NAME_REVEAL).toBe('full')
    expect(nameRevealOf(ev())).toBe('full')
    expect(nameRevealOf(ev({ nameReveal: 'first' }))).toBe('first')
    expect(nameRevealOf(ev({ nameReveal: 'bogus' }))).toBe('full')
  })
  it('firstName is the first whitespace-separated word, trimmed', () => {
    expect(firstName('  Ada   Probe ')).toBe('Ada')
    expect(firstName('Ada')).toBe('Ada')
    expect(firstName('   ')).toBe('')
  })
})

describe('revealedBy', () => {
  it('default gives `by` unchanged; first gives the first word without the did; hidden gives nothing', () => {
    expect(revealedBy(BY, ev())).toEqual(BY)
    expect(revealedBy(BY, ev({ nameReveal: 'full' }))).toEqual(BY)
    expect(revealedBy(BY, ev({ nameReveal: 'first' }))).toEqual({ name: 'Ada' })
    expect(revealedBy(BY, { nameReveal: 'hidden' })).toBeUndefined()
    expect(revealedBy(undefined, ev())).toBeUndefined()
  })
  it('a hidden link carries no by at all; a first-name link only the first name', () => {
    const hidden = ev({ nameReveal: 'hidden' })
    expect(payload(encodeEventLink(hidden, ORIGIN, 'peer', revealedBy(BY, hidden))).by).toBeUndefined()
    const first = ev({ nameReveal: 'first' })
    const got = decodeEventLink(encodeEventLink(first, ORIGIN, 'peer', revealedBy(BY, first)).slice(ORIGIN.length + 1))
    expect(got.by).toEqual({ name: 'Ada' })
  })
})

describe('the setting stays on this device', () => {
  it('encodeEventLink never carries nameReveal, for either link kind', () => {
    for (const kind of ['peer', 'host']) {
      const p = payload(encodeEventLink(ev({ nameReveal: 'hidden' }), ORIGIN, kind, BY))
      expect('nameReveal' in p).toBe(false)
    }
  })
  it('localSettings keeps it across an edit of the form', () => {
    expect(localSettings(ev({ nameReveal: 'first' }))).toEqual({ nameReveal: 'first' })
    expect(localSettings(ev())).toEqual({})
  })
})
