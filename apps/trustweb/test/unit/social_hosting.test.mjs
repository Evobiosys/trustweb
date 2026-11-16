// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c social-hosting: friends-first hosting of name records. Several SocialHost nodes talk through an in-memory wire; the server is a fake. */
import { createIdentity, signBytes, verifyDidSignature } from '../../../demo/src/did.ts'
import { makeIntent, makeRecord } from '../../src/name_record.ts'
import { SocialHost, hostRings, mayHostFor, applyIntent, linkGlobal, markIntended, ONLINE_MS } from '../../src/social_hosting.ts'
import { cardForNewPeer } from '../../src/peer_cards.ts'

const ids = { ada: createIdentity('https://a.test'), ben: createIdentity('https://b.test'), cat: createIdentity('https://c.test'), eve: createIdentity('https://e.test') }
const sign = (id) => (b) => signBytes(id, b)
const NOW = 1_700_000_000_000

/** Each node has its own record state and a view of who its friends are (name -> ring). */
function world(spec, { serverRecords = [], serverUp = true } = {}) {
  const nodes = {}
  const sent = []
  const timers = []
  const serverCalls = []
  const server = { records: [...serverRecords], intents: [] }
  const dir = (name) => ({
    fetch: async (url, init = {}) => {
      serverCalls.push({ by: name, url, method: init.method ?? 'GET' })
      if (!serverUp) throw new Error('down')
      const body = init.body ? JSON.parse(init.body) : null
      if (init.method === 'PUT') { server.records.push(body.rec); return { status: 204, json: async () => null } }
      if (init.method === 'POST' && url.endsWith('/directory/intent')) { server.intents.push(body.intent); return { status: 204, json: async () => null } }
      if (url.includes('/directory?q=')) return { status: 200, json: async () => ({ records: server.records }) }
      return { status: 404, json: async () => ({}) }
    },
    origins: ['https://srv.test'], now: () => NOW, verify: verifyDidSignature,
  })
  for (const [name, cfg] of Object.entries(spec)) {
    const id = ids[name]
    const state = { trustedOnly: cfg.trustedOnly, hostFriends: cfg.hostFriends, people: [], peers: [], hosted: {}, nameCache: {}, intentsIn: [] }
    for (const [other, ring, extra] of cfg.friends ?? []) {
      state.peers.push({ id: `p-${other}`, did: ids[other].did, displayName: other, ring, connectedAt: 1 })
      state.people.push({ id: `u-${other}`, name: other, ring, peerId: `p-${other}`, metAt: 0, lines: [], context: '', ...(extra ?? {}) })
    }
    const node = new SocialHost({
      self: { did: id.did }, state: () => state, sign: sign(id), verify: verifyDidSignature, now: () => NOW, wait: () => new Promise((r) => timers.push(r)), dir: () => dir(name), save: () => undefined,
      send: async (toDid, msg) => { sent.push([name, Object.keys(ids).find((k) => ids[k].did === toDid), msg.k]); const to = Object.keys(ids).find((k) => ids[k].did === toDid); if (to && nodes[to]) { queue.push(() => nodes[to].node.onMessage(id.did, msg)) } },
    })
    nodes[name] = { node, state, id }
  }
  const queue = []
  const flush = async () => { while (queue.length) await queue.shift()() }
  return { nodes, flush, server, serverCalls, sent, expire: () => timers.splice(0).forEach((r) => r()) }
}
const record = (name, over = {}) => makeRecord(sign(ids[name]), { first: name === 'ada' ? 'Ada' : 'Ben', last: 'Lovelace', key: ids[name].did, ts: NOW, open: true, srv: true, ...over })

describe('who hosts (setting + trust)', () => {
  it('rings: off none, closest default, close adds Close', () => {
    expect(hostRings({})).toEqual(['closest'])
    expect(hostRings({ hostFriends: 'off' })).toEqual([])
    expect(hostRings({ hostFriends: 'close' })).toEqual(['closest', 'close'])
    expect(hostRings({ hostFriends: 'nonsense' })).toEqual(['closest'])
  })
  it('mayHostFor: ring in the setting, an override "no" blocks, trusted-only needs trust', () => {
    expect(mayHostFor({}, { ring: 'closest' })).toBe(true)
    expect(mayHostFor({}, { ring: 'close' })).toBe(false)
    expect(mayHostFor({ hostFriends: 'close' }, { ring: 'close' })).toBe(true)
    expect(mayHostFor({ hostFriends: 'close' }, { ring: 'close', trust: 'no' })).toBe(false)
    expect(mayHostFor({ hostFriends: 'off' }, { ring: 'closest' })).toBe(false)
    expect(mayHostFor({ trustedOnly: true, hostFriends: 'close' }, { ring: 'close', trust: 'no' })).toBe(false)
    expect(mayHostFor({}, { ring: 'friend' })).toBe(false)
  })
})

