// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * sync.ts end to end over a fake relay hub (the pattern of apps/trustweb/test/unit/sync_link.test.mjs, typed): one relay per device,
 * sendRaw pushes { to, from, payload } onto a shared `wires` list and delivers it asynchronously to the sink registered for `to`.
 * Every wire is kept, so a test can re-deliver, re-address or re-attribute it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromB64u, randomBytes, toB64u, utf8 } from './bytes.ts'
import { deviceKeysFromSecret, generateDeviceKeys } from './keys.ts'
import { memoryKeyStore } from './keystore.ts'
import type { KeyStore } from './keystore.ts'
import { RATCHET_INFO_CHAIN, RATCHET_INFO_MSG } from './ratchet.ts'
import { AAD_PREFIX } from './seal.ts'
import {
  CHUNK_BYTES,
  MAX_PIECES,
  OFFER_TTL_MS,
  PAIR_PREFIX,
  createDeviceSync,
  pairingCode,
  parsePairingCode,
} from './sync.ts'
import type { DeviceSync, Incoming, PairRequest, RelayLike, SyncData, SyncStorage } from './sync.ts'

type Sink = (from: string, payload: string) => boolean | void | Promise<boolean | void>
interface Wire { to: string; from: string; payload: string }

function hub() {
  const sinks = new Map<string, Sink>()
  const wires: Wire[] = []
  const relay = (address: string): RelayLike => ({
    sendRaw: async (to, payload) => {
      wires.push({ to, from: address, payload })
      setTimeout(() => void sinks.get(to)?.(address, payload), 0)
    },
    onRawWire: (cb) => {
      sinks.set(address, cb)
    },
  })
  return { relay, wires, sinks }
}
type Hub = ReturnType<typeof hub>

/** Storage that behaves like localStorage: what is saved is a JSON copy, never a live reference. */
function memStorage(): SyncStorage & { saved: () => SyncData | null; saves: () => number; put: (v: unknown) => void } {
  let raw: string | null = null
  let n = 0
  return {
    load: () => (raw === null ? null : (JSON.parse(raw) as unknown)),
    save: (d) => {
      raw = JSON.stringify(d)
      n++
    },
    /** Any blob, e.g. a v1 one for the migration test. */
    put: (v) => {
      raw = JSON.stringify(v)
    },
    saved: () => (raw === null ? null : (JSON.parse(raw) as SyncData)),
    saves: () => n,
  }
}

interface Dev {
  sync: DeviceSync
  address: string
  requests: PairRequest[]
  /** Every "Receive from <device>?" shown; auto-accepted unless the device was made with `prompt: true`. */
  incoming: Incoming[]
  logs: string[]
  storage: ReturnType<typeof memStorage>
  keyStore: KeyStore
}

async function device(
  h: Hub,
  name: string,
  address: string,
  opts: { storage?: ReturnType<typeof memStorage>; keyStore?: KeyStore; handshakeMs?: number; now?: () => number; prompt?: boolean } = {},
): Promise<Dev> {
  const requests: PairRequest[] = []
  const incoming: Incoming[] = []
  const logs: string[] = []
  const storage = opts.storage ?? memStorage()
  const keyStore = opts.keyStore ?? memoryKeyStore()
  const sync = await createDeviceSync({
    relay: h.relay(address),
    address,
    deviceName: () => name,
    storage,
    keyStore,
    handshakeMs: opts.handshakeMs ?? 3000,
    ...(opts.now ? { now: opts.now } : {}),
    onPairRequest: (r) => requests.push(r),
    onIncoming: (i) => {
      incoming.push(i)
      if (!opts.prompt) void i.accept()
    },
    onLog: (l) => logs.push(l),
  })
  return { sync, address, requests, incoming, logs, storage, keyStore }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function until(f: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (f()) return
    await sleep(5)
  }
  throw new Error('timeout')
}

/** a offers, b joins; both see the same SAS and confirm. */
async function link(a: Dev, b: Dev): Promise<string> {
  const before = a.requests.length
  const mine = await b.sync.join(await a.sync.offer())
  assert.ok(mine)
  await until(() => a.requests.length > before)
  const theirs = a.requests[a.requests.length - 1]
  assert.equal(theirs.sas, mine.sas)
  assert.equal(theirs.address, b.address)
  assert.equal(mine.address, a.address)
  await mine.confirm()
  await theirs.confirm()
  return mine.sas
}

const state = (d: Dev) => JSON.stringify(d.sync.materialize())
const ids = (d: Dev) => d.sync.log.entries().map((e) => e.id).sort()
const put = (id: string, field: string, value: unknown) => ({ t: 'put' as const, kind: 'item', id, field, value })

// Values long enough that they cannot appear in base64url ciphertext by chance.
const ENTITY_A = 'entity-alpha-0001'
const ENTITY_B = 'entity-bravo-0002'
const VALUE_A = 'alpha-plaintext-value'
const VALUE_B = 'bravo-plaintext-value'

