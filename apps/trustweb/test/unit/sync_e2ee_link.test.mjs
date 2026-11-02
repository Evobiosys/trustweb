// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Device sync v2, the network part (src/sync_e2ee_link.ts) over a fake relay with the RelayChannel surface (sendRaw / onRawWire): pair by
 * code, compare the check, sync two record logs both ways. The relay keeps every wire it carried, so the tests can read them as the relay
 * operator would, replay them, reflect them and tamper with them.
 */
import { createE2eeSync } from '../../src/sync_e2ee_link.ts'
import { append, emptyLog, materialise } from '../../src/sync_log.ts'

const T = 1_800_000_000_000
const b64u = (b) => Buffer.from(b).toString('base64url')
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) } }
const tickAsync = () => new Promise((r) => setTimeout(r, 0))
async function settle() { for (let i = 0; i < 30; i++) await tickAsync() }

/** The relay: routes on `to`, keeps a copy of every wire, delivers through the recipient's onRawWire; `acked` records what the sink consumed. */
function relay() {
  const sinks = new Map()
  const wires = []
  const acked = []
  const deliver = async (to, from, payload) => {
    const ok = await sinks.get(to)?.(from, payload)
    acked.push({ to, from, payload, ok: ok === true })
    return ok
  }
  const channel = (did) => ({
    onRawWire: (cb) => { sinks.set(did, cb) },
    sendRaw: async (to, payload) => { wires.push({ to, from: did, payload }); await tickAsync(); await deliver(to, did, payload) },
  })
  return { channel, wires, acked, deliver }
}

async function identity() {
  const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  return { did: 'did:peer:2.Ez6LS' + b64u(pub), pub, priv: kp.privateKey }
}

async function device(net, name, registry, opts = {}) {
  const id = await identity()
  registry.set(id.did, id.pub)
  let log = emptyLog('dev-' + name)
  const events = { pair: [], merged: [], log: [] }
  const sync = createE2eeSync({
    relay: net.channel(id.did),
    did: id.did,
    ecdh: async (theirDid) => {
      const pub = registry.get(theirDid)
      const pk = await crypto.subtle.importKey('raw', pub, { name: 'X25519' }, false, [])
      return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: pk }, id.priv, 256))
    },
    deviceName: () => name,
    getLog: () => log,
    setLog: (l) => { log = l },
    storage: opts.storage ?? mem(),
    now: opts.now ?? (() => T),
    onPairRequest: (r) => events.pair.push(r),
    onMerged: (from, res) => events.merged.push({ from: from.name, ...res }),
    onLog: (l) => events.log.push(l),
  })
  sync.start()
  return {
    id, sync, events, name,
    get log() { return log },
    set log(l) { log = l },
    async edit(key, val, at = T) { ({ log } = await append(log, { key, op: 'put', val }, at)) },
  }
}

async function linked(net = relay()) {
  const reg = new Map()
  const phone = await device(net, 'phone', reg)
  const laptop = await device(net, 'laptop', reg)
  const offer = await laptop.sync.offer()
  const req = await phone.sync.join(offer.link)
  await settle()
  expect(laptop.events.pair).toHaveLength(1)
  const shown = laptop.events.pair[0]
  expect(shown.sas).toBe(req.sas)
  shown.confirm()
  req.confirm()
  await settle()
  return { net, reg, phone, laptop }
}

const person = (id, name) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines: [] })

describe('pairing over the relay', () => {
  it('both devices show the same six-digit check and list each other after Confirm', async () => {
    const { phone, laptop } = await linked()
    expect(phone.sync.devices().map((d) => d.name)).toEqual(['laptop'])
    expect(laptop.sync.devices().map((d) => d.name)).toEqual(['phone'])
    expect(phone.sync.devices()[0].sas).toMatch(/^\d{3} \d{3}$/)
  })
  it('the joining device learns the other name from its first sealed message, also when that arrives before its own Confirm', async () => {
    const net = relay()
    const reg = new Map()
    const laptop = await device(net, 'laptop', reg)
    const phone = await device(net, 'phone', reg)
    const req = await phone.sync.join((await laptop.sync.offer()).code)
    expect(req.name).toBe('Other device')
    await settle()
    laptop.events.pair[0].confirm()
    await settle()
    expect(phone.sync.devices()).toHaveLength(0)
    req.confirm()
    expect(phone.sync.devices().map((d) => d.name)).toEqual(['laptop'])
  })
  it('the offer is single use and nothing pairs without the secret from the code', async () => {
    const net = relay()
    const reg = new Map()
    const laptop = await device(net, 'laptop', reg)
    const phone = await device(net, 'phone', reg)
    const intruder = await device(net, 'intruder', reg)
    const offer = await laptop.sync.offer()
    const guessed = offer.code.replace(/~[^~]+$/, '~' + b64u(new Uint8Array(32)))
    await intruder.sync.join(guessed)
    await settle()
    expect(laptop.events.pair).toHaveLength(0)
    await phone.sync.join(offer.code)
    await settle()
    expect(laptop.events.pair).toHaveLength(1)
    await intruder.sync.join(offer.code)
    await settle()
    expect(laptop.events.pair).toHaveLength(1)
  })
  it('a device that only pressed Cancel keeps no pairing', async () => {
    const net = relay()
    const reg = new Map()
    const laptop = await device(net, 'laptop', reg)
    const phone = await device(net, 'phone', reg)
    const req = await phone.sync.join((await laptop.sync.offer()).code)
    await settle()
    laptop.events.pair[0].cancel()
    req.cancel()
    expect(laptop.sync.devices()).toHaveLength(0)
    expect(phone.sync.devices()).toHaveLength(0)
  })
})

