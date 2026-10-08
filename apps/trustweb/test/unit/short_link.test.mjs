/**
 * Short connect links (src/short_link.ts, wave 5): which origins offer them, which urls may be sent (never a key, never
 * notes), the request, the error mapping, the per-session cache, the expiry, the shared in-flight request, and that a link
 * arriving through the server's redirect still parses (query and fragment intact).
 */
import {
  buildShort, canShorten, createShortLinker, errorForStatus, isShareable, parseRetryAfter, readLink, shareBlock, SHORT_LINK_MAX_BYTES,
  SHORT_LINK_MIN_LEFT_MS, ShortLinkError, stillGood,
} from '../../src/short_link.ts'
import { demoFragment, handoverFragment, parseDemoFragment, SHORTENABLE_FRAGMENT_KEYS } from '../../src/demo_account.ts'
import { buildConnectLinkUrl, parseConnectLinkParams } from '../../../demo/src/connect_link.ts'
import { shareFragment, shareUrl } from '../../src/share.ts'
import { S } from '../../src/strings.ts'

const ORIGIN = 'https://app.trustintheweb.org'
const IDEA2 = 'https://app.idea2.site'
const DID = 'did:peer:2.Vz6Mk' + 'a'.repeat(40) + '.Ez6LS' + 'b'.repeat(40) + '.SeyJ0IjoiZG0ifQ'
const KEY = 'TW1R-ABCDE-FGHJK-MNPQR-STVWX-YZ012-3456A-BCDEF-GHJKM-NPQRS-TVWXY-Z'
const ID = 'AbCdEf0123'
const NOW = 1_800_000_000_000
const DAY = 86_400_000

const connect = (origin = ORIGIN + '/') => buildConnectLinkUrl(origin, DID, { id: 'p1', displayName: 'Jakob Possert-Bienzle' })
const demo = (origin = ORIGIN + '/') => connect(origin) + '#' + demoFragment({
  account: 'Ada-demo', accountId: 'ab12cd34', expiresAt: NOW + 7 * DAY,
  peer: { did: DID, id: 'bk3_FLHVX5L-', name: 'Jakob' },
})

describe('canShorten', () => {
  it('is true for exactly the three app origins (wave 6c: app.trustweb.one is the canonical one)', () => {
    expect(canShorten(ORIGIN)).toBe(true)
    expect(canShorten(IDEA2)).toBe(true)
    expect(canShorten('https://app.trustweb.one')).toBe(true)
  })
  it.each([
    'http://127.0.0.1:8984', 'http://localhost:5190', 'null', 'file://', 'https://idea2.site', 'https://trustintheweb.org',
    'https://www.trustintheweb.org', 'http://app.trustintheweb.org', 'https://app.trustintheweb.org:8443', 'https://evil.example', '',
    'https://app.trustintheweb.org.evil.example', 'https://trustweb.one', 'https://demo.trustweb.one', 'https://app.trustweb.one.evil.example',
    'http://app.trustweb.one', 'https://app.trustweb.one:8443',
  ])('is false for %s', (o) => expect(canShorten(o)).toBe(false))
})