test('pairing code: format, parse, garbage refused (QR only: there is no link form)', async () => {
  const k = await generateDeviceKeys()
  const secret = randomBytes(32)
  const code = pairingCode('addr-phone', k.publicKey, secret, 1_700_000_000_000)
  assert.equal(code, `${PAIR_PREFIX}~addr-phone~${toB64u(k.publicKey)}~${toB64u(secret)}~1700000000000`)
  const p = parsePairingCode(code)
  assert.ok(p)
  assert.equal(p.address, 'addr-phone')
  assert.deepEqual(p.publicKey, k.publicKey)
  assert.deepEqual(p.secret, secret)
  assert.equal(p.exp, 1_700_000_000_000)
  assert.ok(parsePairingCode(`  ${code}\n`), 'surrounding whitespace is tolerated')

  for (const bad of [
    '',
    'hello',
    code.replace(PAIR_PREFIX, 'TWD1'),
    code + '~extra',
    `${PAIR_PREFIX}~~${toB64u(k.publicKey)}~${toB64u(secret)}~1`,
    `${PAIR_PREFIX}~a|b~${toB64u(k.publicKey)}~${toB64u(secret)}~1`,
    `${PAIR_PREFIX}~addr~${toB64u(k.publicKey.slice(0, 31))}~${toB64u(secret)}~1`,
    `${PAIR_PREFIX}~addr~${toB64u(k.publicKey)}~${toB64u(secret.slice(0, 8))}~1`,
    `${PAIR_PREFIX}~addr~${toB64u(k.publicKey)}~not*b64~1`,
    `${PAIR_PREFIX}~addr~${toB64u(k.publicKey)}~${toB64u(secret)}~-5`,
    `${PAIR_PREFIX}~addr~${toB64u(k.publicKey)}~${toB64u(secret)}~1.5`,
    `${PAIR_PREFIX}~addr~${toB64u(k.publicKey)}~${toB64u(secret)}~99999999999999999999`,
  ]) {
    assert.equal(parsePairingCode(bad), null, bad)
  }
  assert.throws(() => pairingCode('a~b', k.publicKey, secret, 1))
  assert.equal(OFFER_TTL_MS, 600_000)
  assert.equal(CHUNK_BYTES, 45_000)
  assert.equal(MAX_PIECES, 200)
})

test('pair via code: same 6-digit SAS on both sides, confirm stores the pairing on both', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  const sas = await link(phone, laptop)
  assert.match(sas, /^\d{6}$/)
  const pp = phone.sync.pairings()
  const lp = laptop.sync.pairings()
  assert.equal(pp.length, 1)
  assert.equal(lp.length, 1)
  assert.equal(pp[0].address, 'addr-laptop')
  assert.equal(pp[0].deviceId, laptop.sync.deviceId)
  assert.equal(pp[0].name, 'Laptop')
  assert.equal(lp[0].deviceId, phone.sync.deviceId)
  assert.equal(pp[0].sas, sas)
  assert.equal(lp[0].sas, sas)
  assert.equal(pp[0].send.next, 1, 'the sending chain starts at counter 1')
  assert.equal(pp[0].recv.next, 1)
  assert.notEqual(pp[0].send.chain, pp[0].recv.chain, 'two directions, two chains')
  assert.equal(pp[0].send.chain, lp[0].recv.chain, 'my sending chain is their receiving chain')
  // Stored: the peer's public key and the ratchet chains; never the device's private key.
  const saved = JSON.stringify(phone.storage.saved())
  assert.ok(saved.includes(pp[0].publicKey))
  assert.ok(!saved.includes('secretKey'))
  assert.ok(await phone.keyStore.load(), 'the private key lives in the key store')
})

test('a code is one use; a code whose address is my own is refused; cancel stores nothing', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  const tablet = await device(h, 'Tablet', 'addr-tablet')
  const code = await phone.sync.offer()
  assert.equal(await phone.sync.join(code), null, 'own code')
  const r = await laptop.sync.join(code)
  assert.ok(r)
  await until(() => phone.requests.length === 1)
  assert.ok(await tablet.sync.join(code))
  await sleep(50)
  assert.equal(phone.requests.length, 1, 'the second join with the same code got no request')
  phone.requests[0].cancel()
  r.cancel()
  assert.equal(phone.sync.pairings().length, 0)
  assert.equal(laptop.sync.pairings().length, 0)
})

test('an expired code is refused by join; an expired offer ignores a pair wire', async () => {
  const h = hub()
  let t = 1_000_000
  const now = () => t
  const phone = await device(h, 'Phone', 'addr-phone', { now })
  const laptop = await device(h, 'Laptop', 'addr-laptop', { now })
  const k = await generateDeviceKeys()
  assert.equal(await laptop.sync.join(pairingCode('addr-phone', k.publicKey, randomBytes(32), t - 1)), null)

  const code = await phone.sync.offer()
  assert.equal(parsePairingCode(code)?.exp, t + OFFER_TTL_MS)
  assert.ok(await laptop.sync.join(code))
  await until(() => phone.requests.length === 1)

  // a fresh offer whose pair wire arrives after the offer expired is not ours
  h.sinks.delete('addr-phone')
  const code2 = await phone.sync.offer()
  assert.ok(await laptop.sync.join(code2))
  const late = h.wires[h.wires.length - 1]
  t += OFFER_TTL_MS + 1
  assert.equal(await laptop.sync.join(code2), null, 'join refuses the now expired code')
  assert.equal(await phone.sync.handle(late.from, late.payload), false)
  t -= OFFER_TTL_MS + 1 // back inside the window: the same wire is accepted, so it was the expiry that refused it
  assert.equal(await phone.sync.handle(late.from, late.payload), true)
  assert.equal(phone.requests.length, 2)
})

