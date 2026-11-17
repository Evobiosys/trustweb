// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c sync-seamless: delivery acks (A1), schema hold (A2), forwarding + stable sync id (A3), pairing link (A5). Two or three stock devices over a fake relay. */
import { AUTO_RETRY_MS, AUTO_TTL_MS, createSyncLink } from '../../src/sync_link.ts'
import { SCHEMA_VERSION } from '../../src/schema_version.ts'
import { HOP_MAX, PAIR_LINK_BASE, deltaOf, pairCodeFromHash, pairLink, pairingCode, parseBundle, parsePairingCode, refreshStamps, syncIdOf } from '../../src/sync_core.ts'

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

describe('A3 sync-forward + sync id', () => {
  const rounds = async (ds, n = 4) => { for (let i = 0; i < n; i++) { for (const d of ds) { d.tick(1000); await d.api.autoTick() } await settle() } }

  it('the stamp id of a device comes from its sync DID: short, stable, unique, independent of the name', () => {
    const did = (c) => 'did:peer:2.Vz6Mk' + c.repeat(44) + '.Ez6LS' + c.repeat(44) + '.SeyJ0' + 'x'.repeat(150)
    expect(syncIdOf(did('a'))).toBe(syncIdOf(did('a')))
    expect(syncIdOf(did('a'))).not.toBe(syncIdOf(did('b')))
    expect(syncIdOf(did('a')).length).toBeLessThanOrEqual(20)
  })

  it('a delta also holds what arrived from other devices (not back to the one it came from), and stops after HOP_MAX hops', () => {
    const s = state({ people: [person('a', 'Ada'), person('b', 'Bo'), person('c', 'Cy')] })
    const st = refreshStamps(s, {}, 100, 'B')
    st['p:a'] = { ...st['p:a'], at: 50, by: 'A', rx: 200, hp: 1 }
    st['p:b'] = { ...st['p:b'], at: 50, by: 'C', rx: 200, hp: 1 }
    st['p:c'] = { ...st['p:c'], at: 50, by: 'A', rx: 200, hp: HOP_MAX }
    const d = deltaOf(s, st, 150, 'B', ['C'])
    expect(d.people.map((p) => p.id)).toEqual(['a'])
    expect(d.hp).toEqual({ 'p:a': 1 })
    expect(parseBundle(JSON.parse(JSON.stringify(d))).hp).toEqual({ 'p:a': 1 })
  })

  it('three devices, two pairings: a change on either end reaches the other (and the middle)', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const phone = await device(h, 'Phone', state(), { auto: () => true })
    const tab = await device(h, 'Tablet', state(), { auto: () => true })
    await paired(h, mac, phone)
    await paired(h, phone, tab)
    await rounds([mac, phone, tab])
    expect(tab.st.people.map((p) => p.id)).toEqual(['a'])
    tab.st.people.push(person('z', 'Zed'))
    await rounds([mac, phone, tab], 5)
    expect(mac.st.people.map((p) => p.id).sort()).toEqual(['a', 'z'])
    mac.st.people[0].name = 'Ada L'
    await rounds([mac, phone, tab], 5)
    expect(tab.st.people.find((p) => p.id === 'a').name).toBe('Ada L')
  })

  it('two devices with the same name: a change from one reaches the other through the Mac and is not echoed to its origin', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', state(), { auto: () => true })
    const one = await device(h, 'Phone', state(), { auto: () => true, storage: mem() })
    const two = await device(h, 'Phone', state(), { auto: () => true, storage: mem() })
    await paired(h, mac, one)
    await paired(h, mac, two)
    await rounds([mac, one, two])
    const before = one.box.merged.length
    one.st.people.push(person('n', 'Nia'))
    await rounds([mac, one, two], 5)
    expect(two.st.people.map((p) => p.id)).toEqual(['n'])
    expect(one.box.merged.length).toBe(before) // nothing came back to its origin
  })

  it('a ring of three pairings converges and then goes quiet (no loop)', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true })
    const phone = await device(h, 'Phone', state(), { auto: () => true })
    const tab = await device(h, 'Tablet', state(), { auto: () => true })
    await paired(h, mac, phone); await paired(h, phone, tab); await paired(h, tab, mac)
    await rounds([mac, phone, tab], 4)
    mac.st.people.push(person('b', 'Bo'))
    await rounds([mac, phone, tab], 5)
    expect(tab.st.people.map((p) => p.id).sort()).toEqual(['a', 'b'])
    await rounds([mac, phone, tab], 2)
    const quiet = h.wires.length
    await rounds([mac, phone, tab], 3)
    expect(h.wires.length).toBe(quiet)
  })

  it('stamps of an earlier build (the device NAME in `by`) move to the sync id at start; the data stays', async () => {
    const h = hub()
    const store = mem()
    const first = await device(h, 'Mac', state({ people: [person('a', 'Ada')] }), { auto: () => true, storage: store })
    await first.api.autoTick()
    const raw = JSON.parse(store.getItem('trustweb.sync.v1.Mac'))
    raw.stamps = { 'p:a': { h: 'x', at: 5, by: 'Mac', from: 'Mac' } }
    store.setItem('trustweb.sync.v1.Mac', JSON.stringify(raw))
    first.api.stop()
    const again = await device(h, 'Mac', first.st, { auto: () => true, storage: store })
    const moved = JSON.parse(store.getItem('trustweb.sync.v1.Mac')).stamps['p:a']
    expect(moved.by).not.toBe('Mac')
    expect(moved.from).toBe(moved.by)
    expect(again.st.people).toHaveLength(1)
  })
})