describe('publish and host', () => {
  it('the owner pushes to trusted friends, a Closest host stores it and adds itself to hosts[]', async () => {
    const w = world({ ada: { friends: [['ben', 'closest'], ['cat', 'friend']] }, ben: { friends: [['ada', 'closest']] }, cat: { friends: [['ada', 'friend']] } })
    const r = await w.nodes.ada.node.publish(record('ada'))
    await w.flush()
    expect(r.friends).toBe(1) // cat is only a Friend: not asked
    const held = w.nodes.ben.state.hosted[ids.ada.did]
    expect(held.key).toBe(ids.ada.did)
    expect(held.hosts).toEqual([ids.ben.did])
    expect(w.nodes.cat.state.hosted).toEqual({})
  })
  it('a host only accepts the owner\'s own record: another friend cannot put a record for a key that is not theirs', async () => {
    const w = world({ ben: { friends: [['ada', 'closest'], ['eve', 'closest']] }, eve: { friends: [['ben', 'closest']] } })
    await w.nodes.eve.node.publish(record('ada')) // signed by ada's key, sent by eve
    await w.flush()
    expect(w.nodes.ben.state.hosted).toEqual({})
  })
  it('a host refuses a bad signature, an owner it does not host for, and a stale ts', async () => {
    const w = world({ ben: { friends: [['ada', 'closest']] }, cat: { friends: [['ada', 'close']] }, eve: { friends: [['ada', 'closest']] } })
    const good = record('ada')
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: { ...good, last: 'Changed' } })
    expect(w.nodes.ben.state.hosted).toEqual({})
    await w.nodes.cat.node.onMessage(ids.ada.did, { k: 'put', rec: good }) // Close, host default is Closest only
    expect(w.nodes.cat.state.hosted).toEqual({})
    await w.nodes.eve.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada', { ts: NOW + 10 }) })
    await w.nodes.eve.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada', { ts: NOW }) })
    expect(w.nodes.eve.state.hosted[ids.ada.did].ts).toBe(NOW + 10)
  })
  it('drop removes the hosted record, from the owner only', async () => {
    const w = world({ ben: { friends: [['ada', 'closest'], ['eve', 'closest']] } })
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada') })
    await w.nodes.ben.node.onMessage(ids.eve.did, { k: 'drop' })
    expect(Object.keys(w.nodes.ben.state.hosted)).toHaveLength(1)
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'drop' })
    expect(w.nodes.ben.state.hosted).toEqual({})
  })
  it('publish also PUTs to the server when allowed and srv; never in trusted-only', async () => {
    const w = world({ ada: { friends: [] }, ben: { friends: [], trustedOnly: true } })
    const r = await w.nodes.ada.node.publish(record('ada'))
    expect(r.server).toBe(true)
    expect(w.serverCalls.filter((c) => c.method === 'PUT')).toHaveLength(1)
    const t = await w.nodes.ben.node.publish(record('ben', { srv: false }))
    expect(t.server).toBe(false)
    expect(w.serverCalls.filter((c) => c.by === 'ben')).toHaveLength(0)
  })
  it('a record that allows a server is not sent to one while trusted-only is on (the gate is the setting, not only the record)', async () => {
    const w = world({ ben: { friends: [], trustedOnly: true } })
    expect((await w.nodes.ben.node.publish(record('ben', { srv: true }))).server).toBe(false)
    expect(w.serverCalls).toHaveLength(0)
  })
})