test('syncNow converges both logs and the materialized state; the relay sees no plaintext and no entity id', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  await phone.sync.append(put(ENTITY_A, 'title', VALUE_A))
  await phone.sync.append(put(ENTITY_A, 'note', 'charlie-plaintext-note'))
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  await laptop.sync.append({ t: 'del', kind: 'item', id: 'entity-delta-0004' })

  const start = h.wires.length
  const report = await phone.sync.syncNow('addr-laptop')
  assert.equal(report.received, 2)
  assert.equal(report.merge.added, 2)
  assert.deepEqual(report.merge.rejected, [])
  await until(() => laptop.sync.log.entries().length === 4)
  assert.equal(report.sent, 2)

  assert.deepEqual(ids(phone), ids(laptop))
  assert.equal(state(phone), state(laptop))
  const m = phone.sync.materialize()
  assert.equal(m.entities['item']?.[ENTITY_A]?.['title'], VALUE_A)
  assert.equal(m.entities['item']?.[ENTITY_B]?.['title'], VALUE_B)
  assert.ok(phone.sync.pairings()[0].lastSyncAt > 0)

  // have, entries (answer), entries (reply)
  const round = h.wires.slice(start)
  assert.deepEqual(round.map((w) => `${w.from}>${w.to}`), ['addr-phone>addr-laptop', 'addr-laptop>addr-phone', 'addr-phone>addr-laptop'])
  const all = h.wires.map((w) => w.payload).join('\n')
  for (const s of [ENTITY_A, ENTITY_B, VALUE_A, VALUE_B, 'charlie-plaintext-note', 'entity-delta-0004', 'Phone', 'Laptop', 'title', phone.sync.deviceId, laptop.sync.deviceId]) {
    assert.ok(!all.includes(s), `wire contains ${s}`)
  }

  // A second round has nothing to move.
  const again = await laptop.sync.syncNow('addr-phone')
  assert.equal(again.received, 0)
  assert.equal(again.sent, 0)
})

test('replay: re-delivering a captured entries wire changes nothing; it is consumed (acked) so the relay stops redelivering', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  const start = h.wires.length
  await phone.sync.syncNow('addr-laptop')
  await sleep(20)
  const toPhone = h.wires.slice(start).filter((w) => w.to === 'addr-phone')
  assert.equal(toPhone.length, 1)
  const before = { n: phone.sync.log.entries().length, s: state(phone), saves: phone.storage.saves() }
  for (const w of toPhone) assert.equal(await phone.sync.handle(w.from, w.payload), true, 'authentic but seen: consumed, not processed')
  await sleep(20)
  assert.equal(phone.sync.log.entries().length, before.n)
  assert.equal(state(phone), before.s)
  assert.equal(phone.storage.saves(), before.saves)
  assert.equal(h.wires.length, start + 3, 'a replayed wire triggers no answer')

  // a replayed `have` is not answered either
  const haveWire = h.wires[start]
  assert.equal(await laptop.sync.handle(haveWire.from, haveWire.payload), true)
  await sleep(20)
  assert.equal(h.wires.length, start + 3)
})

test('a wire re-attributed to another linked address, or to an unlinked one, is ignored', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop', { handshakeMs: 200 })
  const tablet = await device(h, 'Tablet', 'addr-tablet')
  await link(phone, laptop)
  await link(phone, tablet)
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  await tablet.sync.append(put(ENTITY_A, 'title', VALUE_A))

  // Capture a fresh wire without delivering it: laptop's `have` to phone.
  h.sinks.delete('addr-phone')
  await assert.rejects(laptop.sync.syncNow('addr-phone'), /offline/)
  const haveWire = h.wires.filter((w) => w.from === 'addr-laptop' && w.to === 'addr-phone').pop()
  assert.ok(haveWire)
  h.sinks.set('addr-phone', (f, p) => phone.sync.handle(f, p))

  const n = h.wires.length
  assert.equal(await phone.sync.handle('addr-tablet', haveWire.payload), false, 'outer from swapped to another linked device')
  assert.equal(await phone.sync.handle('addr-stranger', haveWire.payload), false, 'unlinked address')
  await phone.sync.offer() // even with an offer open, a non-pair wire from a stranger is not ours
  assert.equal(await phone.sync.handle('addr-stranger', haveWire.payload), false)
  assert.equal(await tablet.sync.handle('addr-laptop', haveWire.payload), false, 're-addressed to another device')
  await sleep(20)
  assert.equal(h.wires.length, n, 'nothing was answered')
  // the genuine wire is still accepted once (it was never consumed)
  assert.equal(await phone.sync.handle('addr-laptop', haveWire.payload), true)
  const fromPhone = () => h.wires.filter((w) => w.from === 'addr-phone').length
  const answered = fromPhone()
  assert.equal(await phone.sync.handle('addr-laptop', haveWire.payload), true, 'seen again: consumed without a second answer')
  await sleep(20)
  assert.equal(fromPhone(), answered)
})

test('a have from an unlinked device is ignored', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  const tablet = await device(h, 'Tablet', 'addr-tablet', { handshakeMs: 200 })
  await link(phone, laptop)
  await link(tablet, laptop)
  // tablet has a genuine `have` for laptop; delivered to phone (unlinked to tablet) it is not ours
  h.sinks.delete('addr-laptop')
  await assert.rejects(tablet.sync.syncNow('addr-laptop'), /offline/)
  const w = h.wires.filter((x) => x.from === 'addr-tablet').pop()
  assert.ok(w)
  assert.equal(await phone.sync.handle('addr-tablet', w.payload), false)
})