describe('shareBlock / isShareable', () => {
  it('accepts a plain connect link on either origin (path included)', () => {
    expect(shareBlock(connect(), ORIGIN)).toBeNull()
    expect(shareBlock(connect(IDEA2 + '/trustweb/'), IDEA2)).toBeNull()
  })
  it('accepts a demo-account link (account, id, end, demo peer in the fragment)', () => {
    expect(isShareable(demo(), ORIGIN)).toBe(true)
  })
  it('accepts the long link from the issue, shape for shape', () => {
    const url = `${ORIGIN}/?connect=${encodeURIComponent(DID)}&id=bk3_FLHVX5L-&name=Jakob+Possert-Bienzle#t=test-demo&a=ab12cd34&p=${encodeURIComponent(DID)}&pi=bk3_FLHVX5L-&pn=Demo+inventory`
    expect(isShareable(url, ORIGIN)).toBe(true)
  })
  it('rejects a hand-over link, even with a connect parameter added', () => {
    const handover = `${ORIGIN}/?handover=1#` + handoverFragment({ keyText: KEY, accountId: 'ab12cd34', account: 'Ada-demo' })
    expect(shareBlock(handover, ORIGIN)).toBe(ShortLinkError.Refused) // no connect at all
    const sneaky = `${ORIGIN}/?connect=${encodeURIComponent(DID)}&id=p1&handover=1#` + handoverFragment({ keyText: KEY, accountId: 'ab12cd34', account: 'Ada-demo' })
    expect(shareBlock(sneaky, ORIGIN)).toBe(ShortLinkError.Private)
  })
  it('rejects any fragment key outside the demo-account set: k (a key), n (notes), anything unknown', () => {
    expect(shareBlock(connect() + '#k=' + KEY, ORIGIN)).toBe(ShortLinkError.Private)
    expect(shareBlock(connect() + '#n=' + encodeURIComponent('Lena moves to Lisbon'), ORIGIN)).toBe(ShortLinkError.Private)
    expect(shareBlock(connect() + '#' + shareFragment({ keyText: KEY, title: 'Meeting' }), ORIGIN)).toBe(ShortLinkError.Private)
    expect(shareBlock(demo() + '&zz=1', ORIGIN)).toBe(ShortLinkError.Private)
    expect(shareBlock(demo() + '&own=1', ORIGIN)).toBe(ShortLinkError.Private)
  })
  it('rejects a share link and a link whose fragment carries a key beside the demo keys', () => {
    expect(shareBlock(shareUrl(ORIGIN + '/', { keyText: KEY, title: 'Meeting' }), ORIGIN)).toBe(ShortLinkError.Refused)
    expect(shareBlock(connect() + '&share=1#t=Ada-demo', ORIGIN)).toBe(ShortLinkError.Private)
    expect(shareBlock(demo() + '&k=' + KEY, ORIGIN)).toBe(ShortLinkError.Private)
  })
  it('names the demo keys it allows', () => {
    expect([...SHORTENABLE_FRAGMENT_KEYS].sort()).toEqual(['a', 'p', 'pi', 'pn', 't', 'x'])
    expect(SHORTENABLE_FRAGMENT_KEYS).not.toContain('k')
    expect(SHORTENABLE_FRAGMENT_KEYS).not.toContain('n')
  })
  it('rejects another origin, a mismatch between link and page, and a url with userinfo', () => {
    expect(shareBlock(connect('http://127.0.0.1:8984/'), 'http://127.0.0.1:8984')).toBe(ShortLinkError.NotHere)
    expect(shareBlock(connect(IDEA2 + '/'), ORIGIN)).toBe(ShortLinkError.NotHere)
    expect(shareBlock(connect().replace('https://', 'https://u:p@'), ORIGIN)).toBe(ShortLinkError.NotHere)
  })
  it('rejects a url that is not a url, and a url with no (or an empty) connect parameter', () => {
    expect(shareBlock('not a url', ORIGIN)).toBe(ShortLinkError.Refused)
    expect(shareBlock(ORIGIN + '/', ORIGIN)).toBe(ShortLinkError.Refused)
    expect(shareBlock(ORIGIN + '/?connect=&id=p1', ORIGIN)).toBe(ShortLinkError.Refused)
  })
  it('rejects a url longer than the server takes (body bytes, not just characters)', () => {
    const long = connect() + '#t=' + 'x'.repeat(SHORT_LINK_MAX_BYTES)
    expect(shareBlock(long, ORIGIN)).toBe(ShortLinkError.TooLong)
    // a url just under the character cap whose JSON body is over it
    const base = connect() + '#t='
    const fill = 'x'.repeat(SHORT_LINK_MAX_BYTES - base.length - 2)
    expect(shareBlock(base + fill, ORIGIN)).toBe(ShortLinkError.TooLong)
    const fits = 'x'.repeat(SHORT_LINK_MAX_BYTES - base.length - 20)
    expect(shareBlock(base + fits, ORIGIN)).toBeNull()
  })
})