describe('sync of two device logs over the relay', () => {
  it('edits made apart arrive on both, and the relay carried only ciphertext', async () => {
    const { net, phone, laptop } = await linked()
    await phone.edit('p:1', person('1', 'EXAMPLE-PHONE-MARKER'))
    await laptop.edit('p:2', person('2', 'EXAMPLE-LAPTOP-MARKER'))
    await phone.sync.syncNow(laptop.id.did)
    await settle()
    const mp = materialise(phone.log.ops)
    expect(mp).toEqual(materialise(laptop.log.ops))
    expect(Object.keys(mp.values).sort()).toEqual(['p:1', 'p:2'])
    expect(laptop.events.merged[0]).toMatchObject({ from: 'phone', added: 1 })
    expect(phone.events.merged[0]).toMatchObject({ from: 'laptop', added: 1 })
    for (const w of net.wires) {
      const seen = w.payload + Buffer.from(w.payload, 'base64url').toString('latin1')
      for (const s of ['MARKER', 'EXAMPLE', '"t":', 'p:1', 'phone', 'laptop', 'dev-']) expect(seen.includes(s)).toBe(false)
    }
  })
  it('a second sync sends only what the other side lacks', async () => {
    const { net, phone, laptop } = await linked()
    await phone.edit('p:1', person('1', 'one'))
    await phone.sync.syncNow(laptop.id.did)
    await settle()
    const before = net.wires.length
    const merges = laptop.events.merged.length
    await phone.sync.syncNow(laptop.id.did)
    await settle()
    expect(laptop.events.merged.slice(merges).every((m) => m.added === 0)).toBe(true)
    expect(net.wires.length - before).toBeLessThanOrEqual(2)
  })
  it('a wire the relay plays again is consumed once and changes nothing', async () => {
    const { net, phone, laptop } = await linked()
    const start = net.wires.length
    await phone.edit('p:1', person('1', 'one'))
    await phone.sync.syncNow(laptop.id.did)
    await settle()
    const merges = laptop.events.merged.length
    const copies = net.wires.slice(start).filter((w) => w.to === laptop.id.did)
    expect(copies.length).toBeGreaterThan(0)
    for (const w of copies) expect(await net.deliver(w.to, w.from, w.payload)).toBe(true)
    await settle()
    expect(laptop.events.merged.length).toBe(merges)
    expect(laptop.events.log.some((l) => /replay/i.test(l))).toBe(true)
  })
  it('a replay still fails after a restart, because the seen numbers are stored', async () => {
    const net = relay()
    const reg = new Map()
    const storage = mem()
    const phone = await device(net, 'phone', reg)
    const laptop = await device(net, 'laptop', reg, { storage })
    const req = await phone.sync.join((await laptop.sync.offer()).code)
    await settle()
    laptop.events.pair[0].confirm()
    req.confirm()
    await phone.edit('p:1', person('1', 'one'))
    await phone.sync.syncNow(laptop.id.did)
    await settle()
    const merges = laptop.events.merged.length
    laptop.sync.start()
    for (const w of net.wires.filter((x) => x.to === laptop.id.did)) await net.deliver(w.to, w.from, w.payload)
    await settle()
    expect(laptop.events.merged.length).toBe(merges)
  })
  it('a wire reflected back to its sender, a tampered wire or one claiming another sender is not accepted', async () => {
    const { net, phone, laptop } = await linked()
    await phone.edit('p:1', person('1', 'one'))
    await phone.sync.syncNow(laptop.id.did)
    await settle()
    const w = net.wires.find((x) => x.from === phone.id.did && x.to === laptop.id.did)
    expect(await net.deliver(phone.id.did, laptop.id.did, w.payload)).toBe(false)
    const raw = Buffer.from(w.payload, 'base64url')
    raw[raw.length - 3] ^= 0xff
    expect(await net.deliver(laptop.id.did, phone.id.did, raw.toString('base64url'))).toBe(false)
    expect(await net.deliver(laptop.id.did, 'did:peer:2.Ez6LSnotlinked0000000000000', w.payload)).toBe(false)
  })
  it('after unlink the other device can no longer write into this record', async () => {
    const { phone, laptop } = await linked()
    laptop.sync.unlink(phone.id.did)
    await phone.edit('p:1', person('1', 'one'))
    await phone.sync.syncNow(laptop.id.did)
    await settle()
    expect(laptop.log.ops).toHaveLength(0)
  })
  it('a re-pair starts a new epoch: wires from the old pairing no longer open', async () => {
    const { net, reg, phone, laptop } = await linked()
    await phone.edit('p:1', person('1', 'one'))
    await phone.sync.syncNow(laptop.id.did)
    await settle()
    const old = net.wires.filter((x) => x.to === laptop.id.did)
    laptop.sync.unlink(phone.id.did)
    phone.sync.unlink(laptop.id.did)
    const req = await phone.sync.join((await laptop.sync.offer()).code)
    await settle()
    laptop.events.pair.at(-1).confirm()
    req.confirm()
    for (const w of old) expect(await net.deliver(w.to, w.from, w.payload)).toBe(false)
    expect(reg.size).toBe(2)
  })
  it('a record larger than one frame travels as several frames, each under the relay limit', async () => {
    const { net, phone, laptop } = await linked()
    for (let i = 0; i < 40; i++) await phone.edit('p:' + i, { ...person(String(i), 'n' + i), context: 'x'.repeat(4000) }, T + i)
    await phone.sync.syncNow(laptop.id.did)
    await settle()
    expect(laptop.log.ops).toHaveLength(40)
    const big = net.wires.filter((x) => x.to === laptop.id.did)
    expect(big.length).toBeGreaterThan(2)
    for (const w of big) expect(w.payload.length).toBeLessThan(128 * 1024)
  })
})