test('after unlink a wire from that device is ignored, and syncNow says not linked', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop', { handshakeMs: 200 })
  await link(phone, laptop)
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  phone.sync.unlink('addr-laptop')
  assert.equal(phone.sync.pairings().length, 0)
  assert.equal(phone.storage.saved()?.pairings.length, 0)
  await assert.rejects(phone.sync.syncNow('addr-laptop'), /not linked/)
  await assert.rejects(laptop.sync.syncNow('addr-phone'), /offline/)
  const w = h.wires[h.wires.length - 1]
  assert.equal(await phone.sync.handle(w.from, w.payload), false)
  assert.equal(phone.sync.log.entries().length, 0)
})

test('syncNow rejects offline when the peer never answers', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone', { handshakeMs: 200 })
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  h.sinks.delete('addr-laptop')
  const t0 = Date.now()
  await assert.rejects(phone.sync.syncNow('addr-laptop'), /offline/)
  assert.ok(Date.now() - t0 >= 150)
})

test('a third device pairs with both and all three converge', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  const tablet = await device(h, 'Tablet', 'addr-tablet')
  await link(phone, laptop)
  await link(tablet, phone)
  await link(laptop, tablet)
  assert.equal(tablet.sync.pairings().length, 2)
  await phone.sync.append(put(ENTITY_A, 'title', VALUE_A))
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  await tablet.sync.append(put('entity-echo-0005', 'title', 'echo'))
  // concurrent edits of one field on two devices
  await phone.sync.append(put('entity-shared-0006', 'title', 'from-phone'))
  await tablet.sync.append(put('entity-shared-0006', 'title', 'from-tablet'))

  await phone.sync.syncNow('addr-laptop')
  await tablet.sync.syncNow('addr-laptop')
  await phone.sync.syncNow('addr-tablet')
  await sleep(20)
  assert.equal(phone.sync.log.entries().length, 5)
  assert.deepEqual(ids(phone), ids(laptop))
  assert.deepEqual(ids(phone), ids(tablet))
  assert.equal(state(phone), state(laptop))
  assert.equal(state(phone), state(tablet))
  assert.equal(phone.sync.materialize().conflicts.length, 1)
})

test('persistence: a device recreated from its saved SyncData and key store keeps pairing, keys, log and ratchet state', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  await phone.sync.append(put(ENTITY_A, 'title', VALUE_A))
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  const start = h.wires.length
  await phone.sync.syncNow('addr-laptop')
  await sleep(20)
  const captured = h.wires.slice(start).filter((w) => w.to === 'addr-phone')
  const saved = phone.storage.saved()
  assert.ok(saved)
  assert.equal(saved.v, 2)
  assert.equal(saved.pairings[0].send.next, 3, 'two sends since linking')

  const again = await device(h, 'Phone', 'addr-phone', { storage: phone.storage, keyStore: phone.keyStore })
  assert.equal(again.sync.deviceId, phone.sync.deviceId)
  assert.deepEqual(again.sync.pairings(), phone.sync.pairings())
  assert.deepEqual(ids(again), ids(phone))
  assert.equal(state(again), state(phone))
  for (const w of captured) assert.equal(await again.sync.handle(w.from, w.payload), true, 'replay state survived the restart: consumed, not applied')
  assert.deepEqual(ids(again), ids(phone))

  // the recreated device keeps syncing with the same keys and counters
  await laptop.sync.append(put(ENTITY_B, 'note', 'foxtrot'))
  const r = await again.sync.syncNow('addr-laptop')
  assert.equal(r.received, 1)
  await sleep(20)
  assert.equal(state(again), state(laptop))
})

test('a crash before persist cannot double-apply: re-delivery after restart merges idempotently', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  await laptop.sync.append(put(ENTITY_B, 'note', 'golf'))
  const beforeRound = phone.storage.saved()
  assert.ok(beforeRound)

  const start = h.wires.length
  await phone.sync.syncNow('addr-laptop')
  await sleep(20)
  const entriesWire = h.wires.slice(start).find((w) => w.to === 'addr-phone')
  assert.ok(entriesWire)
  const after = phone.storage.saved()
  assert.ok(after)

  // (1) The crash happened before the wire was persisted: storage still holds the state before it. Re-delivery applies it once.
  const s1 = memStorage()
  s1.save(beforeRound)
  const r1 = await device(h, 'Phone', 'addr-phone', { storage: s1, keyStore: phone.keyStore })
  assert.equal(await r1.sync.handle(entriesWire.from, entriesWire.payload), true)
  await sleep(20)
  assert.equal(await r1.sync.handle(entriesWire.from, entriesWire.payload), true, 'second delivery: consumed, not applied')
  assert.equal(r1.sync.log.entries().length, 2)
  assert.equal(state(r1), state(laptop))

  // (2) Worst case: the log was saved but the ratchet state was not (the key for that counter still exists). The wire is accepted
  // again; the merge adds nothing.
  const s2 = memStorage()
  s2.save({ ...after, pairings: beforeRound.pairings })
  const r2 = await device(h, 'Phone', 'addr-phone', { storage: s2, keyStore: phone.keyStore })
  const stateBefore = state(r2)
  assert.equal(await r2.sync.handle(entriesWire.from, entriesWire.payload), true)
  await sleep(20)
  assert.equal(r2.sync.log.entries().length, 2)
  assert.equal(state(r2), stateBefore)
})