describe('buildShort', () => {
  it('is origin + /l/ + id, never the app path', () => {
    expect(buildShort(ORIGIN, ID)).toBe('https://app.trustintheweb.org/l/AbCdEf0123')
    expect(buildShort(IDEA2, ID)).toBe('https://app.idea2.site/l/AbCdEf0123')
  })
})

describe('parseRetryAfter / errorForStatus / readLink / stillGood', () => {
  it('reads Retry-After seconds, clamped; anything else is unknown', () => {
    expect(parseRetryAfter('17')).toBe(17)
    expect(parseRetryAfter(' 5 ')).toBe(5)
    expect(parseRetryAfter('0')).toBe(1)
    expect(parseRetryAfter('999999')).toBe(3600)
    for (const v of ['', 'soon', '-3', '1.5', 'Wed, 21 Oct 2026 07:28:00 GMT', null, undefined]) expect(parseRetryAfter(v)).toBeUndefined()
  })
  it('maps statuses', () => {
    expect(errorForStatus(429)).toBe(ShortLinkError.RateLimited)
    expect(errorForStatus(503)).toBe(ShortLinkError.Off)
    expect(errorForStatus(507)).toBe(ShortLinkError.Full)
    expect(errorForStatus(500)).toBe(ShortLinkError.Server)
    expect(errorForStatus(502)).toBe(ShortLinkError.Server)
    for (const s of [400, 403, 404, 405, 413, 415, 421]) expect(errorForStatus(s)).toBe(ShortLinkError.Refused)
  })
  it('accepts only a 10-character id and a finite end in the future', () => {
    expect(readLink({ id: ID, expires_at: NOW + DAY }, NOW)).toEqual({ id: ID, expiresAt: NOW + DAY })
    for (const bad of [null, 'x', [], {}, { id: ID }, { expires_at: NOW + DAY }, { id: 'short', expires_at: NOW + DAY }, { id: 'AbCdEf012!', expires_at: NOW + DAY },
      { id: ID + 'x', expires_at: NOW + DAY }, { id: ID, expires_at: 'soon' }, { id: ID, expires_at: NaN }, { id: ID, expires_at: NOW - 1 }, { id: 1234567890, expires_at: NOW + DAY }]) {
      expect(readLink(bad, NOW)).toBeNull()
    }
  })
  it('a held link is good while it has more than the margin left', () => {
    expect(stillGood({ id: ID, expiresAt: NOW + SHORT_LINK_MIN_LEFT_MS + 1 }, NOW)).toBe(true)
    expect(stillGood({ id: ID, expiresAt: NOW + SHORT_LINK_MIN_LEFT_MS }, NOW)).toBe(false)
    expect(stillGood({ id: ID, expiresAt: NOW - 1 }, NOW)).toBe(false)
  })
})

/** A fake fetch: answers from a queue, records every call. */
function fakeFetch(...answers) {
  const calls = []
  const fn = (input, init) => {
    calls.push({ input, init })
    const a = answers.length > 1 ? answers.shift() : answers[0]
    return typeof a === 'function' ? a(input, init) : Promise.resolve(a)
  }
  fn.calls = calls
  return fn
}
const reply = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
  json: () => (body === undefined ? Promise.reject(new SyntaxError('no body')) : Promise.resolve(body)),
})
const made = (status = 201, id = ID, left = 30 * DAY) => reply(status, { id, expires_at: NOW + left })

