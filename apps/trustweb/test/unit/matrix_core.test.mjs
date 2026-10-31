// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Matrix module (wave 27, msg-matrix): pure parts and the IO file with a stubbed fetch. Made-up fixtures, no network. */
import {
  DEFAULT_HOMESERVER, ELEMENT_LINK, normalizeHomeserver, parseWellKnown, pickLogin, ssoRedirectUrl, loginTokenFrom,
  parseDirect, matchPeer, parseSync, parseMessages, parseSession, SYNC_FILTER,
} from '../../src/ext/matrix/matrix.ts'
import { createClient } from '../../src/ext/matrix/matrix_io.ts'

describe('normalizeHomeserver', () => {
  it('defaults and cleans', () => {
    expect(DEFAULT_HOMESERVER).toBe('https://matrix.org')
    expect(normalizeHomeserver('matrix.org')).toBe('https://matrix.org')
    expect(normalizeHomeserver('  https://example.test/  ')).toBe('https://example.test')
    expect(normalizeHomeserver('https://example.test/_matrix?x=1#y')).toBe('https://example.test')
  })
  it('https only, except localhost for dev', () => {
    expect(normalizeHomeserver('http://example.test')).toBeNull()
    expect(normalizeHomeserver('http://localhost:8008')).toBe('http://localhost:8008')
    expect(normalizeHomeserver('javascript:alert(1)')).toBeNull()
    expect(normalizeHomeserver('')).toBeNull()
    expect(normalizeHomeserver('not a host')).toBeNull()
  })
})

describe('parseWellKnown', () => {
  it('reads base_url', () => {
    expect(parseWellKnown({ 'm.homeserver': { base_url: 'https://matrix-client.example.test/' } })).toBe('https://matrix-client.example.test')
  })
  it('rejects junk and plain http', () => {
    expect(parseWellKnown({})).toBeNull()
    expect(parseWellKnown(null)).toBeNull()
    expect(parseWellKnown({ 'm.homeserver': { base_url: 'http://x.test' } })).toBeNull()
  })
})

describe('pickLogin', () => {
  it('shows only what the server offers', () => {
    expect(pickLogin({ flows: [{ type: 'm.login.password' }, { type: 'm.login.sso' }] })).toEqual({ password: true, sso: true, none: false })
    expect(pickLogin({ flows: [{ type: 'm.login.sso' }] })).toEqual({ password: false, sso: true, none: false })
    expect(pickLogin({ flows: [{ type: 'm.login.token' }] })).toEqual({ password: false, sso: false, none: true })
    expect(pickLogin(null)).toEqual({ password: false, sso: false, none: true })
  })
})

describe('sso', () => {
  it('builds the redirect and reads the token back', () => {
    const u = ssoRedirectUrl('https://example.test', 'https://app.test/x')
    expect(u).toBe('https://example.test/_matrix/client/v3/login/sso/redirect?redirectUrl=' + encodeURIComponent('https://app.test/x'))
    expect(loginTokenFrom('?loginToken=abc123&z=1')).toBe('abc123')
    expect(loginTokenFrom('?z=1')).toBeNull()
  })
})

describe('element link', () => {
  it('is one constant', () => {
    expect(ELEMENT_LINK('!r:example.test')).toBe('https://matrix.to/#/!r:example.test')
    expect(ELEMENT_LINK('#room:example.test')).toBe('https://matrix.to/#/#room:example.test')
  })
})

const sync = {
  account_data: { events: [{ type: 'm.direct', content: { '@anna:example.test': ['!dm:example.test'] } }] },
  rooms: {
    join: {
      '!dm:example.test': { state: { events: [] }, timeline: { events: [{ type: 'm.room.message', origin_server_ts: 2000, content: { body: 'hi' } }] }, unread_notifications: { notification_count: 2 } },
      '!g:example.test': { state: { events: [{ type: 'm.room.name', content: { name: 'Garden club' } }] }, timeline: { events: [{ type: 'm.room.message', origin_server_ts: 5000 }] } },
      '!a:example.test': { state: { events: [{ type: 'm.room.canonical_alias', content: { alias: '#aliased:example.test' } }] }, timeline: { events: [] } },
    },
  },
}