test('re-pairing the same two devices derives new keys: a wire captured under the earlier pairing does not open', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop', { handshakeMs: 200 })
  const sas1 = await link(phone, laptop)
  const id1 = phone.sync.pairings()[0].pairId
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  const start = h.wires.length
  await phone.sync.syncNow('addr-laptop')
  await sleep(20)
  const old = h.wires.slice(start).filter((w) => w.to === 'addr-phone')
  assert.equal(old.length, 1)

  phone.sync.unlink('addr-laptop')
  laptop.sync.unlink('addr-phone')
  const sas2 = await link(phone, laptop)
  const id2 = phone.sync.pairings()[0].pairId
  assert.notEqual(id2, id1, 'a fresh secret gives a fresh pairing id')
  assert.notEqual(sas2, sas1, 'and a fresh SAS')
  assert.equal(phone.sync.pairings()[0].recv.next, 1)

  // The chains restarted at 1, but the old wire is under the old roots: it does not open, so it is neither applied nor acked.
  assert.equal(await phone.sync.handle(old[0].from, old[0].payload), false)
  // The new pairing still syncs.
  await laptop.sync.append(put(ENTITY_B, 'note', 'hotel'))
  await phone.sync.syncNow('addr-laptop')
  await sleep(20)
  assert.equal(state(phone), state(laptop))
})

test('confirm is one decision: a second confirm throws and resets nothing; a stale confirm after unlink cannot revive the pairing', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop', { handshakeMs: 200 })
  const mine = await laptop.sync.join(await phone.sync.offer())
  assert.ok(mine)
  await until(() => phone.requests.length === 1)
  const theirs = phone.requests[0]
  await mine.confirm()
  await theirs.confirm()
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  await phone.sync.syncNow('addr-laptop')
  await sleep(20)
  const recvBefore = phone.sync.pairings()[0].recv
  assert.ok(recvBefore.next > 1)
  await assert.rejects(theirs.confirm(), /already decided/)
  assert.deepEqual(phone.sync.pairings()[0].recv, recvBefore, 'a double tap resets no chain')

  phone.sync.unlink('addr-laptop')
  const stale = await laptop.sync.join(await phone.sync.offer())
  assert.ok(stale)
  await until(() => phone.requests.length === 2)
  const staleReq = phone.requests[1]
  // the person unlinks again before deciding the sheet: the sheet's confirm must not bring the pairing back
  await staleReq.confirm()
  phone.sync.unlink('addr-laptop')
  assert.equal(phone.sync.pairings().length, 0)
  await assert.rejects(staleReq.confirm(), /already decided/)
  assert.equal(phone.sync.pairings().length, 0)
  // and a request whose epoch was unlinked before it was ever confirmed is refused too
  const req3 = await laptop.sync.join(await phone.sync.offer())
  assert.ok(req3)
  await until(() => phone.requests.length === 3)
  const third = phone.requests[2]
  await third.confirm()
  phone.sync.unlink('addr-laptop')
  await assert.rejects(third.confirm(), /already decided|unlinked/)
  assert.equal(phone.sync.pairings().length, 0)
})

test('a device restored from an older backup: its first sync is dropped on the peer (used counters), the next one catches up without re-pairing', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone', { handshakeMs: 200 })
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  await phone.sync.append(put(ENTITY_A, 'title', VALUE_A))
  const backup = phone.storage.saved()
  assert.ok(backup)
  for (let i = 0; i < 3; i++) {
    await laptop.sync.append(put(ENTITY_B, 'n' + i, 'v' + i))
    await phone.sync.syncNow('addr-laptop')
    await sleep(20)
  }
  const s = memStorage()
  s.save(backup)
  const restored = await device(h, 'Phone', 'addr-phone', { storage: s, keyStore: phone.keyStore, handshakeMs: 200 })
  const nextBefore = restored.sync.pairings()[0].send.next
  // its `have` goes out under a counter the laptop already consumed: dropped there (no key can tell a restore from a replay), never answered
  await assert.rejects(restored.sync.syncNow('addr-laptop'), /offline/)
  assert.ok(laptop.logs.some((l) => l.includes('already used') && l.includes('restored from a backup')), 'the laptop logs the likely cause')
  await until(() => restored.sync.pairings()[0].send.next >= nextBefore + 32).catch(() => assert.fail('the sending chain was moved ahead'))
  // the next try passes the laptop's position: no re-pairing needed, nothing lost
  const r = await restored.sync.syncNow('addr-laptop')
  assert.equal(r.received, 3)
  await sleep(20)
  assert.equal(state(restored), state(laptop))
})

test('two wires handled at once cannot bring a used key back', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop', { handshakeMs: 300 })
  await link(phone, laptop)
  for (let i = 0; i < 20; i++) await phone.sync.append(put('item-' + i, 'blob', 'z'.repeat(3000)))
  // laptop asks; phone's answer (several pieces, consecutive counters 1, 2, ...) is captured, not delivered
  h.sinks.delete('addr-laptop')
  await assert.rejects(laptop.sync.syncNow('addr-phone'), /offline/)
  const pieces = h.wires.filter((w) => w.from === 'addr-phone' && w.to === 'addr-laptop')
  assert.ok(pieces.length >= 2)
  h.sinks.set('addr-laptop', (f, p) => laptop.sync.handle(f, p))
  const [w1, w2] = pieces
  const results = await Promise.all([laptop.sync.handle(w1.from, w1.payload), laptop.sync.handle(w2.from, w2.payload)])
  assert.deepEqual(results, [true, true])
  const recv = laptop.sync.pairings()[0].recv
  assert.equal(recv.next, 3)
  assert.deepEqual(Object.keys(recv.skipped), [], 'no used key came back')
  assert.equal(await laptop.sync.handle(w1.from, w1.payload), true, 'replayed: consumed')
  assert.equal(await laptop.sync.handle(w2.from, w2.payload), true)
  assert.deepEqual(laptop.sync.pairings()[0].recv, recv)
})