describe('createShortLinker', () => {
  let clock
  beforeEach(() => { clock = NOW })
  const linker = (f, extra = {}) => createShortLinker({ origin: ORIGIN, fetch: f, now: () => clock, ...extra })

  it('POSTs the exact long url, as JSON, same-origin, and answers the short link (201 and 200 alike)', async () => {
    for (const status of [201, 200]) {
      const f = fakeFetch(made(status))
      const url = demo()
      const out = await linker(f).shorten(url)
      expect(out).toMatchObject({ ok: true, short: 'https://app.trustintheweb.org/l/AbCdEf0123', fromCache: false, link: { id: ID, expiresAt: NOW + 30 * DAY } })
      expect(f.calls).toHaveLength(1)
      expect(f.calls[0].input).toBe(ORIGIN + '/link')
      expect(f.calls[0].init.method).toBe('POST')
      expect(f.calls[0].init.headers['Content-Type']).toBe('application/json')
      expect(JSON.parse(f.calls[0].init.body)).toEqual({ url })
      expect(f.calls[0].init.credentials).toBe('omit')
      expect(f.calls[0].init.signal).toBeDefined()
    }
  })
  it('builds the short link from the page origin (app.idea2.site)', async () => {
    const f = fakeFetch(made())
    const out = await createShortLinker({ origin: IDEA2, fetch: f, now: () => clock }).shorten(connect(IDEA2 + '/trustweb/'))
    expect(out.short).toBe('https://app.idea2.site/l/AbCdEf0123')
    expect(f.calls[0].input).toBe(IDEA2 + '/link')
  })
  it('asks once per long url for the whole session', async () => {
    const f = fakeFetch(made())
    const l = linker(f)
    const url = connect()
    expect((await l.shorten(url)).fromCache).toBe(false)
    const again = await l.shorten(url)
    expect(again).toMatchObject({ ok: true, fromCache: true, short: 'https://app.trustintheweb.org/l/AbCdEf0123' })
    expect(f.calls).toHaveLength(1)
    expect(l.cached(url)?.short).toBe('https://app.trustintheweb.org/l/AbCdEf0123')
    await l.shorten(demo()) // another long url is another request
    expect(f.calls).toHaveLength(2)
  })
  it('shares one request between taps made while it is in flight', async () => {
    let release
    const f = fakeFetch(() => new Promise((r) => { release = () => r(made()) }))
    const l = linker(f)
    const a = l.shorten(connect())
    const b = l.shorten(connect())
    await Promise.resolve()
    release()
    expect(await a).toEqual(await b)
    expect(f.calls).toHaveLength(1)
  })
  it('asks again once the held link is expired or nearly so', async () => {
    const f = fakeFetch(made(201, 'AAAAAAAAAA', 2 * DAY), made(201, 'BBBBBBBBBB'))
    const l = linker(f)
    expect((await l.shorten(connect())).short).toMatch(/AAAAAAAAAA$/)
    clock = NOW + 2 * DAY - SHORT_LINK_MIN_LEFT_MS // less than the margin left
    expect(l.cached(connect())).toBeNull()
    expect((await l.shorten(connect())).short).toMatch(/BBBBBBBBBB$/)
    expect(f.calls).toHaveLength(2)
    clock = NOW + 40 * DAY // long past the end
    expect(l.cached(connect())).toBeNull()
  })
  it('never remembers a failure: the next tap asks again', async () => {
    const f = fakeFetch(reply(500, {}), made())
    const l = linker(f)
    expect(await l.shorten(connect())).toEqual({ ok: false, error: ShortLinkError.Server })
    expect((await l.shorten(connect())).ok).toBe(true)
    expect(f.calls).toHaveLength(2)
  })
  it('maps 429 with its Retry-After, 503, 507, 4xx and 5xx', async () => {
    const run = async (r) => linker(fakeFetch(r)).shorten(connect())
    expect(await run(reply(429, {}, { 'Retry-After': '42' }))).toEqual({ ok: false, error: ShortLinkError.RateLimited, retryAfterSeconds: 42 })
    expect(await run(reply(429, {}))).toEqual({ ok: false, error: ShortLinkError.RateLimited })
    expect(await run(reply(503, {}))).toEqual({ ok: false, error: ShortLinkError.Off })
    expect(await run(reply(507, {}))).toEqual({ ok: false, error: ShortLinkError.Full })
    expect(await run(reply(400, {}))).toEqual({ ok: false, error: ShortLinkError.Refused })
    expect(await run(reply(403, {}))).toEqual({ ok: false, error: ShortLinkError.Refused })
    expect(await run(reply(502, {}))).toEqual({ ok: false, error: ShortLinkError.Server })
  })
  it('maps a network failure (offline) and a 2xx that is not a short link', async () => {
    expect(await linker(fakeFetch(() => Promise.reject(new TypeError('Failed to fetch')))).shorten(connect())).toEqual({ ok: false, error: ShortLinkError.Network })
    expect(await linker(fakeFetch(reply(200, undefined))).shorten(connect())).toEqual({ ok: false, error: ShortLinkError.Server })
    expect(await linker(fakeFetch(reply(200, { id: 'x', expires_at: NOW + DAY }))).shorten(connect())).toEqual({ ok: false, error: ShortLinkError.Server })
  })
  it('gives up after the timeout (the request is aborted) and keeps the long link', async () => {
    const f = fakeFetch((_i, init) => new Promise((_res, rej) => { init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))) }))
    expect(await linker(f, { timeoutMs: 20 }).shorten(connect())).toEqual({ ok: false, error: ShortLinkError.Network })
  })
  it('sends nothing for a url it must not send, or on another origin', async () => {
    const f = fakeFetch(made())
    const l = linker(f)
    expect(await l.shorten(connect() + '#k=' + KEY)).toEqual({ ok: false, error: ShortLinkError.Private })
    expect(await l.shorten(`${ORIGIN}/?handover=1#k=${KEY}`)).toMatchObject({ ok: false })
    expect(await l.shorten(connect('https://evil.example/'))).toEqual({ ok: false, error: ShortLinkError.NotHere })
    const local = createShortLinker({ origin: 'http://127.0.0.1:8984', fetch: f, now: () => clock })
    expect(await local.shorten(connect('http://127.0.0.1:8984/'))).toEqual({ ok: false, error: ShortLinkError.NotHere })
    expect(f.calls).toHaveLength(0)
  })
})