describe('sync parse', () => {
  it('direct map', () => {
    expect(parseDirect(sync)).toEqual({ '!dm:example.test': '@anna:example.test' })
  })
  it('threads, newest first, unread, peer match', () => {
    const people = [{ id: 'p1', peerId: 'peer-anna', channels: { matrix: '@Anna:example.test' } }, { id: 'p2', channels: {} }]
    const t = parseSync(sync, people)
    expect(t.map((x) => x.id)).toEqual(['!g:example.test', '!dm:example.test', '!a:example.test'])
    expect(t[0]).toMatchObject({ title: 'Garden club', lastAt: 5000, unread: 0 })
    expect(t[1]).toMatchObject({ unread: 2, peerId: 'peer-anna', lastAt: 2000 })
    expect(t[2].title).toBe('#aliased:example.test')
  })
  it('matchPeer needs a peerId and is case-insensitive', () => {
    expect(matchPeer('@anna:example.test', [{ id: 'p', channels: { matrix: '@anna:example.test' } }])).toBeUndefined()
    expect(matchPeer('@ANNA:example.test', [{ id: 'p', peerId: 'x', channels: { matrix: '@anna:example.test' } }])).toBe('x')
  })
  it('filter keeps it minimal', () => {
    expect(SYNC_FILTER.room.timeline.limit).toBe(1)
    expect(SYNC_FILTER.room.state.lazy_load_members).toBe(true)
  })
})

describe('parseMessages', () => {
  it('text, encrypted, oldest first, others dropped', () => {
    const m = parseMessages({ chunk: [
      { event_id: '$3', type: 'm.room.message', sender: '@b:e.test', origin_server_ts: 30, content: { msgtype: 'm.text', body: 'third' } },
      { event_id: '$2', type: 'm.room.encrypted', sender: '@a:e.test', origin_server_ts: 20, content: {} },
      { event_id: '$x', type: 'm.room.member', sender: '@a:e.test', origin_server_ts: 15, content: {} },
      { event_id: '$1', type: 'm.room.message', sender: '@a:e.test', origin_server_ts: 10, content: { msgtype: 'm.image', body: 'pic.png' } },
    ] })
    expect(m.map((x) => x.id)).toEqual(['$2', '$3'])
    expect(m[0].encrypted).toBe(true)
    expect(m[1].text).toBe('third')
  })
})

describe('parseSession', () => {
  it('needs hs and token', () => {
    expect(parseSession('{"hs":"https://e.test","token":"t","userId":"@a:e.test"}')).toMatchObject({ token: 't' })
    expect(parseSession('{"hs":"https://e.test"}')).toBeNull()
    expect(parseSession('nope')).toBeNull()
    expect(parseSession(null)).toBeNull()
  })
})

describe('client with stubbed fetch', () => {
  const stub = (routes) => {
    const calls = []
    const f = async (url, init) => {
      calls.push({ url: String(url), init })
      const key = Object.keys(routes).find((k) => String(url).includes(k))
      if (!key) return { ok: false, status: 404, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => routes[key] }
    }
    return { f, calls }
  }
  it('discover falls back to the typed server', async () => {
    const { f } = stub({})
    expect(await createClient(f).discover('https://example.test')).toBe('https://example.test')
  })
  it('discover follows well-known', async () => {
    const { f } = stub({ '/.well-known/matrix/client': { 'm.homeserver': { base_url: 'https://mx.example.test' } } })
    expect(await createClient(f).discover('https://example.test')).toBe('https://mx.example.test')
  })
  it('password login posts the documented body and returns the session', async () => {
    const { f, calls } = stub({ '/login': { access_token: 'tok', user_id: '@a:e.test', device_id: 'D' } })
    const s = await createClient(f).loginPassword('https://e.test', 'a', 'pw')
    expect(s).toEqual({ hs: 'https://e.test', token: 'tok', userId: '@a:e.test', deviceId: 'D' })
    const body = JSON.parse(calls[0].init.body)
    expect(body).toEqual({ type: 'm.login.password', identifier: { type: 'm.id.user', user: 'a' }, password: 'pw', initial_device_display_name: 'TrustWeb' })
    expect(JSON.stringify(s)).not.toContain('pw"')
  })
  it('token login exchanges m.login.token', async () => {
    const { f, calls } = stub({ '/login': { access_token: 'tok', user_id: '@a:e.test' } })
    await createClient(f).loginToken('https://e.test', 'lt')
    expect(JSON.parse(calls[0].init.body)).toMatchObject({ type: 'm.login.token', token: 'lt' })
  })
  it('requests carry the bearer token only to the homeserver', async () => {
    const { f, calls } = stub({ '/messages': { chunk: [] }, '/logout': {} })
    const c = createClient(f)
    const s = { hs: 'https://e.test', token: 'tok', userId: '@a:e.test' }
    await c.messages(s, '!r:e.test')
    expect(calls[0].url.startsWith('https://e.test/_matrix/client/v3/rooms/!r%3Ae.test/messages?dir=b&limit=30')).toBe(true)
    expect(calls[0].init.headers.Authorization).toBe('Bearer tok')
    await c.logout(s)
    expect(calls[1].init.method).toBe('POST')
  })
})
