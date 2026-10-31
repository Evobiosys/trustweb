// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** QR modes (src/qr_modes.ts, wave 27): mode() per context, payload round trip, old-code compatibility. Fake data only. */
import { decodeModeLink, mode, parseIntroducePermission } from '../../src/qr_modes.ts'
import { decodeEventLink } from '../../src/event_link.ts'

const LINK = 'https://app.trustweb.one/?connect=did%3Apeer%3Aabc&id=p1&name=Ada'
const SHORT = 'https://app.trustweb.one/c/AbCdEfGhIjKlMnOpQrStUv'
const EVENT = 'https://app.trustweb.one/#ev=eyJhIjoxfQ&srv=0123456789abcdef'

describe('mode() per context', () => {
  it('web-root: my connect code as it is, no options', () => {
    const m = mode({ kind: 'web-root', link: LINK })
    expect(m.payload).toBe(LINK)
    expect(m.options).toEqual([])
  })

  it('person: connect code, username option only when a username is known', () => {
    expect(mode({ kind: 'person', link: LINK, name: 'Kaja' }).options).toEqual([])
    const m = mode({ kind: 'person', link: LINK, name: 'Kaja', username: 'kaja' })
    expect(m.options.map((o) => o.id)).toEqual(['username'])
    expect(m.payload).toBe(LINK) // off by default
  })

  it('person: a username toggled on travels in the payload', () => {
    const m = mode({ kind: 'person', link: LINK, name: 'Kaja', username: 'kaja' }, ['username'])
    expect(decodeModeLink(m.payload)).toEqual({ kind: 'person', username: 'kaja' })
  })

  it('person: the acquaintance-level profile is offered only for one-ring-closer', () => {
    const base = { kind: 'person', link: LINK, name: 'Kaja', username: 'kaja', profile: 'https://signal.me/#eu/x' }
    expect(mode({ ...base, introducePermission: 'public' }).options.map((o) => o.id)).toEqual(['username'])
    expect(mode({ ...base, introducePermission: 'ask-first' }).options).toEqual([])
    const m = mode({ ...base, introducePermission: 'one-ring-closer' }, ['username', 'profile'])
    expect(m.options.map((o) => o.id)).toEqual(['username', 'profile'])
    expect(decodeModeLink(m.payload)).toEqual({ kind: 'person', username: 'kaja', profile: 'https://signal.me/#eu/x' })
  })

  it('ask-first offers nothing, even when toggles are passed', () => {
    const m = mode({ kind: 'person', link: LINK, name: 'K', username: 'k', introducePermission: 'ask-first' }, ['username'])
    expect(m.payload).toBe(LINK)
  })

  it('community/tag: tag share with the people visible at the viewer zone; permission picks the intent', () => {
    const c = { kind: 'community', link: LINK, tag: 'meditation', people: ['a', 'b'] }
    expect(decodeModeLink(mode(c).payload)).toEqual({ kind: 'tag', tag: 'meditation', people: ['a', 'b'], access: 'request' })
    expect(decodeModeLink(mode({ ...c, permission: 'invite' }).payload)).toMatchObject({ access: 'invite' })
    expect(decodeModeLink(mode({ ...c, permission: 'public' }).payload)).toMatchObject({ access: 'public' })
  })

  it('event: event link and my connect code in one', () => {
    const m = mode({ kind: 'event', link: LINK, eventLink: EVENT })
    expect(m.kind).toBe('event')
    const u = new URL(m.payload)
    expect(u.searchParams.get('connect')).toBe('did:peer:abc')
    expect(u.searchParams.get('m')).toBe('event')
    expect(decodeEventLink(u.hash)?.id).toBeUndefined() // fixture is not a full event; the fragment is the event link's own
    expect(u.hash).toBe('#ev=eyJhIjoxfQ&srv=0123456789abcdef')
  })

  it('item, calendar, chat group: link plus connect', () => {
    for (const kind of ['item', 'calendar', 'group']) {
      const m = mode({ kind, link: LINK, shareLink: 'https://app.trustweb.one/#x=1' })
      expect(decodeModeLink(m.payload)).toEqual({ kind, link: 'https://app.trustweb.one/#x=1' })
      expect(new URL(m.payload).searchParams.get('m')).toBe(kind)
    }
  })

  it('a short code link takes the mode with ?', () => {
    const m = mode({ kind: 'person', link: SHORT, name: 'K', username: 'k' }, ['username'])
    expect(m.payload.startsWith(SHORT + '?m=person')).toBe(true)
  })
})

describe('decode / compatibility', () => {
  it('an old-format code decodes to null (plain connect)', () => {
    expect(decodeModeLink(LINK)).toBeNull()
    expect(decodeModeLink(SHORT)).toBeNull()
  })
  it('an unknown mode decodes to null', () => {
    expect(decodeModeLink(LINK + '&m=hologram&x=abc')).toBeNull()
  })
  it('a mangled body decodes to null, never throws', () => {
    expect(decodeModeLink(LINK + '&m=person&x=!!!')).toBeNull()
  })
  it('the connect parameters survive in a mode payload (old scanners still connect)', () => {
    const m = mode({ kind: 'person', link: LINK, name: 'K', username: 'k' }, ['username'])
    expect(new URL(m.payload).searchParams.get('id')).toBe('p1')
  })
})

describe('permission reader', () => {
  it('unknown or absent -> public', () => {
    expect(parseIntroducePermission(undefined)).toBe('public')
    expect(parseIntroducePermission('x')).toBe('public')
    expect(parseIntroducePermission('ask-first')).toBe('ask-first')
  })
})