describe('a link that arrives through the redirect', () => {
  it('keeps its query and its fragment: the connect screen and the demo account still read', () => {
    const long = demo()
    const location = new URL(long) // the server answers 302 Location: <long>; the browser lands on exactly that
    const params = parseConnectLinkParams(location.search)
    expect(params).toEqual({ did: DID, from: { id: 'p1', displayName: 'Jakob Possert-Bienzle' } })
    expect(parseDemoFragment(location.hash)).toMatchObject({ account: 'Ada-demo', accountId: 'ab12cd34', peer: { did: DID, id: 'bk3_FLHVX5L-', name: 'Jakob' } })
  })
})

describe('the words', () => {
  it('say the 30 days and that the server keeps the link', () => {
    expect(S.shortLinkNote).toMatch(/our server for 30 days/)
    expect(S.shortLinkNote).toMatch(/expires/)
    expect(S.hintText.qr).toMatch(/kept on our server for 30 days/)
  })
  it('have a sentence for every failure, and the long link stays the answer', () => {
    for (const e of Object.values(ShortLinkError)) {
      if (e === ShortLinkError.NotHere) { expect(S.shortLinkFailed(e)).toBe(''); continue }
      expect(S.shortLinkFailed(e).length).toBeGreaterThan(20)
      if (e !== ShortLinkError.Private) expect(S.shortLinkFailed(e)).toMatch(/long link works as before/)
    }
    expect(S.shortLinkFailed(ShortLinkError.RateLimited, 42)).toMatch(/42 seconds/)
    expect(S.shortLinkFailed(ShortLinkError.RateLimited, 1)).toMatch(/1 second\./)
    expect(S.shortLinkFailed(ShortLinkError.RateLimited)).toMatch(/little while/)
  })
  it('use no em dash', () => {
    for (const e of Object.values(ShortLinkError)) expect(S.shortLinkFailed(e, 5)).not.toMatch(/\u2014/)
    expect(S.shortLinkNote).not.toMatch(/\u2014/)
  })
})
