// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (msg-geb): the app side of the Geb bridge: pairing hash, stored pairing, thread mapping, calls. Pure. */
import { parsePairingHash, consumePairingHash, loadPairing, savePairing, PAIR_KEY, bridgeCall, toThreadSummaries, personForDid } from '../../src/ext/geb/bridge_client.ts'
import { checkRequest, parseConnections, parseInbox } from '../../../../scripts/geb-bridge/geb-bridge.mjs'

const tok = 'abcdefghijklmnopqrstuvwxyz0123456789_-AB'
const DID = 'did:peer:2.Ez6LSaaa.Vz6Mkbbb'
const store = () => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k), m }
}

describe('geb bridge pairing hash', () => {
  it('reads port and token', () => {
    expect(parsePairingHash(`#geb-bridge=4711.${tok}`)).toEqual({ port: 4711, token: tok })
  })
  it('refuses anything else', () => {
    for (const h of ['', '#', '#geb-bridge=', '#geb-bridge=80.' + tok, '#geb-bridge=70000.' + tok, '#geb-bridge=4711.short', '#geb-bridge=4711.' + tok + '!', '#book=1', '#x&geb-bridge=4711.' + tok]) expect(parsePairingHash(h)).toBe(null)
  })
  it('consume: stores once, strips the hash, leaves other hashes alone', () => {
    const s = store()
    const urls = []
    expect(consumePairingHash({ hash: `#geb-bridge=4711.${tok}`, pathname: '/', search: '?a=1' }, s, (u) => urls.push(u))).toBe(true)
    expect(urls).toEqual(['/?a=1'])
    expect(loadPairing(s)).toEqual({ port: 4711, token: tok })
    const t = store()
    expect(consumePairingHash({ hash: '#book=1', pathname: '/', search: '' }, t, (u) => urls.push(u))).toBe(false)
    expect(urls.length).toBe(1)
    expect(t.m.size).toBe(0)
  })
  it('a damaged stored pairing reads as not paired', () => {
    const s = store()
    s.setItem(PAIR_KEY, '{"port":"x"}')
    expect(loadPairing(s)).toBe(null)
    s.setItem(PAIR_KEY, 'not json')
    expect(loadPairing(s)).toBe(null)
    savePairing(s, { port: 5000, token: tok })
    expect(loadPairing(s)).toEqual({ port: 5000, token: tok })
  })
})

describe('geb threads in the Chat screen', () => {
  const people = [{ id: 'p1', name: 'Anna Test', peerId: 'peer-1', channels: { consensual: `https://app.consensu.al/connect?to=${DID}` } }, { id: 'p2', name: 'Ben' }]
  it('a thread whose DID is a person\'s Geb address is that person', () => {
    expect(personForDid(people, DID)?.id).toBe('p1')
    expect(personForDid(people, 'did:peer:2.Ez6LSzzz')).toBe(undefined)
  })
  it('maps to summaries, naming the person when known', () => {
    const r = toThreadSummaries([{ did: DID, title: 'x', lastAt: 5, unread: 2 }, { did: 'did:peer:2.Ez6LSzzz', title: 'Stranger', lastAt: 0, unread: 0 }], people)
    expect(r).toEqual([
      { id: DID, title: 'Anna Test', lastAt: 5, unread: 2, peerId: 'peer-1' },
      { id: 'did:peer:2.Ez6LSzzz', title: 'Stranger', lastAt: 0, unread: 0 },
    ])
  })
  it('junk from the bridge is dropped, not shown', () => {
    expect(toThreadSummaries([null, { title: 'no did' }, { did: DID }], people).length).toBe(1)
    expect(toThreadSummaries('x', people)).toEqual([])
  })
})

describe('geb bridge calls', () => {
  const pair = { port: 4711, token: tok }
  it('sends the token as a Bearer header to loopback only', async () => {
    let seen
    const fetchFn = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, json: async () => ({ ok: true }) } }
    expect(await bridgeCall(pair, '/status', undefined, fetchFn)).toEqual({ ok: true })
    expect(seen.url).toBe('http://127.0.0.1:4711/status')
    expect(seen.init.headers.authorization).toBe('Bearer ' + tok)
    expect(seen.init.credentials).toBe('omit')
  })
  it('a network failure or a refusal rejects (the host then says Geb is not reachable)', async () => {
    let failed = false
    await bridgeCall(pair, '/x', undefined, async () => { throw new TypeError('fetch failed') }).catch(() => { failed = true })
    expect(failed).toBe(true)
    failed = false
    await bridgeCall(pair, '/x', undefined, async () => ({ ok: false, status: 401, json: async () => ({}) })).catch(() => { failed = true })
    expect(failed).toBe(true)
  })
})

describe('geb bridge script, seen from the app', () => {
  it('the app origins it serves are exactly the allowlist the bridge enforces', () => {
    const g = (origin) => checkRequest({ port: 1, token: tok, method: 'GET', host: '127.0.0.1:1', origin, authorization: 'Bearer ' + tok }).ok
    expect(g('https://app.trustweb.one')).toBe(true)
    expect(g('https://app.consensu.al')).toBe(false)
  })
  it('its parsers survive the shapes Geb might print', () => {
    expect(parseConnections({ [DID]: { petname: 'Anna' } })[0].name).toBe('Anna')
    expect(parseInbox([{ from: DID, text: 'hi', at: 1700000000 }])[0].at).toBe(1700000000000)
  })
})
