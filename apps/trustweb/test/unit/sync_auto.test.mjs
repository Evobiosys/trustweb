// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c sync-devices: connections travel, duplicate cards by peerId become one, deltas, tombstones, and the automatic sync over a fake relay. */
import { SYNC_EXCLUDED, bundleOf, deltaOf, dedupeByPeerId, mergeBundle, parseBundle, refreshStamps } from '../../src/sync_core.ts'
import { AUTO_TTL_MS, createSyncLink } from '../../src/sync_link.ts'

const line = (id, text = id) => ({ id, text, tag: 'note', audience: 'close', status: 'current', notedAt: 1, checkedAt: 1 })
const person = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...over })
const state = (over = {}) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
// as long as a real did:peer:2 (key part + service part): a stamp key built from the whole DID would break the bundle's 120-character key limit
const DID = (c) => 'did:peer:2.Vz6Mk' + c.repeat(44) + '.Ez6LS' + c.repeat(44) + '.SeyJ0' + 'x'.repeat(150)
const peer = (id, c, over = {}) => ({ id, displayName: 'Other', did: DID(c), ring: 'friend', connectedAt: 10, ...over })

describe('connections travel with the person', () => {
  it('the bundle carries peers without what only this device knows', () => {
    const s = state({ peers: [peer('o1', 'a', { heardAt: 11, ackTries: 2, ackSentAt: 12, askAgainDue: 13, askAgainSentAt: 14, toldDevices: 'x', synced: true, alsoDids: [DID('b')] })] })
    const b = bundleOf(s, refreshStamps(s, {}, 1, 'Mac'))
    expect(b.peers).toEqual([{ id: 'o1', displayName: 'Other', did: DID('a'), ring: 'friend', connectedAt: 10, alsoDids: [DID('b')] }])
    expect(Object.keys(b.at).filter((k) => k.startsWith('r:'))).toHaveLength(1)
    expect(Object.keys(b.at).every((k) => k.length <= 120)).toBe(true)
    expect(parseBundle(JSON.parse(JSON.stringify(b))).peers).toEqual(b.peers)
  })

  it('a malformed peer is dropped alone, the bundle still parses', () => {
    const s = state({ peers: [peer('o1', 'a')] })
    const raw = JSON.parse(JSON.stringify(bundleOf(s, refreshStamps(s, {}, 1, 'Mac'))))
    raw.peers.push({ id: 'x', did: 'not a did', displayName: 'X', ring: 'friend', connectedAt: 1 }, { id: '__proto__' })
    expect(parseBundle(raw).peers.map((p) => p.id)).toEqual(['o1'])
  })

  it('an unknown connection is added, marked synced and heard (no connect-ack from this device); a known one keeps this device\'s fields and unites alsoDids', () => {
    const mac = state({ peers: [peer('o1', 'a', { alsoDids: [DID('b')] }), peer('o2', 'c')] })
    const phone = state({ peers: [peer('o2', 'c', { heardAt: 50, ackTries: 1, alsoDids: [DID('d')] })] })
    const res = mergeBundle(phone, refreshStamps(phone, {}, 1, 'Phone'), bundleOf(mac, refreshStamps(mac, {}, 1, 'Mac')), 0)
    expect(res.added).toBeGreaterThanOrEqual(1)
    const o1 = phone.peers.find((p) => p.id === 'o1')
    expect(o1).toMatchObject({ did: DID('a'), synced: true, heardAt: 10, alsoDids: [DID('b')] })
    const o2 = phone.peers.find((p) => p.id === 'o2')
    expect(o2).toMatchObject({ heardAt: 50, ackTries: 1 })
    expect([...o2.alsoDids].sort()).toEqual([DID('d')])
    expect(phone.peers).toHaveLength(2)
  })

  it('wantsToConnect travels now (peer ids are the same on both devices); the auto switch and the status stay on the device', () => {
    expect(SYNC_EXCLUDED.has('wantsToConnect')).toBe(false)
    expect(SYNC_EXCLUDED.has('syncAutoOff')).toBe(true)
    expect(SYNC_EXCLUDED.has('syncStatus')).toBe(true)
  })
})

