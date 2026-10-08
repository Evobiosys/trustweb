/**
 * The persistent connect code (src/connect_code.ts, wave 6b): the record and its migration, when a registration is due, the
 * mint / update / re-mint requests against a fake fetch (contract section 10), the retry after a failure, the 30 day refresh, and
 * that the secret never leaves in anything but the POST body.
 */
import {
  CONNECT_CODE_RE, CONNECT_COOLDOWN_MS, CONNECT_MIN_GAP_MS, CONNECT_REFRESH_MS, CONNECT_RETRY_MS, CONNECT_SECRET_RE, ClaimError, ConnectError, canRegister, cleanUsername, codeOfShortLink,
  connectShortLink, isClaimable,
  createConnectKeeper, readConnectRecord, readNameList, registerConnect, registrationDue, repairConnectRecord, shortToShow,
} from '../../src/connect_code.ts'
import { buildConnectLinkUrl, parseConnectLinkParams } from '../../../demo/src/connect_link.ts'

const ORIGIN = 'https://app.trustintheweb.org'
const CODE = 'AbCdEfGhIjKlMnOpQrStUv'
const CODE2 = 'ZyXwVuTsRqPoNmLkJiHgFe'
const SECRET = 'S'.repeat(43)
const SECRET2 = 's'.repeat(43)
const DID = 'did:peer:2.Vz6Mk' + 'a'.repeat(40) + '.Ez6LS' + 'b'.repeat(40) + '.SeyJ0IjoiZG0ifQ'
const NOW = 1_800_000_000_000
const DAY = 86_400_000

const longUrl = (name = 'Ada Lovelace') => buildConnectLinkUrl(ORIGIN + '/', DID, { id: 'p1p1p1p1p1p1', displayName: name })
const record = (over = {}) => ({ code: CODE, secret: SECRET, url: longUrl(), updatedAt: NOW, ...over })

/** A fake fetch: answers[n] is {status, body} or 'offline' or 'hang'; calls are recorded with their parsed body. */
function fake(answers) {
  const calls = []
  const f = async (url, init) => {
    const a = typeof answers === 'function' ? answers(calls.length + 1, init) : answers[Math.min(calls.length, answers.length - 1)]
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null })
    if (a === 'offline') throw new TypeError('offline')
    if (a === 'hang') return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    return { status: a.status, ok: a.status < 300, json: async () => (a.body === undefined ? Promise.reject(new Error('no json')) : a.body) }
  }
  return { f, calls }
}
const deps = (f, over = {}) => ({ origin: ORIGIN, fetch: f, now: () => NOW, ...over })
const minted = (code = CODE, secret = SECRET) => ({ status: 201, body: { code, secret, url: `${ORIGIN}/c/${code}` } })
const updated = (code = CODE) => ({ status: 200, body: { code, url: `${ORIGIN}/c/${code}` } })