describe('lookup order: friends, then server, then cache', () => {
  it('a friend that hosts the name answers; the server is not asked', async () => {
    const w = world({ cat: { friends: [['ben', 'closest']] }, ben: { friends: [['ada', 'closest'], ['cat', 'closest']] } })
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada') })
    const p = w.nodes.cat.node.lookup('ADA', 'lovelace')
    await w.flush(); await w.flush()
    const r = await p
    expect(r.via).toBe('friends')
    expect(r.records.map((x) => x.key)).toEqual([ids.ada.did])
    expect(w.serverCalls).toHaveLength(0)
  })
  it('no friend has it: the server answers and the result is cached', async () => {
    const w = world({ cat: { friends: [['ben', 'closest']] }, ben: { friends: [['cat', 'closest']] } }, { serverRecords: [record('ada')] })
    const p = w.nodes.cat.node.lookup('Ada', 'Lovelace')
    await w.flush(); await w.flush()
    const r = await p
    expect(r.via).toBe('server')
    expect(r.records).toHaveLength(1)
    expect(Object.keys(w.nodes.cat.state.nameCache)).toEqual(['ada lovelace'])
  })
  it('a friend that is not trusted is not asked', async () => {
    const w = world({ cat: { friends: [['ben', 'friend']] }, ben: { friends: [['cat', 'friend']] } }, { serverRecords: [record('ada')] })
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada') })
    const p = w.nodes.cat.node.lookup('Ada', 'Lovelace'); await w.flush()
    expect(w.sent.filter((m) => m[2] === 'get')).toEqual([])
    expect((await p).via).toBe('server')
  })
  it('a trusted friend with the override "not trusted" is not asked either', async () => {
    const w = world({ cat: { friends: [['ben', 'closest', { trust: 'no' }]] } })
    await w.nodes.cat.node.lookup('Ada', 'Lovelace')
    expect(w.sent).toEqual([])
  })
  it('a host answers only a trusted asker', async () => {
    const w = world({ ben: { friends: [['ada', 'closest'], ['cat', 'friend']] }, cat: { friends: [['ben', 'closest']] } })
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada') })
    await w.nodes.ben.node.onMessage(ids.cat.did, { k: 'get', q: 'q1', name: 'ada lovelace' })
    expect(w.sent).toEqual([])
  })
  it('server down: the cache serves, marked stale; an old cache entry does not', async () => {
    const w = world({ cat: { friends: [] } }, { serverUp: false })
    w.nodes.cat.state.nameCache['ada lovelace'] = { recs: [record('ada')], at: NOW - 60_000 }
    expect(await w.nodes.cat.node.lookup('Ada', 'Lovelace')).toMatchObject({ via: 'cache' })
    w.nodes.cat.state.nameCache['ada lovelace'] = { recs: [record('ada')], at: NOW - 8 * 86_400_000 }
    expect(await w.nodes.cat.node.lookup('Ada', 'Lovelace')).toMatchObject({ via: null, records: [] })
  })
  it('a friend that never answers: the wait runs out and the server is asked', async () => {
    const w = world({ cat: { friends: [['ben', 'closest']] } }, { serverRecords: [record('ada')] })
    const p = w.nodes.cat.node.lookup('Ada', 'Lovelace')
    await w.flush(); await new Promise((r) => setTimeout(r, 0)); w.expire()
    expect((await p).via).toBe('server')
  })
  it('trusted-only: friends only, the server is never touched, the cache may serve', async () => {
    const w = world({ cat: { trustedOnly: true, friends: [] } }, { serverRecords: [record('ada')] })
    const r = await w.nodes.cat.node.lookup('Ada', 'Lovelace')
    expect(r).toMatchObject({ via: null, records: [] })
    expect(w.serverCalls).toHaveLength(0)
  })
  it('a forged answer from a friend is ignored', async () => {
    const w = world({ cat: { friends: [['ben', 'closest']] } }, { serverRecords: [record('eve', { first: 'Zed', last: 'Q' })] })
    const p = w.nodes.cat.node.lookup('Ada', 'Lovelace')
    await w.nodes.cat.node.onMessage(ids.ben.did, { k: 'rec', q: 'wrong', recs: [record('ada')] })
    await w.flush(); await new Promise((r) => setTimeout(r, 0)); w.expire()
    expect(await p).toMatchObject({ records: [], via: null })
  })
  it('deep: friend hits and the server both count, when servers are allowed', async () => {
    const w = world({ cat: { friends: [['ben', 'closest']] }, ben: { friends: [['ada', 'closest'], ['cat', 'closest']] } }, { serverRecords: [record('eve', { first: 'Ada', last: 'Lovelace' })] })
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada') })
    const p = w.nodes.cat.node.lookup('Ada', 'Lovelace', { deep: true })
    await w.flush(); await w.flush()
    const r = await p
    expect(r.records.map((x) => x.key).sort()).toEqual([ids.ada.did, ids.eve.did].sort())
  })
})

