// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c sync-seamless: delivery acks (A1), schema hold (A2), forwarding + stable sync id (A3), pairing link (A5). Two or three stock devices over a fake relay. */
import { AUTO_RETRY_MS, AUTO_TTL_MS, createSyncLink } from '../../src/sync_link.ts'
import { SCHEMA_VERSION } from '../../src/schema_version.ts'

const person = (id, name, over = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [], ...over })
const state = (over = {}) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
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
  return { api, box, st, tick: (ms) => { clock += ms }, did: () => api.pairings().map((x) => x.did) }
}

const until = async (f) => { for (let i = 0; i < 100; i++) { if (f()) return; await new Promise((r) => setTimeout(r, 20)) } throw new Error('timeout') }

async function paired(h, a, b) {
  const n = a.box.requests.length
  const req = await b.api.join(await a.api.offerCode())
  await until(() => a.box.requests.length === n + 1)
  req.confirm(); a.box.requests[n].confirm()
}


const both = paired
const settle = () => new Promise((r) => setTimeout(r, 60))

describe('A1 sync-ack', () => {
  it('autoSentAt advances only when the receiver acknowledges; the ack names the sender\'s stamp', async () => {
    const h = hub()
    let on = false
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const phone = await device(h, 'Phone', state(), { auto: () => on })
    await both(h, mac, phone)
    await mac.api.autoTick(); await settle()
    expect(mac.api.pairings()[0].autoSentAt ?? 0).toBe(0)
    expect(mac.api.status().unacked).toBe(1)
    on = true
    mac.tick(AUTO_RETRY_MS + 1)
    await mac.api.autoTick()
    await until(() => (mac.api.pairings()[0].autoSentAt ?? 0) > 0)
    expect(phone.st.people).toHaveLength(1)
    expect(mac.api.status().unacked).toBe(0)
  })

  it('an unacknowledged delta waits its backoff, then is sent again with a doubled wait', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const phone = await device(h, 'Phone', state(), { auto: () => false })
    await both(h, mac, phone)
    const dataTo = () => h.wires.filter((w) => w.from === mac.api.pairings()[0].did.length && false).length
    const count = () => h.wires.length
    await mac.api.autoTick(); await settle()
    const first = count()
    await mac.api.autoTick(); await settle()
    expect(count()).toBe(first) // inside the backoff: nothing
    mac.tick(AUTO_RETRY_MS + 1)
    await mac.api.autoTick(); await settle()
    expect(count()).toBeGreaterThan(first)
    const second = count()
    mac.tick(AUTO_RETRY_MS + 1)
    await mac.api.autoTick(); await settle()
    expect(count()).toBe(second) // the wait doubled
    mac.tick(AUTO_RETRY_MS + 1)
    await mac.api.autoTick(); await settle()
    expect(count()).toBeGreaterThan(second)
    void dataTo
  })

  it('a device that was off for longer than the relay horizon gets a full bundle by itself', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const phone = await device(h, 'Phone', state(), { auto: () => true })
    await both(h, mac, phone)
    await mac.api.autoTick()
    await until(() => (mac.api.pairings()[0].autoSentAt ?? 0) > 0)
    const phoneDid = mac.api.pairings()[0].did
    const sink = h.sinks.get(phoneDid)
    h.sinks.delete(phoneDid) // the phone is off: the relay holds nothing that reaches it
    mac.tick(1000)
    mac.st.people.push(person('b', 'Bo'))
    await mac.api.autoTick(); await settle()
    expect(phone.st.people.map((p) => p.id)).toEqual(['a'])
    mac.tick(AUTO_TTL_MS + 1000); phone.tick(AUTO_TTL_MS + 1000)
    phone.st.people.length = 0 // came back after a reinstall: lost its data too
    h.sinks.set(phoneDid, sink)
    await mac.api.autoTick()
    await until(() => phone.st.people.length === 2)
    await until(() => mac.api.status().unacked === 0)
  })

  it('an older build (no ack) keeps today\'s rule: autoSentAt moves on send', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const old = await device(h, 'Old', state(), { auto: () => true, autoVersion: 1 })
    await both(h, mac, old)
    await mac.api.autoTick()
    expect(mac.api.pairings()[0].autoSentAt).toBeGreaterThan(0)
  })
})

describe('A2 schema hold + banner', () => {
  const OLD = SCHEMA_VERSION - 1

  it('a device on an older schema holds newer pieces (not dropped), acknowledges them, counts them for the banner, and applies them after the update', async () => {
    const h = hub()
    const store = mem()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada'), person('c', 'Cy')] }), { auto: () => true })
    const old = await device(h, 'Phone', state(), { auto: () => true, schemaVersion: OLD, storage: store })
    await paired(h, mac, old)
    await mac.api.autoTick()
    await until(() => old.api.held().items === 2)
    expect(old.st.people).toHaveLength(0)
    expect(old.api.held().from).toEqual(['Mac'])
    await until(() => mac.api.status().unacked === 0)
    old.api.stop()
    const updated = await device(h, 'Phone', old.st, { auto: () => true, storage: store })
    await until(() => updated.st.people.length === 2)
    expect(updated.api.held().items).toBe(0)
  })

  it('pieces held by a device whose Auto sync is off are not held and not acknowledged; the sender re-sends once the peer reports the new version', async () => {
    const h = hub()
    const store = mem()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const old = await device(h, 'Phone', state(), { auto: () => false, schemaVersion: OLD, storage: store })
    await paired(h, mac, old)
    await mac.api.autoTick(); await settle()
    expect(old.api.held().items).toBe(0)
    expect(mac.api.status().unacked).toBe(1)
    old.api.stop()
    const updated = await device(h, 'Phone', old.st, { auto: () => true, storage: store })
    await updated.api.autoTick() // greets: its hello names the new schema
    await until(() => updated.st.people.length === 1) // no tick on the Mac and no backoff wait: the report alone triggers the re-send
  })

  it('a held set whose pairing is gone is dropped; one still newer than this build stays held', async () => {
    const h = hub()
    const store = mem()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const old = await device(h, 'Phone', state(), { auto: () => true, schemaVersion: OLD, storage: store })
    await paired(h, mac, old)
    await mac.api.autoTick()
    await until(() => old.api.held().items === 1)
    old.api.stop()
    const still = await device(h, 'Phone', old.st, { auto: () => true, schemaVersion: OLD, storage: store })
    expect(still.api.held().items).toBe(1)
    still.api.unlink(still.api.pairings()[0].did)
    still.api.stop()
    const gone = await device(h, 'Phone', old.st, { auto: () => true, storage: store })
    expect(gone.api.held().items).toBe(0)
  })
})