test('fast-forward is capped: unanswered tries never move the chain out of the peer\'s skipped-key window', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone', { handshakeMs: 30 })
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  h.sinks.delete('addr-laptop') // the relay loses everything
  let refused = 0
  for (let i = 0; i < 80; i++) await phone.sync.syncNow('addr-laptop').catch((e: Error) => { if (e.message === 'pair again') refused++; else assert.match(e.message, /offline/) })
  await sleep(20)
  const p = phone.sync.pairings()[0]
  assert.ok(p.send.next - p.sendBase <= 1024 - 1, `jumped ${p.send.next - p.sendBase}`)
  assert.ok(refused > 0, 'past the cap syncNow refuses instead of moving further away')
  assert.ok(phone.logs.some((l) => l.includes('pair the two devices again')))
  // at the cap the pairing is stuck by design (sending more would only move further away): pairing again recovers, nothing is lost
  h.sinks.set('addr-laptop', (f, pl) => laptop.sync.handle(f, pl))
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  await assert.rejects(phone.sync.syncNow('addr-laptop'), /pair again/)
  phone.sync.unlink('addr-laptop')
  laptop.sync.unlink('addr-phone')
  await link(phone, laptop)
  const r = await phone.sync.syncNow('addr-laptop')
  assert.equal(r.received, 1)
  await sleep(20)
  assert.equal(state(phone), state(laptop))
  assert.equal(phone.sync.pairings()[0].sendBase, phone.sync.pairings()[0].send.next - 1, 'the base follows the answered have')
})

test('a key store that cannot be read fails closed: no new keys, the record blob is untouched', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  await phone.sync.append(put(ENTITY_A, 'title', VALUE_A))
  const blobBefore = JSON.stringify(phone.storage.saved())
  const saves = phone.storage.saves()
  const broken: KeyStore = { load: async () => { throw new Error('IndexedDB is not available') }, save: async () => undefined, clear: async () => undefined }
  await assert.rejects(device(h, 'Phone', 'addr-phone', { storage: phone.storage, keyStore: broken }), /IndexedDB/)
  assert.equal(JSON.stringify(phone.storage.saved()), blobBefore)
  assert.equal(phone.storage.saves(), saves, 'nothing was written')
  // a blob whose log belongs to another key is refused too, instead of being overwritten
  await assert.rejects(device(h, 'Phone', 'addr-phone', { storage: phone.storage, keyStore: memoryKeyStore() }), /belongs to device/)
  assert.equal(JSON.stringify(phone.storage.saved()), blobBefore)
})

test('a pending Receive prompt dies with the pairing: accept after unlink merges nothing and sends nothing; the sync clock waits for the person', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone', { prompt: true, handshakeMs: 200 })
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  const round = phone.sync.syncNow('addr-laptop')
  await until(() => phone.incoming.length === 1)
  // the person takes longer than the handshake: the peer did answer, so the sync does not time out
  await sleep(400)
  const wiresBefore = h.wires.length
  const ended = assert.rejects(round, /not linked/)
  phone.sync.unlink('addr-laptop')
  await ended
  await assert.rejects(phone.incoming[0].accept(), /not linked/)
  assert.equal(phone.sync.log.entries().length, 0)
  await sleep(30)
  assert.equal(h.wires.length, wiresBefore, 'nothing was sent to the unlinked device')
})

test('a counter too far ahead to ever have a key is consumed, logged as such, and moves the chain nowhere', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  const before = phone.sync.pairings()[0].recv
  const far = new Uint8Array(8 + 12 + 16)
  new DataView(far.buffer).setBigUint64(0, 5000n)
  assert.equal(await phone.sync.handle('addr-laptop', toB64u(far)), true)
  assert.deepEqual(phone.sync.pairings()[0].recv, before)
  assert.ok(phone.logs.some((l) => l.includes('too far ahead')))
  // and the stored pairing holds no epoch (nothing that re-derives the roots)
  assert.ok(!JSON.stringify(phone.storage.saved()).includes('epoch'))
})