describe('hand-off when the last host goes offline', () => {
  const hosted = async (w) => w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada') })
  it('the only host handing over: the signed record goes to the server', async () => {
    const w = world({ ben: { friends: [['ada', 'closest']] } })
    await hosted(w)
    const r = await w.nodes.ben.node.handOff()
    expect(r).toEqual({ handed: 1 })
    expect(w.server.records[0].key).toBe(ids.ada.did)
  })
  it('another host that was seen recently keeps it: nothing handed over', async () => {
    const w = world({ ben: { friends: [['ada', 'closest'], ['cat', 'closest']] } })
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: { ...record('ada'), hosts: [ids.cat.did] } })
    w.nodes.ben.node.seen(ids.cat.did)
    expect(await w.nodes.ben.node.handOff()).toEqual({ handed: 0 })
    expect(ONLINE_MS).toBe(10 * 60_000)
  })
  it('a host last seen long ago does not count as online', async () => {
    const w = world({ ben: { friends: [['ada', 'closest'], ['cat', 'closest']] } })
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: { ...record('ada'), hosts: [ids.cat.did] } })
    expect(await w.nodes.ben.node.handOff()).toEqual({ handed: 1 })
  })
  it('not handed over when the owner did not allow a server, or while trusted-only is on', async () => {
    const w = world({ ben: { friends: [['ada', 'closest']] } })
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada', { srv: false }) })
    expect(await w.nodes.ben.node.handOff()).toEqual({ handed: 0 })
    const t = world({ ben: { trustedOnly: true, friends: [['ada', 'closest']] } })
    await t.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada') })
    expect(await t.nodes.ben.node.handOff()).toEqual({ handed: 0 })
    expect(t.serverCalls).toHaveLength(0)
  })
})

describe('intend to connect', () => {
  const intent = (from, to) => makeIntent(sign(ids[from]), { to: ids[to].did, first: 'Eve', last: 'X', key: ids[from].did, ts: NOW })
  it('goes to the server when allowed', async () => {
    const w = world({ eve: { friends: [] } })
    expect(await w.nodes.eve.node.sendIntent(intent('eve', 'ada'))).toEqual({ server: true, friends: 0 })
    expect(w.server.intents).toHaveLength(1)
  })
  it('trusted-only: no server; handed to the trusted friends, who pass it on to the owner', async () => {
    const w = world({ eve: { trustedOnly: true, friends: [['ben', 'closest']] }, ben: { friends: [['eve', 'closest'], ['ada', 'closest']] }, ada: { friends: [['ben', 'closest']] } })
    await w.nodes.ben.node.onMessage(ids.ada.did, { k: 'put', rec: record('ada') })
    const r = await w.nodes.eve.node.sendIntent(intent('eve', 'ada'))
    await w.flush(); await w.flush()
    expect(r).toEqual({ server: false, friends: 1 })
    expect(w.serverCalls).toHaveLength(0)
    expect(w.nodes.ada.state.intentsIn.map((i) => i.from.key)).toEqual([ids.eve.did])
  })
  it('a forwarded intent that is not for this host\'s hosted owner is dropped; a bad signature is dropped', async () => {
    const w = world({ ben: { friends: [['eve', 'closest']] }, ada: { friends: [['ben', 'closest']] } })
    await w.nodes.ben.node.onMessage(ids.eve.did, { k: 'intent', intent: intent('eve', 'ada') })
    await w.flush()
    expect(w.nodes.ada.state.intentsIn).toEqual([])
    await w.nodes.ada.node.onMessage(ids.ben.did, { k: 'intent', intent: { ...intent('eve', 'ada'), ts: 1 } })
    expect(w.nodes.ada.state.intentsIn).toEqual([])
  })
})