describe('one card per connection', () => {
  it('two cards with the same peerId become one: the richer one is kept, the other is listed in sameAs', () => {
    const s = state({ people: [person('x', 'Cecilia'), person('y', 'Cecilia B', { peerId: 'o1', lines: [line('l1')] }), person('z', 'Cecilia', { peerId: 'o1' })] })
    expect(dedupeByPeerId(s)).toBe(true)
    expect(s.people.map((p) => p.id).sort()).toEqual(['x', 'y'])
    expect(s.sameAs).toEqual({ z: 'y' })
    expect(dedupeByPeerId(s)).toBe(false)
  })

  it('a deleted card is not a duplicate', () => {
    const s = state({ people: [person('y', 'C', { peerId: 'o1' }), person('z', 'C', { peerId: 'o1', deleted_at: 5 })] })
    expect(dedupeByPeerId(s)).toBe(false)
  })

  it('a merge that brings a second card for the same connection collapses it (no duplicate in the chat list)', () => {
    const mac = state({ people: [person('m1', 'Cecilia', { peerId: 'o1', lines: [line('l1'), line('l2')] })], chats: { o1: { unread: 0, messages: [{ key: 'o:5:a', dir: 'out', text: 'hi', at: 5, sentAt: 5, state: 'delivered' }] } } })
    const phone = state({ people: [person('p1', 'Cecilia', { peerId: 'o1' })] })
    mergeBundle(phone, refreshStamps(phone, {}, 1, 'Phone'), bundleOf(mac, refreshStamps(mac, {}, 1, 'Mac')), 0)
    expect(phone.people.filter((p) => p.peerId === 'o1').map((p) => p.id)).toEqual(['m1'])
    expect(phone.sameAs).toEqual({ p1: 'm1' })
    expect(phone.chats.o1.messages).toHaveLength(1)
  })
})

describe('a reach-out answered on the other device', () => {
  it('the "Wants to connect" row goes once a card for that connection arrives', () => {
    const laptop = state({ wantsToConnect: [{ peerId: 'o1', name: 'Other', at: 5 }, { peerId: 'o2', name: 'Otto', at: 6 }], peers: [peer('o1', 'a', { reachOut: true })] })
    const phone = state({ people: [person('c1', 'Other', { peerId: 'o1', ring: 'acquaintance' })], peers: [peer('o1', 'a', { reachOut: true })] })
    mergeBundle(laptop, refreshStamps(laptop, {}, 1, 'Laptop'), bundleOf(phone, refreshStamps(phone, {}, 2, 'Phone')), 0)
    expect(laptop.people.map((p) => p.id)).toEqual(['c1'])
    expect(laptop.wantsToConnect).toEqual([{ peerId: 'o2', name: 'Otto', at: 6 }])
  })
})

describe('deltas and tombstones', () => {
  it('a delta holds only what this device changed after `since`; nothing changed = null', () => {
    const s = state({ people: [person('a', 'Ada'), person('b', 'Bo')], peers: [peer('o1', 'a')] })
    const st1 = refreshStamps(s, {}, 100, 'Mac')
    expect(deltaOf(s, st1, 0, 'Mac').people).toHaveLength(2)
    expect(deltaOf(s, st1, 100, 'Mac')).toBeNull()
    s.people[1].name = 'Bo B'
    const st2 = refreshStamps(s, st1, 200, 'Mac')
    const d = deltaOf(s, st2, 100, 'Mac')
    expect(d.people.map((p) => p.id)).toEqual(['b'])
    expect(d.peers).toEqual([])
    expect(Object.keys(d.at)).toEqual(['p:b'])
    expect(parseBundle(JSON.parse(JSON.stringify(d)))).not.toBeNull()
    // an entity whose kept version came from the other device is not echoed back
    const st3 = { ...st2, 'p:a': { ...st2['p:a'], at: 300, by: 'Phone' } }
    expect(deltaOf(s, st3, 200, 'Mac')).toBeNull()
  })

  it('a chat thread that changed travels in the delta', () => {
    const s = state({ chats: { o1: { unread: 0, messages: [] } } })
    const st1 = refreshStamps(s, {}, 100, 'Mac')
    s.chats.o1.messages.push({ key: 'i:5:a', dir: 'in', text: 'hey', at: 5, sentAt: 5, state: 'received' })
    const d = deltaOf(s, refreshStamps(s, st1, 200, 'Mac'), 100, 'Mac')
    expect(Object.keys(d.chats)).toEqual(['o1'])
  })

  it('a person deleted on one device is deleted on the other; a newer edit there keeps it alive', () => {
    const mac = state({ people: [person('a', 'Ada', { deleted_at: 500 })] })
    const phone = state({ people: [person('a', 'Ada')] })
    mergeBundle(phone, refreshStamps(phone, {}, 100, 'Phone'), bundleOf(mac, refreshStamps(mac, {}, 500, 'Mac')), 0)
    expect(phone.people[0].deleted_at).toBe(500)
    const phone2 = state({ people: [person('a', 'Ada L')] })
    mergeBundle(phone2, refreshStamps(phone2, {}, 900, 'Phone'), bundleOf(mac, refreshStamps(mac, {}, 500, 'Mac')), 0)
    expect(phone2.people[0].deleted_at).toBeUndefined()
  })
})

// ---- the automatic sync over a fake relay (same hub as sync_link.test.mjs) ----

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
globalThis.location = { origin: 'http://127.0.0.1:1' }