describe('A5 pair-deeplink', () => {
  const DID1 = 'did:peer:2.Vz6Mk' + 'a'.repeat(44) + '.Ez6LS' + 'a'.repeat(44) + '.SeyJ0' + 'x'.repeat(150)
  const SECRET = 'abcdefghijklmnopqrstuv'

  it('the QR holds an https link of the app, so the phone camera app opens TrustWeb; the code is its fragment', () => {
    const link = pairLink(pairingCode(DID1, SECRET))
    expect(link).toBe(`${PAIR_LINK_BASE}#pair=${pairingCode(DID1, SECRET)}`)
    expect(link.startsWith('https://app.trustweb.one/')).toBe(true)
  })

  it('the code is read from a link of the app (either spelling), from a page fragment, and still from the bare code', () => {
    const code = pairingCode(DID1, SECRET)
    const want = { did: DID1, secret: SECRET }
    expect(parsePairingCode(pairLink(code))).toEqual(want)
    expect(parsePairingCode(`https://app.trustweb.one/pair#${code}`)).toEqual(want)
    expect(parsePairingCode(`#pair=${code}`)).toEqual(want)
    expect(parsePairingCode(`  ${code}  `)).toEqual(want)
    expect(parsePairingCode(`https://evil.example/#pair=${code}x~y`)).toBeNull()
    expect(parsePairingCode('https://app.trustweb.one/#pair=')).toBeNull()
    expect(pairCodeFromHash('#pair=' + code)).toBe(code)
    expect(pairCodeFromHash('#n=hello')).toBeNull()
  })

  it('a device joins from the link text alone', async () => {
    const h = hub()
    const mac = await device(h, 'Mac', state(), { auto: () => true })
    const phone = await device(h, 'Phone', state(), { auto: () => true })
    const r = await phone.api.join(pairLink(await mac.api.offerCode()))
    expect(r.fp).toMatch(/^[0-9A-F]{4}$/)
    await until(() => mac.box.requests.length === 1)
    expect(mac.box.requests[0].fp).toBe(r.fp)
  })
})

describe('A5 boot from a pairing link', () => {
  it('a fragment with a pair code is handed to the view once and cleared from the address bar; any other fragment is left alone', async () => {
    const { openPairLink } = await import('../../src/sync_pair_link.ts')
    const joined = []
    const cleared = []
    const view = { joinLink: async (c) => { joined.push(c) } }
    expect(openPairLink('#n=hi', view, () => cleared.push(1))).toBe(false)
    expect(openPairLink('', view, () => cleared.push(1))).toBe(false)
    expect(joined).toEqual([])
    expect(openPairLink('#pair=TWD1~x~y', view, () => cleared.push(1))).toBe(true)
    expect(joined).toEqual(['TWD1~x~y'])
    expect(cleared).toHaveLength(1)
  })
})
