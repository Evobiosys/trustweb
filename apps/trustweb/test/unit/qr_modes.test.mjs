// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** QR modes (src/qr_modes.ts, wave 27): mode() per context, payload round trip, old-code compatibility. Fake data only. */
import { decodeModeLink, mode, parseIntroducePermission, QR_PROFILE_OPTION } from '../../src/qr_modes.ts'
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

  it('person: the profile option stays hidden while QR_PROFILE_OPTION is off (a typed messenger link is not a profile)', () => {
    expect(QR_PROFILE_OPTION).toBe(false)
    const base = { kind: 'person', link: LINK, name: 'Kaja', username: 'kaja', profile: 'https://signal.me/#p/+4366000', introducePermission: 'one-ring-closer' }
    expect(mode(base, ['username', 'profile']).options.map((o) => o.id)).toEqual(['username'])
    expect(mode(base, ['username', 'profile']).payload).not.toContain('signal.me')
    expect(decodeModeLink(mode(base, ['username', 'profile']).payload)).toEqual({ kind: 'person', username: 'kaja' })
  })

  it.skip('person: the acquaintance-level profile is offered only for one-ring-closer (needs QR_PROFILE_OPTION)', () => {
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
      expect(new URLSearchParams(new URL(m.payload).hash.slice(1)).get('m')).toBe(kind)
    }
  })

  it('a short code link takes the mode in the fragment', () => {
    const m = mode({ kind: 'person', link: SHORT, name: 'K', username: 'k' }, ['username'])
    expect(m.payload.startsWith(SHORT + '#m=person')).toBe(true)
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

describe('wave 27 review: the body rides in the fragment, with caps', () => {
  it('m and x are in the fragment, not the query string', () => {
    const m = mode({ kind: 'person', link: LINK, name: 'K', username: 'k' }, ['username'])
    const u = new URL(m.payload)
    expect(u.search).toBe(new URL(LINK).search)
    expect(u.hash).toMatch(/^#m=person&x=/)
    const t = new URL(mode({ kind: 'community', link: LINK, tag: 'meditation', people: ['a'] }).payload)
    expect(t.search).toBe(new URL(LINK).search)
    expect(t.hash).toMatch(/^#m=tag&x=/)
  })
  it('a code that already has a fragment keeps it', () => {
    const m = mode({ kind: 'person', link: LINK + '#k=1', name: 'K', username: 'k' }, ['username'])
    expect(new URL(m.payload).hash.startsWith('#k=1&m=person&x=')).toBe(true)
    expect(decodeModeLink(m.payload)).toEqual({ kind: 'person', username: 'k' })
  })
  it('an old code with m= and x= in the query still decodes (and still connects)', () => {
    const x = btoa(JSON.stringify({ u: 'kaja' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(decodeModeLink(LINK + '&m=person&x=' + x)).toEqual({ kind: 'person', username: 'kaja' })
  })
  it('caps: username 30, tag 60, people 200', () => {
    const p = decodeModeLink(mode({ kind: 'person', link: LINK, name: 'K', username: 'u'.repeat(50) }, ['username']).payload)
    expect(p.username).toHaveLength(30)
    const people = Array.from({ length: 250 }, (_, i) => 'p' + i)
    const t = decodeModeLink(mode({ kind: 'community', link: LINK, tag: 't'.repeat(90), people }).payload)
    expect(t.tag).toHaveLength(60)
    expect(t.people).toHaveLength(200)
  })
})

describe('permission reader', () => {
  it('unknown or absent -> public', () => {
    expect(parseIntroducePermission(undefined)).toBe('public')
    expect(parseIntroducePermission('x')).toBe('public')
    expect(parseIntroducePermission('ask-first')).toBe('ask-first')
  })
})