describe('readConnectRecord / repairConnectRecord', () => {
  it('reads a good record', () => expect(readConnectRecord(record())).toEqual(record()))
  it.each([
    ['null', null], ['undefined', undefined], ['a string', 'x'], ['an array', []], ['empty object', {}], ['a number', 7],
    ['short code', record({ code: 'abc' })], ['code with a slash', record({ code: 'a/'.repeat(11) })], ['23 char code', record({ code: CODE + 'x' })],
    ['short secret', record({ secret: 'abc' })], ['non-string url', record({ url: 5 })], ['NaN updatedAt', record({ updatedAt: NaN })], ['string updatedAt', record({ updatedAt: '1' })],
  ])('rejects %s without throwing', (_n, raw) => expect(readConnectRecord(raw)).toBeNull())
  it('a bad stored value is dropped by the boot repair, a good one and an absent one are left alone', () => {
    const bad = { connectCode: { code: 'x' } }
    expect(repairConnectRecord(bad)).toBe(true)
    expect('connectCode' in bad).toBe(false)
    const good = { connectCode: record() }
    expect(repairConnectRecord(good)).toBe(false)
    expect(good.connectCode).toEqual(record())
    expect(repairConnectRecord({})).toBe(false)
  })
  it('an old record without the field migrates (nothing there, nothing thrown)', () => {
    const old = { v: 1, me: { id: 'a', displayName: 'A' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false }
    expect(() => repairConnectRecord(old)).not.toThrow()
    expect(old.connectCode).toBeUndefined()
  })
})

describe('shapes, links', () => {
  it('the regexes match what the server mints', () => {
    expect(CONNECT_CODE_RE.test(CODE)).toBe(true)
    expect(CONNECT_SECRET_RE.test(SECRET)).toBe(true)
    expect(CONNECT_CODE_RE.test(CODE.slice(1))).toBe(false)
    expect(CONNECT_SECRET_RE.test('é'.repeat(43))).toBe(false)
  })
  it('the short link is origin + /c/ + code, whatever the app path', () => expect(connectShortLink(ORIGIN, CODE)).toBe(`${ORIGIN}/c/${CODE}`))
  it('reads a code back out of a short link of this origin only', () => {
    expect(codeOfShortLink(ORIGIN, `${ORIGIN}/c/${CODE}`)).toBe(CODE)
    expect(codeOfShortLink(ORIGIN, `${ORIGIN}/c/${CODE}#n=1`)).toBe(CODE)
    expect(codeOfShortLink(ORIGIN, `https://evil.example/c/${CODE}`)).toBeNull()
    expect(codeOfShortLink(ORIGIN, `${ORIGIN}/c/short`)).toBeNull()
  })
  it('only the two app origins may register', () => {
    expect(canRegister(ORIGIN)).toBe(true)
    expect(canRegister('https://app.idea2.site')).toBe(true)
    expect(canRegister('http://127.0.0.1:8984')).toBe(false)
    expect(canRegister('https://evil.example')).toBe(false)
  })
})

describe('registrationDue / shortToShow', () => {
  it('is due with no record, with another link, after 30 days, and when the clock went backwards', () => {
    expect(registrationDue(null, longUrl(), NOW)).toBe(true)
    expect(registrationDue(record(), longUrl('Ada'), NOW)).toBe(true)
    expect(registrationDue(record(), longUrl(), NOW + CONNECT_REFRESH_MS - 1)).toBe(false)
    expect(registrationDue(record(), longUrl(), NOW + CONNECT_REFRESH_MS)).toBe(true)
    expect(registrationDue(record(), longUrl(), NOW - 1)).toBe(true)
  })
  it('shows the code only while the server copy is current', () => {
    expect(shortToShow(ORIGIN, record(), longUrl(), NOW + DAY)).toBe(`${ORIGIN}/c/${CODE}`)
    expect(shortToShow(ORIGIN, record(), longUrl('Ada'), NOW)).toBeNull()
    expect(shortToShow(ORIGIN, null, longUrl(), NOW)).toBeNull()
    expect(shortToShow(ORIGIN, record(), longUrl(), NOW + 31 * DAY)).toBeNull()
  })
})

describe('registerConnect', () => {
  it('mints: POST {url} only, and keeps code, secret, url and the time', async () => {
    const { f, calls } = fake([minted()])
    const out = await registerConnect(deps(f), null, longUrl())
    expect(out).toEqual({ ok: true, record: record() })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${ORIGIN}/connect`)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].body).toEqual({ url: longUrl() })
    expect(calls[0].init.credentials).toBe('omit')
    expect(calls[0].init.referrerPolicy).toBe('no-referrer')
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
  })
  it('updates: POST {url, code, secret}; the record keeps its code and secret, gets the new url and time', async () => {
    const { f, calls } = fake([updated()])
    const out = await registerConnect(deps(f, { now: () => NOW + DAY }), record({ url: longUrl('Ada') }), longUrl())
    expect(calls[0].body).toEqual({ url: longUrl(), code: CODE, secret: SECRET })
    expect(out).toEqual({ ok: true, record: record({ updatedAt: NOW + DAY }) })
  })
  it('the secret is only ever in the POST body, never in a url', async () => {
    const { f, calls } = fake([updated()])
    await registerConnect(deps(f), record(), longUrl())
    expect(calls.every((c) => !String(c.url).includes(SECRET))).toBe(true)
  })
  it('a 403 on an update (the server forgot the code) mints a new one once', async () => {
    const { f, calls } = fake([{ status: 403, body: { error: 'forbidden' } }, minted(CODE2, SECRET2)])
    const out = await registerConnect(deps(f), record(), longUrl())
    expect(calls).toHaveLength(2)
    expect(calls[1].body).toEqual({ url: longUrl() })
    expect(out).toEqual({ ok: true, record: record({ code: CODE2, secret: SECRET2 }) })
  })
  it('a 403 on a mint does not loop', async () => {
    const { f, calls } = fake([{ status: 403, body: {} }])
    const out = await registerConnect(deps(f), null, longUrl())
    expect(calls).toHaveLength(1)
    expect(out).toEqual({ ok: false, error: ConnectError.Refused })
  })
  it.each([
    [429, ConnectError.RateLimited], [503, ConnectError.Unavailable], [507, ConnectError.Unavailable], [500, ConnectError.Server], [502, ConnectError.Server],
    [400, ConnectError.Refused], [413, ConnectError.Refused], [415, ConnectError.Refused],
  ])('status %i is %s', async (status, error) => {
    const { f } = fake([{ status, body: {} }])
    expect(await registerConnect(deps(f), null, longUrl())).toEqual({ ok: false, error })
  })
  it('offline and a 10 second silence are Network', async () => {
    expect(await registerConnect(deps(fake(['offline']).f), null, longUrl())).toEqual({ ok: false, error: ConnectError.Network })
    expect(await registerConnect(deps(fake(['hang']).f, { timeoutMs: 20 }), null, longUrl())).toEqual({ ok: false, error: ConnectError.Network })
  })
  it.each([
    ['no json', { status: 201 }], ['no secret', { status: 201, body: { code: CODE } }], ['bad code', { status: 201, body: { code: 'x', secret: SECRET } }],
    ['bad secret', { status: 201, body: { code: CODE, secret: 'x' } }], ['an object of nothing', { status: 201, body: null }],
  ])('a 201 that is not a mint (%s) is Server', async (_n, answer) => {
    expect(await registerConnect(deps(fake([answer]).f), null, longUrl())).toEqual({ ok: false, error: ConnectError.Server })
  })
  it('an update answered with another code is Server (the record is kept as it was)', async () => {
    expect(await registerConnect(deps(fake([updated(CODE2)]).f), record(), longUrl())).toEqual({ ok: false, error: ConnectError.Server })
  })
  it('sends nothing from a page that is not an app origin', async () => {
    const { f, calls } = fake([minted()])
    expect(await registerConnect(deps(f, { origin: 'http://127.0.0.1:8984' }), null, longUrl())).toEqual({ ok: false, error: ConnectError.NotHere })
    expect(calls).toHaveLength(0)
  })
  it('sends nothing for a link that carries a key or notes, or is not a connect link', async () => {
    const { f, calls } = fake([minted()])
    expect((await registerConnect(deps(f), null, longUrl() + '#k=TW1R-ABCDE')).ok).toBe(false)
    expect((await registerConnect(deps(f), null, ORIGIN + '/?handover=1')).ok).toBe(false)
    expect((await registerConnect(deps(f), null, 'https://evil.example/?connect=did%3Apeer%3A2')).ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})

describe('createConnectKeeper', () => {
  function keeper(answers, over = {}) {
    const box = { value: undefined }
    const timers = []
    const { f, calls } = fake(answers)
    const k = createConnectKeeper({
      ...deps(f), load: () => box.value, store: (r) => { box.value = r },
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length - 1 }, clearTimer: (h) => { if (timers[h]) timers[h].cleared = true },
      ...over,
    })
    return { k, box, calls, timers }
  }

  it('mints once, stores the record, shows the short link, and tells its listeners', async () => {
    const { k, box, calls } = keeper([minted()])
    let heard = 0
    k.onChange(() => { heard += 1 })
    expect(k.shortFor(longUrl())).toBeNull()
    expect(await k.ensure(longUrl())).toBe(true)
    expect(box.value).toEqual(record())
    expect(k.shortFor(longUrl())).toBe(`${ORIGIN}/c/${CODE}`)
    expect(heard).toBe(1)
    expect(calls).toHaveLength(1)
  })
  it('a second ensure for the same link sends nothing', async () => {
    const { k, calls } = keeper([minted()])
    await k.ensure(longUrl())
    expect(await k.ensure(longUrl())).toBe(true)
    expect(calls).toHaveLength(1)
  })
  it('a new name updates the same code (and shows the long link until the server answered)', async () => {
    const { k, box, calls } = keeper([minted(), updated()])
    await k.ensure(longUrl())
    expect(k.shortFor(longUrl('Ada B'))).toBeNull()
    expect(await k.ensure(longUrl('Ada B'))).toBe(true)
    expect(calls[1].body).toEqual({ url: longUrl('Ada B'), code: CODE, secret: SECRET })
    expect(box.value.code).toBe(CODE)
    expect(k.shortFor(longUrl('Ada B'))).toBe(`${ORIGIN}/c/${CODE}`)
  })
  it('after 30 days it writes the same link again', async () => {
    let now = NOW
    const { k, calls } = keeper([minted(), updated()], { now: () => now })
    await k.ensure(longUrl())
    now = NOW + 29 * DAY
    await k.ensure(longUrl())
    expect(calls).toHaveLength(1)
    now = NOW + 30 * DAY
    await k.ensure(longUrl())
    expect(calls).toHaveLength(2)
  })
  it('two ensures at once share one request', async () => {
    const { k, calls } = keeper([minted()])
    const [a, b] = await Promise.all([k.ensure(longUrl()), k.ensure(longUrl())])
    expect(a && b).toBe(true)
    expect(calls).toHaveLength(1)
  })
  it('a failed POST blocks nothing: false, no record, a retry is set; the retry mints', async () => {
    const { k, box, calls, timers } = keeper(['offline', minted()])
    expect(await k.ensure(longUrl())).toBe(false)
    expect(box.value).toBeUndefined()
    expect(k.shortFor(longUrl())).toBeNull()
    expect(timers).toHaveLength(1)
    expect(timers[0].ms).toBe(CONNECT_RETRY_MS[0])
    timers[0].fn()
    await new Promise((r) => setTimeout(r, 10))
    expect(calls).toHaveLength(2)
    expect(box.value).toEqual(record())
    expect(k.shortFor(longUrl())).toBe(`${ORIGIN}/c/${CODE}`)
  })
  it('retries wait longer each time and stop after the last pause', async () => {
    let now = NOW
    const { k, calls, timers } = keeper([{ status: 500, body: {} }], { now: () => now })
    await k.ensure(longUrl())
    for (let i = 0; i < CONNECT_RETRY_MS.length; i++) {
      expect(timers[i].ms).toBe(CONNECT_RETRY_MS[i])
      timers[i].fn()
      await new Promise((r) => setTimeout(r, 10))
    }
    expect(calls).toHaveLength(1 + CONNECT_RETRY_MS.length)
    expect(timers).toHaveLength(CONNECT_RETRY_MS.length)
    // the next ensure (the person opens Meet) starts over, once the short gap after a failure is over
    now = NOW + CONNECT_MIN_GAP_MS
    await k.ensure(longUrl())
    expect(calls).toHaveLength(2 + CONNECT_RETRY_MS.length)
    expect(timers).toHaveLength(CONNECT_RETRY_MS.length + 1)
  })
  it('after a 429 nothing is sent for a minute, however often ensure is called, then it asks again', async () => {
    let now = NOW
    const { k, calls } = keeper([{ status: 429, body: {} }, minted()], { now: () => now })
    expect(await k.ensure(longUrl())).toBe(false)
    expect(calls).toHaveLength(1)
    now = NOW + 5_000
    expect(await k.ensure(longUrl())).toBe(false)
    expect(await k.ensure(longUrl())).toBe(false)
    expect(calls).toHaveLength(1)
    now = NOW + CONNECT_COOLDOWN_MS
    expect(await k.ensure(longUrl())).toBe(true)
    expect(calls).toHaveLength(2)
  })
  it('a failure other than 429 does not start the minute cooldown, only a short gap (review 6b): the next Meet visit after it asks again', async () => {
    let now = NOW
    const { k, calls } = keeper([{ status: 500, body: {} }, minted()], { now: () => now })
    await k.ensure(longUrl())
    expect(await k.ensure(longUrl())).toBe(false) // a redraw right after the failure sends nothing
    expect(calls).toHaveLength(1)
    now = NOW + CONNECT_MIN_GAP_MS
    expect(await k.ensure(longUrl())).toBe(true)
    expect(calls).toHaveLength(2)
  })
  it('a 429 on a name call pauses the registration too (one budget on the server): noteRateLimited', async () => {
    let now = NOW
    const { k, calls } = keeper([minted(), updated()], { now: () => now })
    await k.ensure(longUrl())
    expect(k.coolingDown()).toBe(false)
    k.noteRateLimited()
    expect(k.coolingDown()).toBe(true)
    expect(await k.ensure(longUrl('Ada Other'))).toBe(false)
    expect(calls).toHaveLength(1)
    now = NOW + CONNECT_COOLDOWN_MS
    expect(k.coolingDown()).toBe(false)
    expect(await k.ensure(longUrl('Ada Other'))).toBe(true)
    expect(calls).toHaveLength(2)
  })
  it('an update keeps the names written while it ran (names_sync.ts), and a new code starts with none', async () => {
    const box = { value: record({ name: 'ada' }) }
    const f = async () => { box.value = record({ name: 'ada', aliases: ['ada2'], lockedNames: ['ada'] }); return { status: 200, ok: true, json: async () => ({ code: CODE, url: `${ORIGIN}/c/${CODE}` }) } }
    const k = createConnectKeeper({ ...deps(f), load: () => box.value, store: (r) => { box.value = r } })
    await k.ensure(longUrl('Ada B'))
    expect(box.value).toMatchObject({ name: 'ada', aliases: ['ada2'], lockedNames: ['ada'] })
    const box2 = { value: record({ name: 'ada', aliases: ['ada2'] }) }
    const f2 = fake([{ status: 403, body: { error: 'forbidden' } }, minted(CODE2, SECRET2)]).f
    const k2 = createConnectKeeper({ ...deps(f2), load: () => box2.value, store: (r) => { box2.value = r } })
    await k2.ensure(longUrl('Ada B'))
    expect(box2.value.code).toBe(CODE2)
    expect(box2.value.name).toBeUndefined()
    expect(box2.value.aliases).toBeUndefined()
  })
  it('a 403 that is not "forbidden" (forbidden_origin) never throws the code away', async () => {
    const { k, box, calls } = keeper([minted(), { status: 403, body: { error: 'forbidden_origin' } }], {})
    await k.ensure(longUrl())
    const kept = box.value
    await k.ensure(longUrl('Ada Other'))
    expect(calls).toHaveLength(2)
    expect(box.value).toEqual(kept)
  })
  it('a success cancels the pending retry', async () => {
    let now = NOW
    const { k, timers } = keeper(['offline', minted()], { now: () => now })
    await k.ensure(longUrl())
    expect(timers[0].cleared).toBeUndefined()
    now = NOW + CONNECT_MIN_GAP_MS
    await k.ensure(longUrl())
    expect(timers[0].cleared).toBe(true)
  })
  it('nothing is sent from a page that is not an app origin, and no retry is set', async () => {
    const { k, calls, timers } = keeper([minted()], { origin: 'http://127.0.0.1:8984' })
    expect(await k.ensure(longUrl())).toBe(false)
    expect(k.shortFor(longUrl())).toBeNull()
    expect(calls).toHaveLength(0)
    expect(timers).toHaveLength(0)
  })
  it('a corrupted stored record is treated as none (and replaced by a mint)', async () => {
    const { k, box, calls } = keeper([minted()])
    box.value = { code: 'x', secret: 'y' }
    await k.ensure(longUrl())
    expect(calls[0].body).toEqual({ url: longUrl() })
    expect(box.value).toEqual(record())
  })
  it('a listener can stop listening', async () => {
    const { k } = keeper([minted(), updated()])
    let heard = 0
    const off = k.onChange(() => { heard += 1 })
    await k.ensure(longUrl())
    off()
    await k.ensure(longUrl('Ada B'))
    expect(heard).toBe(1)
  })
})

describe('usernames: the record', () => {
  it('cleans what is typed: no @, lowercase, trimmed', () => {
    expect(cleanUsername('  @Ada.L ')).toBe('ada.l')
    expect(cleanUsername('ADA')).toBe('ada')
  })
  it('claimable: empty (release) or a valid name that does not look like a code', () => {
    expect(isClaimable('')).toBe(true)
    expect(isClaimable('ada')).toBe(true)
    expect(isClaimable('a.b-c_d')).toBe(true)
    for (const bad of ['ab', 'Ada', '-ada', 'ada-', 'a'.repeat(31), 'ada lovelace', 'ada!', 'abcdefghijklmnopqrstuv', '@ada']) expect(isClaimable(bad)).toBe(false)
  })
  it('a stored record keeps a valid name and drops an invalid one without dropping the record', () => {
    expect(readConnectRecord(record({ name: 'ada' })).name).toBe('ada')
    const bad = readConnectRecord(record({ name: 'A!' }))
    expect(bad).toEqual(record())
    expect('name' in bad).toBe(false)
  })
  it('keeps aliases and locked names (wave 6e): valid, unique, at most two aliases, locked only for names still held', () => {
    const r = readConnectRecord(record({ name: 'ada', aliases: ['ada2', 'ada2', 'A!', 'ada', 'ada3', 'ada4'], lockedNames: ['ada', 'gone', 'ada3'] }))
    expect(r.aliases).toEqual(['ada2', 'ada3'])
    expect(r.lockedNames).toEqual(['ada', 'ada3'])
  })
  it('an old record without aliases still reads, and junk aliases are dropped, never thrown on', () => {
    expect(readConnectRecord(record({ name: 'ada' }))).toEqual(record({ name: 'ada' }))
    for (const junk of [null, 5, 'x', {}, [1, null, {}]]) {
      const r = readConnectRecord(record({ aliases: junk, lockedNames: junk }))
      expect(r).toEqual(record())
    }
  })
  it('readNameList: names only, no codes, no duplicates, bounded', () => {
    expect(readNameList(['ada', 'ada', CODE, 'ab'], 3)).toEqual(['ada'])
    expect(readNameList(undefined, 3)).toEqual([])
  })
})

describe('P1: nothing in the app cuts the name out of a connect link (the "name=Ja" of 2026-10-08)', () => {
  it.each(['Ja', 'Jakob', 'Jakob Possert-Bienzle', 'J'.repeat(40), 'Zoë & Søren #1', 'a=b&c=d', '名前'])('%j survives build and parse unchanged', (name) => {
    const link = buildConnectLinkUrl(ORIGIN + '/', DID, { id: 'p1p1p1p1p1p1', displayName: name })
    expect(new URL(link).searchParams.get('name')).toBe(name)
    expect(parseConnectLinkParams(new URL(link).search)?.from.displayName).toBe(name)
  })
  it('the registered url holds the whole name and the server copy is that url unchanged', async () => {
    const { f, calls } = fake([minted()])
    const long = buildConnectLinkUrl(ORIGIN + '/', DID, { id: 'p1p1p1p1p1p1', displayName: 'Jakob Possert-Bienzle' })
    await registerConnect(deps(f), null, long)
    expect(calls[0].body.url).toBe(long)
    expect(new URL(calls[0].body.url).searchParams.get('name')).toBe('Jakob Possert-Bienzle')
  })
})