function hub() {
  const sinks = new Map()
  const wires = []
  const channel = () => {
    let did = ''
    let cb = null
    return {
      connect: async (id) => { did = id.did; sinks.set(did, cb) },
      onRawWire: (f) => { cb = f },
      sendRaw: async (to, payload) => { wires.push({ to, from: did, payload }); await new Promise((r) => setTimeout(r, 0)); sinks.get(to)?.(did, payload) },
      close: () => {}, onEnvelope: () => {}, onStatus: () => {}, send: async () => {},
    }
  }
  return { channel, wires, sinks }
}

async function device(h, name, st, extra = {}) {
  const box = { incoming: [], merged: [], requests: [], snapshots: 0 }
  let clock = 1_000_000
  const api = createSyncLink({
    persona: name, state: () => st, save: () => {}, deviceName: () => name, snapshot: async () => { box.snapshots++ }, channel: h.channel(), storage: mem(),
    onPairRequest: (r) => box.requests.push(r), onIncoming: (i) => box.incoming.push(i), onLog: () => {}, onChange: () => {}, handshakeMs: 300,
    onAutoMerged: (p, r) => box.merged.push(r), now: () => clock, ...extra,
  })
  await api.start()
  return { api, box, st, tick: (ms) => { clock += ms } }
}

const until = async (f) => { for (let i = 0; i < 100; i++) { if (f()) return; await new Promise((r) => setTimeout(r, 20)) } throw new Error('timeout') }

async function paired(h, a, b) {
  const n = a.box.requests.length
  const req = await b.api.join(await a.api.offerCode())
  await until(() => a.box.requests.length === n + 1)
  req.confirm(); a.box.requests[n].confirm()
}

describe('automatic sync', () => {
  it('after pairing, a tick sends the record without any sheet; the other merges it and sends its own; a second tick sends nothing', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada Lovelace', { peerId: 'o1' })], peers: [peer('o1', 'a')] }), { auto: () => true })
    const phone = await device(h, 'Phone', state({ people: [person('b', 'Ben Carter')] }), { auto: () => true })
    await paired(h, mac, phone)
    // the joiner learns the other's auto support from hello/ready
    await mac.api.autoTick(); await phone.api.autoTick()
    await until(() => mac.api.pairings()[0].au === 1 && phone.api.pairings()[0].au === 1)
    await mac.api.autoTick()
    await until(() => phone.st.people.length === 2)
    expect(phone.st.peers.map((p) => p.did)).toEqual([DID('a')])
    expect(phone.box.incoming).toHaveLength(0)
    expect(phone.box.snapshots).toBe(1)
    await phone.api.autoTick()
    await until(() => mac.st.people.length === 2)
    const sent = h.wires.length
    mac.tick(1000); phone.tick(1000)
    await mac.api.autoTick(); await phone.api.autoTick()
    await new Promise((r) => setTimeout(r, 50))
    expect(h.wires.length).toBe(sent)
    expect(h.wires.map((w) => w.payload).join('')).not.toContain('Ada Lovelace')
    expect(phone.api.status()).toMatchObject({ devices: 1 })
    expect(phone.api.status().lastAt).toBeGreaterThan(0)
  })

  it('a change after the first sync travels alone (delta) and arrives within one tick', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const phone = await device(h, 'Phone', state(), { auto: () => true })
    await paired(h, mac, phone)
    await mac.api.autoTick(); await phone.api.autoTick()
    await until(() => mac.api.pairings()[0].au === 1)
    await mac.api.autoTick()
    await until(() => phone.st.people.length === 1)
    mac.tick(5000)
    mac.st.people.push(person('c', 'Cy'))
    mac.st.peers.push(peer('o3', 'c'))
    await mac.api.autoTick()
    await until(() => phone.st.people.length === 2 && phone.st.peers.length === 1)
  })

  it('with Auto sync off on the receiver nothing is merged; an older device (no au) gets no auto pieces', async () => {
    const h = hub()
    let on = false
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const phone = await device(h, 'Phone', state(), { auto: () => on })
    await paired(h, mac, phone)
    await mac.api.autoTick()
    await until(() => mac.api.pairings()[0].au === 1)
    await mac.api.autoTick()
    await new Promise((r) => setTimeout(r, 80))
    expect(phone.st.people).toHaveLength(0)
    on = true
    const older = await device(h, 'Old', state(), { auto: () => true, autoVersion: 0 })
    await paired(h, mac, older)
    const before = h.wires.filter((w) => w.to === mac.api.pairings()[1].did).length
    await mac.api.autoTick()
    await new Promise((r) => setTimeout(r, 80))
    expect(mac.api.pairings()[1].au).toBeUndefined()
    expect(older.st.people).toHaveLength(0)
    expect(h.wires.filter((w) => w.to === mac.api.pairings()[1].did).length - before).toBeLessThanOrEqual(1) // at most the hello
  })

  it('auto pieces live 72 h (the relay hold), not 10 minutes', () => {
    expect(AUTO_TTL_MS).toBe(72 * 60 * 60_000)
  })
})