describe('applyIntent', () => {
  const state = () => ({ people: [], peers: [] })
  const i = { to: 'did:me', from: { first: 'Eve', last: 'X', key: 'did:eve' }, ts: 5, sig: 's' }
  it('makes an Unsorted-ring person who reached out (the bell lists them, the ring paints them)', () => {
    const s = state()
    const p = applyIntent(s, i, () => 'id1', 99)
    expect(p).toMatchObject({ id: 'id1', name: 'Eve X', ring: 'intending', reachedOut: 'received', globalKey: 'did:eve', metAt: 99 })
    expect(s.people).toHaveLength(1)
  })
  it('the same key twice is one person; an already connected key is skipped', () => {
    const s = state()
    applyIntent(s, i, () => 'id1', 99); expect(applyIntent(s, i, () => 'id2', 100)).toBeNull()
    const t = { people: [], peers: [{ id: 'p', did: 'did:eve', displayName: 'Eve', ring: 'friend', connectedAt: 1 }] }
    expect(applyIntent(t, i, () => 'id3', 1)).toBeNull()
  })
  it('a blocked or archived earlier person with the same key stays out', () => {
    const s = { people: [{ id: 'old', name: 'Eve X', ring: 'none', globalKey: 'did:eve', blocked: 5, metAt: 0, lines: [], context: '' }], peers: [] }
    expect(applyIntent(s, i, () => 'id4', 1)).toBeNull()
  })
})

describe('a global person meets the connection that follows (both sides)', () => {
  const peer = { id: 'p1', did: 'did:eve', displayName: 'Eve', ring: 'acquaintance', connectedAt: 1 }
  it('cardForNewPeer gives the new connection the global card with its did, before any name guess', () => {
    const g = { id: 'g', name: 'Eve X', ring: 'intending', globalKey: 'did:eve', metAt: 0, lines: [], context: '' }
    const other = { id: 'o', name: 'Eve X', ring: 'friend', metAt: 0, lines: [], context: '' }
    expect(cardForNewPeer([other, g], peer, 'Eve X')).toBe(g)
    expect(cardForNewPeer([other, g], { id: 'p2', did: 'did:zed' }, '')).toBeUndefined()
  })
  it('linkGlobal makes it an ordinary person in the connection\'s ring and drops the "reached out" mark', () => {
    const g = { id: 'g', name: 'Eve X', ring: 'intending', reachedOut: 'sent', globalKey: 'did:eve', metAt: 0, lines: [], context: '' }
    linkGlobal(g, peer)
    expect(g).toMatchObject({ ring: 'acquaintance', peerId: 'p1', globalKey: 'did:eve' })
    expect('reachedOut' in g).toBe(false)
  })
  it('linkGlobal leaves a person who was sorted already, and any other person, alone', () => {
    const sorted = { id: 's', ring: 'close', globalKey: 'did:eve' }
    linkGlobal(sorted, peer); expect(sorted.ring).toBe('close')
    const other = { id: 'x', ring: 'intending', reachedOut: 'received' }
    linkGlobal(other, peer); expect(other.reachedOut).toBe('received')
  })
  it('markIntended: my own side of "Intend to connect" is one person on the Unsorted ring, once', () => {
    const s = { people: [], peers: [] }
    const p = markIntended(s, { first: 'Eve', last: 'X', key: 'did:eve' }, () => 'n1', 7)
    expect(p).toMatchObject({ id: 'n1', name: 'Eve X', ring: 'intending', reachedOut: 'sent', globalKey: 'did:eve' })
    expect(markIntended(s, { first: 'Eve', last: 'X', key: 'did:eve' }, () => 'n2', 8)).toBe(p)
    expect(s.people).toHaveLength(1)
  })
})

describe('what stays on this device (device sync)', () => {
  it('the listing is of THIS device\'s key, and the hosted records, cache and waiting intents are this phone\'s: none of them travels', async () => {
    const { SYNC_EXCLUDED, settingsOf } = await import('../../src/sync_core.ts')
    for (const k of ['discoverable', 'discoverOpen', 'hosted', 'nameCache', 'intentsIn']) expect(SYNC_EXCLUDED.has(k), k).toBe(true)
    const s = settingsOf({ v: 1, people: [], discoverable: true, discoverOpen: false, hosted: {}, nameCache: {}, intentsIn: [], hostFriends: 'close', trustedOnly: true, directoryServers: ['https://a.test'] })
    expect(Object.keys(s).sort()).toEqual(['directoryServers', 'hostFriends', 'trustedOnly'])
  })
})
