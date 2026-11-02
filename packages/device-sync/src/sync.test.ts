// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * sync.ts end to end over a fake relay hub (the pattern of apps/trustweb/test/unit/sync_link.test.mjs, typed): one relay per device,
 * sendRaw pushes { to, from, payload } onto a shared `wires` list and delivers it asynchronously to the sink registered for `to`.
 * Every wire is kept, so a test can re-deliver, re-address or re-attribute it.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, toB64u } from './bytes.ts'
import { generateDeviceKeys } from './keys.ts'
import {
  CHUNK_BYTES,
  MAX_PIECES,
  OFFER_TTL_MS,
  PAIR_PREFIX,
  codeFromLink,
  createDeviceSync,
  pairingCode,
  pairingLink,
  parsePairingCode,
} from './sync.ts'
import type { DeviceSync, PairRequest, RelayLike, SyncData, SyncStorage } from './sync.ts'

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
function memStorage(): SyncStorage & { saved: () => SyncData | null; saves: () => number } {
  let raw: string | null = null
  let n = 0
  return {
    load: () => (raw === null ? null : (JSON.parse(raw) as SyncData)),
    save: (d) => {
      raw = JSON.stringify(d)
      n++
    },
    saved: () => (raw === null ? null : (JSON.parse(raw) as SyncData)),
    saves: () => n,
  }
}

interface Dev {
  sync: DeviceSync
  address: string
  requests: PairRequest[]
  logs: string[]
  storage: ReturnType<typeof memStorage>
}

async function device(
  h: Hub,
  name: string,
  address: string,
  opts: { storage?: ReturnType<typeof memStorage>; handshakeMs?: number; now?: () => number } = {},
): Promise<Dev> {
  const requests: PairRequest[] = []
  const logs: string[] = []
  const storage = opts.storage ?? memStorage()
  const sync = await createDeviceSync({
    relay: h.relay(address),
    address,
    deviceName: () => name,
    storage,
    handshakeMs: opts.handshakeMs ?? 3000,
    ...(opts.now ? { now: opts.now } : {}),
    onPairRequest: (r) => requests.push(r),
    onLog: (l) => logs.push(l),
  })
  return { sync, address, requests, logs, storage }
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

test('pairing code: format, parse, link round trip, garbage refused', async () => {
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

  const link = pairingLink('https://app.example/', code)
  assert.equal(link, `https://app.example/#sync=${encodeURIComponent(code)}`)
  assert.equal(codeFromLink(link), code)
  assert.equal(codeFromLink('https://app.example/#other=1'), null)
  assert.equal(codeFromLink('https://app.example/'), null)
  assert.equal(codeFromLink('https://app.example/#sync=%E0%A4%A'), null)

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
  assert.equal(pp[0].sendCtr, 0)
  assert.deepEqual(pp[0].replay, { high: 0, seen: [] })
  // Stored: the peer's public key, never derived keys.
  const saved = JSON.stringify(phone.storage.saved())
  assert.ok(saved.includes(pp[0].publicKey))
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

test('persistence: a device recreated from its saved SyncData keeps pairing, keys, log and replay state', async () => {
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
  assert.equal(saved.v, 1)
  assert.equal(saved.pairings[0].sendCtr, 2)

  const again = await device(h, 'Phone', 'addr-phone', { storage: phone.storage })
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
  const r1 = await device(h, 'Phone', 'addr-phone', { storage: s1 })
  assert.equal(await r1.sync.handle(entriesWire.from, entriesWire.payload), true)
  assert.equal(await r1.sync.handle(entriesWire.from, entriesWire.payload), true, 'second delivery: consumed, not applied')
  assert.equal(r1.sync.log.entries().length, 2)
  assert.equal(state(r1), state(laptop))

  // (2) Worst case: the log was saved but the replay state was lost. The wire is accepted again; the merge adds nothing.
  const s2 = memStorage()
  s2.save({ ...after, pairings: after.pairings.map((p) => ({ ...p, replay: { high: 0, seen: [] } })) })
  const r2 = await device(h, 'Phone', 'addr-phone', { storage: s2 })
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
  const epoch1 = phone.sync.pairings()[0].epoch
  await laptop.sync.append(put(ENTITY_B, 'title', VALUE_B))
  const start = h.wires.length
  await phone.sync.syncNow('addr-laptop')
  await sleep(20)
  const old = h.wires.slice(start).filter((w) => w.to === 'addr-phone')
  assert.equal(old.length, 1)

  phone.sync.unlink('addr-laptop')
  laptop.sync.unlink('addr-phone')
  const sas2 = await link(phone, laptop)
  const epoch2 = phone.sync.pairings()[0].epoch
  assert.notEqual(epoch2, epoch1, 'a fresh secret gives a fresh epoch')
  assert.notEqual(sas2, sas1, 'and a fresh SAS')
  assert.equal(phone.sync.pairings()[0].sendCtr, 0)

  // Counters restarted at zero, but the old wire is under the old keys: it does not open, so it is neither applied nor acked.
  assert.equal(await phone.sync.handle(old[0].from, old[0].payload), false)
  // The new pairing still syncs.
  await laptop.sync.append(put(ENTITY_B, 'note', 'hotel'))
  await phone.sync.syncNow('addr-laptop')
  await sleep(20)
  assert.equal(state(phone), state(laptop))
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
  // ciphertext b64u of a piece: 4/3 of (b64u chunk + JSON framing) -- bound loosely
  for (const w of pieces) assert.ok(w.payload.length < (CHUNK_BYTES * 4) / 3 * 4 / 3 + 2000)
  assert.equal(state(phone), state(laptop))
})

test('createDeviceSync refuses an address containing a separator', async () => {
  const h = hub()
  await assert.rejects(device(h, 'Phone', 'addr|phone'))
  await assert.rejects(device(h, 'Phone', 'addr~phone'))
})