test('Receive from <device>?: nothing is merged before accept; decline applies nothing and fails the waiting sync', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone', { prompt: true, handshakeMs: 500 })
  const laptop = await device(h, 'Laptop', 'addr-laptop', { prompt: true })
  await link(phone, laptop)
  await phone.sync.append(put(ENTITY_A, 'title', VALUE_A))
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  await laptop.sync.append(put(ENTITY_B, 'note', 'india'))

  const round = phone.sync.syncNow('addr-laptop')
  await until(() => phone.incoming.length === 1)
  const ask = phone.incoming[0]
  assert.deepEqual(ask.counts, { entries: 2, devices: 1 })
  assert.equal(ask.reply, false)
  assert.equal(ask.from.name, 'Laptop')
  assert.ok(!('send' in ask.from) && !('recv' in ask.from), 'the prompt carries no key material')
  assert.equal(phone.sync.log.entries().length, 1, 'nothing merged before accept')
  assert.ok(phone.logs.some((l) => l.includes('waiting for Receive')))

  ask.decline()
  await assert.rejects(round, /declined/)
  assert.equal(phone.sync.log.entries().length, 1)
  assert.equal(laptop.incoming.length, 0, 'nothing was sent back')
  await ask.accept().catch(() => undefined)
  assert.equal(phone.sync.log.entries().length, 1, 'a declined message cannot be accepted later')

  // next round: accept on both sides, each side asked once
  const round2 = phone.sync.syncNow('addr-laptop')
  await until(() => phone.incoming.length === 2)
  const merge = await phone.incoming[1].accept()
  assert.equal(merge.added, 2)
  const r = await round2
  assert.equal(r.received, 2)
  await until(() => laptop.incoming.length === 1)
  assert.equal(laptop.incoming[0].reply, true)
  assert.equal(laptop.incoming[0].counts.entries, 1)
  assert.equal(laptop.sync.log.entries().length, 2, 'the laptop waits for its own Receive')
  await laptop.incoming[0].accept()
  assert.equal(state(phone), state(laptop))
})

test('migration: a v1 blob with the secret key moves the key into the key store and is rewritten without it', async () => {
  const h = hub()
  const secret = randomBytes(32)
  const original = await deviceKeysFromSecret(secret)
  const storage = memStorage()
  storage.put({ v: 1, secretKey: toB64u(secret), pairings: [{ address: 'addr-old', deviceId: 'x', publicKey: 'y', name: 'Old', sas: '000000', linkedAt: 1, lastSyncAt: 0, sendCtr: 5, replay: { high: 0, seen: [] }, epoch: 'e' }], log: { v: 1, device: original.deviceId, entries: [] } })
  const keyStore = memoryKeyStore()
  const phone = await device(h, 'Phone', 'addr-phone', { storage, keyStore })
  assert.equal(phone.sync.deviceId, original.deviceId, 'the same device identity')
  const held = await keyStore.load()
  assert.ok(held)
  assert.deepEqual(held.publicKey, original.publicKey)
  assert.equal(held.privateKey.extractable, false)
  const saved = storage.saved()
  assert.ok(saved)
  assert.equal(saved.v, 2)
  assert.ok(!JSON.stringify(saved).includes(toB64u(secret)), 'the secret is gone from the blob')
  assert.equal(saved.pairings.length, 0, 'v1 pairings have no ratchet state: they are dropped, and the person pairs again')
  assert.ok(phone.logs.some((l) => l.includes('pairing again')))
  assert.ok(phone.logs.some((l) => l.includes('key store')))
  // a second start reads the key store, not the blob
  const again = await device(h, 'Phone', 'addr-phone', { storage, keyStore })
  assert.equal(again.sync.deviceId, original.deviceId)
  // and the migrated key still pairs and syncs
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(again, laptop)
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  await again.sync.syncNow('addr-laptop')
  await sleep(20)
  assert.equal(state(again), state(laptop))
})

test('forward secrecy: no key left in a device state captured after a round opens the wires of that round', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  await phone.sync.append(put(ENTITY_A, 'title', VALUE_A))
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  const start = h.wires.length
  await phone.sync.syncNow('addr-laptop')
  await sleep(20)
  const round = h.wires.slice(start)
  assert.equal(round.length, 3)
  const after = JSON.stringify(phone.storage.saved())
  // every 32-byte base64url string in the captured state, used directly, as a message key root and along the chain
  const candidates = new Set((after.match(/[A-Za-z0-9_-]{43}/g) ?? []).filter((x) => { try { return fromB64u(x).length === 32 } catch { return false } }))
  assert.ok(candidates.size >= 4, 'chains are in the state')
  const subtle = globalThis.crypto.subtle
  const hkdfBits = async (ikm: Uint8Array, info: string): Promise<Uint8Array> => {
    const base = await subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) as BufferSource }, base, 256))
  }
  const aes = (raw: Uint8Array) => subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['decrypt'])
  const opens = async (raw: Uint8Array, w: { from: string; to: string; payload: string }): Promise<boolean> => {
    const bytes = fromB64u(w.payload)
    const ctr = Number(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0))
    const aad = utf8(`${AAD_PREFIX}|${w.from}|${w.to}|${ctr}`)
    try {
      await subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(8, 20) as BufferSource, additionalData: aad as BufferSource }, await aes(raw), bytes.subarray(20) as BufferSource)
      return true
    } catch {
      return false
    }
  }
  let tried = 0
  for (const c of candidates) {
    let chain = fromB64u(c)
    for (let step = 0; step < 6; step++) {
      for (const w of round) {
        tried++
        assert.equal(await opens(chain, w), false, 'a state key opens a past wire')
        assert.equal(await opens(await hkdfBits(chain, RATCHET_INFO_MSG), w), false, 'a message key derived from a state key opens a past wire')
      }
      chain = await hkdfBits(chain, RATCHET_INFO_CHAIN)
    }
  }
  assert.ok(tried > 50)
  // and the device itself, recreated from that state, cannot apply them again
  const again = await device(h, 'Phone', 'addr-phone', { storage: phone.storage, keyStore: phone.keyStore })
  const before = state(again)
  for (const w of round.filter((x) => x.to === 'addr-phone')) assert.equal(await again.sync.handle(w.from, w.payload), true)
  await sleep(20)
  assert.equal(state(again), before)
})

