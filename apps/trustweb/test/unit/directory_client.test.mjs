// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c social-hosting: the app's calls to the name directory (injected fetch, nothing leaves in tests). */
import { createIdentity, signBytes, verifyDidSignature } from '../../../demo/src/did.ts'
import { makeIntent, makeRecord } from '../../src/name_record.ts'
import { DEFAULT_SERVER, deleteRecord, pullIntents, putRecord, searchName, sendIntent, serversOf } from '../../src/directory_client.ts'

const me = createIdentity('https://x.test'); const eve = createIdentity('https://y.test')
const sign = (id) => (b) => signBytes(id, b)
const rec = (id = me, over = {}) => makeRecord(sign(id), { first: 'Ada', last: 'Lovelace', key: id.did, ts: 1000, open: true, srv: true, ...over })
const answer = (status, json) => ({ status, json: async () => json })
const NOW = 1_700_000_000_000

function fake(routes) {
  const calls = []
  const f = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(init.body) : undefined })
    const r = routes(url, init)
    if (r instanceof Error) throw r
    return r
  }
  return { f, calls }
}
const deps = (f, origins = ['https://a.test']) => ({ fetch: f, origins, now: () => NOW, verify: verifyDidSignature })

describe('serversOf', () => {
  it('no list = the Swiss default (this app\'s own origin)', () => {
    expect(DEFAULT_SERVER).toBe('')
    expect(serversOf({}, 'https://app.test')).toEqual(['https://app.test'])
    expect(serversOf({ directoryServers: [] }, 'https://app.test')).toEqual(['https://app.test'])
  })
  it('a list is used as given, trimmed, trailing slashes cut, https only (http only for loopback), no duplicates', () => {
    expect(serversOf({ directoryServers: ['https://a.test/', ' https://b.test ', 'https://a.test', 'http://evil.test', 'ftp://x', 'http://127.0.0.1:8080', 'nope'] }, 'https://app.test'))
      .toEqual(['https://a.test', 'https://b.test', 'http://127.0.0.1:8080'])
  })
})

describe('putRecord', () => {
  it('PUTs the record to every server; true when at least one took it', async () => {
    const { f, calls } = fake((u) => (u.startsWith('https://a.test') ? answer(204) : new Error('down')))
    expect(await putRecord(deps(f, ['https://a.test', 'https://b.test']), rec())).toBe(true)
    expect(calls.map((c) => [c.method, c.url])).toEqual([['PUT', 'https://a.test/directory'], ['PUT', 'https://b.test/directory']])
    expect(calls[0].body.rec.first).toBe('Ada')
  })
  it('false when none took it, never throws', async () => {
    const { f } = fake(() => answer(400, { error: 'bad_request' }))
    expect(await putRecord(deps(f), rec())).toBe(false)
    expect(await putRecord(deps(fake(() => new Error('x')).f), rec())).toBe(false)
  })
})

describe('searchName', () => {
  it('asks for the exact name and returns only valid records, newest per key', async () => {
    const good = rec(me, { ts: 5 }); const older = rec(me, { ts: 2 }); const forged = { ...rec(eve), key: me.did, ts: 99 }
    const { f, calls } = fake(() => answer(200, { records: [older, good, forged, 'junk'] }))
    const hits = await searchName(deps(f), 'Ada', 'Lovelace')
    expect(calls[0].url).toBe('https://a.test/directory?q=ada%20lovelace')
    expect(hits.map((h) => [h.key, h.ts])).toEqual([[me.did, 5]])
  })
  it('merges several servers and stops asking none; a failing server is skipped', async () => {
    const { f } = fake((u) => (u.startsWith('https://a.test') ? answer(200, { records: [rec(me)] }) : u.startsWith('https://b.test') ? new Error('down') : answer(200, { records: [rec(eve)] })))
    const hits = await searchName(deps(f, ['https://a.test', 'https://b.test', 'https://c.test']), 'ada', 'lovelace')
    expect(hits.map((h) => h.key).sort()).toEqual([me.did, eve.did].sort())
  })
  it('an empty name asks nothing', async () => {
    const { f, calls } = fake(() => answer(200, { records: [] }))
    expect(await searchName(deps(f), ' ', 'x')).toEqual([])
    expect(calls).toHaveLength(0)
  })
})

describe('deleteRecord, sendIntent, pullIntents', () => {
  it('DELETE carries a signed key+ts', async () => {
    const { f, calls } = fake(() => answer(204))
    expect(await deleteRecord(deps(f), me.did, sign(me))).toBe(true)
    expect(calls[0].method).toBe('DELETE')
    expect(calls[0].body).toMatchObject({ key: me.did, ts: NOW })
    expect(verifyDidSignature(me.did, new TextEncoder().encode(`tw-del-v1\n${me.did}\n${NOW}`), calls[0].body.sig)).toBe(true)
  })
  it('sendIntent posts the signed intent', async () => {
    const { f, calls } = fake(() => answer(204))
    const i = makeIntent(sign(me), { to: eve.did, first: 'Ada', last: 'Lovelace', key: me.did, ts: NOW })
    expect(await sendIntent(deps(f), i)).toBe(true)
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'https://a.test/directory/intent', body: { intent: { to: eve.did } } })
  })
  it('pullIntents signs the pull and returns only valid intents addressed to me', async () => {
    const mine = makeIntent(sign(eve), { to: me.did, first: 'Eve', last: 'X', key: eve.did, ts: 5 })
    const wrongTo = makeIntent(sign(eve), { to: eve.did, first: 'Eve', last: 'X', key: eve.did, ts: 6 })
    const forged = { ...mine, from: { ...mine.from, first: 'Mallory' } }
    const { f, calls } = fake(() => answer(200, { intents: [mine, wrongTo, forged, 7] }))
    expect(await pullIntents(deps(f), me.did, sign(me))).toEqual([mine])
    expect(calls[0].url).toBe('https://a.test/directory/intents')
    expect(verifyDidSignature(me.did, new TextEncoder().encode(`tw-pull-v1\n${me.did}\n${NOW}`), calls[0].body.sig)).toBe(true)
  })
  it('a down server gives an empty list, not an error', async () => {
    expect(await pullIntents(deps(fake(() => new Error('x')).f), me.did, sign(me))).toEqual([])
    expect(await pullIntents(deps(fake(() => answer(500, {})).f), me.did, sign(me))).toEqual([])
  })
})