test('two piece streams from one peer at once both complete (the relay hands over several waiting have-answers together)', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop', { handshakeMs: 500 })
  await link(phone, laptop)
  // a log that needs several pieces
  for (let i = 0; i < 40; i++) await phone.sync.append(put('item-' + i, 'blob', 'x'.repeat(3000)))
  // laptop asked twice while phone was away: both `have`s wait at phone
  h.sinks.delete('addr-phone')
  const haves = (): typeof h.wires => h.wires.filter((w) => w.from === 'addr-laptop' && w.to === 'addr-phone')
  const asked = haves().length
  const p1 = laptop.sync.syncNow('addr-phone').catch(() => null)
  await until(() => haves().length === asked + 1)
  const haveA = haves().pop()
  assert.ok(haveA)
  await p1
  const p2 = laptop.sync.syncNow('addr-phone').catch(() => null)
  await until(() => haves().length === asked + 2)
  const haveB = h.wires.filter((w) => w.from === 'addr-laptop' && w.to === 'addr-phone').pop()
  assert.ok(haveB && haveB !== haveA)
  await p2
  h.sinks.set('addr-phone', (f, p) => phone.sync.handle(f, p))
  // phone comes back and answers both at once: two interleaved piece streams reach laptop
  const before = h.wires.length
  await Promise.all([phone.sync.handle(haveA.from, haveA.payload), phone.sync.handle(haveB.from, haveB.payload)])
  await until(() => laptop.sync.log.entries().length === 40)
  assert.equal(state(laptop), state(phone))
  // the two answers were sent at once: every piece still got its own counter (the send path is serialised per peer)
  const ctrs = h.wires.slice(before).filter((w) => w.from === 'addr-phone').map((w) => { const b = fromB64u(w.payload); return Number(new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0)) })
  assert.ok(ctrs.length >= 4)
  assert.equal(new Set(ctrs).size, ctrs.length, `distinct counters: ${ctrs.join(',')}`)
})

test('a round larger than the budget is sent in parts; the next round continues where it stopped', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  // ~ 9.3 MB of changes: more than one round (200 pieces of 45 000 bytes) can carry
  for (let i = 0; i < 180; i++) await phone.sync.append(put('big-' + i, 'blob', 'y'.repeat(60_000)))
  const r1 = await laptop.sync.syncNow('addr-phone')
  assert.ok(r1.received > 0 && r1.received < 180, 'a first part')
  assert.ok(laptop.logs.some((l) => l.includes('the rest goes with the next sync')) || phone.logs.some((l) => l.includes('the rest goes with the next sync')))
  const r2 = await laptop.sync.syncNow('addr-phone')
  assert.equal(r1.received + r2.received, 180)
  await sleep(20)
  assert.equal(state(laptop), state(phone))
})

test('register:false leaves the relay sink to the app, which can route to handle itself', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  let routed = 0
  const relay = h.relay('addr-tablet')
  const tablet = await createDeviceSync({
    relay, address: 'addr-tablet', deviceName: () => 'Tablet', storage: memStorage(), keyStore: memoryKeyStore(), register: false,
    onPairRequest: () => undefined, onIncoming: (i) => void i.accept(), onLog: () => undefined,
  })
  relay.onRawWire((f, p) => { routed++; return tablet.handle(f, p) })
  const req = await tablet.join(await phone.sync.offer())
  assert.ok(req)
  await until(() => phone.requests.length === 2)
  await req.confirm()
  await phone.requests[1].confirm()
  await phone.sync.append(put(ENTITY_A, 'title', VALUE_A))
  await tablet.syncNow('addr-phone')
  await sleep(20)
  assert.ok(routed > 0)
  assert.equal(JSON.stringify(tablet.materialize()), state(phone))
})

test('large logs travel in several pieces under CHUNK_BYTES each', async () => {
  const h = hub()
  const phone = await device(h, 'Phone', 'addr-phone')
  const laptop = await device(h, 'Laptop', 'addr-laptop')
  await link(phone, laptop)
  const big = 'x'.repeat(30_000)
  for (let i = 0; i < 4; i++) await laptop.sync.append(put(`entity-big-${i}`, 'blob', big))
  const start = h.wires.length
  const r = await phone.sync.syncNow('addr-laptop')
  assert.equal(r.received, 4)
  const pieces = h.wires.slice(start).filter((w) => w.to === 'addr-phone')
  assert.ok(pieces.length >= 3, `pieces: ${pieces.length}`)
  // a piece is padded to the 65 536-byte bucket (seal.ts PAD_BUCKETS) plus the 8-byte counter, 12-byte IV and 16-byte tag, then base64url:
  // every piece has the same length on the wire, and with two did:peer:2 addresses around it stays well under the relay's 128 KiB
  const wireLen = Math.ceil(((65_536 + 8 + 12 + 16) * 4) / 3)
  for (const w of pieces) assert.ok(w.payload.length <= wireLen && w.payload.length > wireLen - 8, `piece length ${w.payload.length}`)
  assert.ok(wireLen + 2 * 1_600 + 64 < 128 * 1024)
  assert.equal(state(phone), state(laptop))
})

test('createDeviceSync refuses an address containing a separator', async () => {
  const h = hub()
  await assert.rejects(device(h, 'Phone', 'addr|phone'))
  await assert.rejects(device(h, 'Phone', 'addr~phone'))
})
