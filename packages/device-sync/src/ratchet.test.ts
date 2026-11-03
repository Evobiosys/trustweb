// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fromB64u, randomBytes, toB64u, utf8 } from './bytes.ts'
import { MAX_SKIP, RATCHET_INFO_CHAIN, RATCHET_INFO_MSG, initChain, parseChainState, receiveKey, sendKey } from './ratchet.ts'
import type { ChainState } from './ratchet.ts'
import { openMessage, sealMessage } from './seal.ts'

const PHONE = 'addr-phone'
const LAPTOP = 'addr-laptop'

async function seal(key: CryptoKey, ctr: number): Promise<string> {
  return sealMessage(key, PHONE, LAPTOP, { ctr, kind: 'have', body: { heads: { p1: ctr }, name: 'Phone' } })
}

/** Sends `n` messages from a fresh chain over `root`; returns the wires (index i = ctr i+1) and the final send state. */
async function sendMany(root: Uint8Array, n: number): Promise<{ wires: string[]; state: ChainState }> {
  let s = await initChain(root)
  const wires: string[] = []
  for (let i = 0; i < n; i++) {
    const r = await sendKey(s)
    assert.equal(r.ctr, i + 1)
    wires.push(await seal(r.key, r.ctr))
    s = r.state
  }
  return { wires, state: s }
}

async function opens(key: CryptoKey, wire: string, ctr: number): Promise<boolean> {
  const m = await openMessage(key, PHONE, LAPTOP, wire)
  return m !== null && m.ctr === ctr
}

test('constants', () => {
  assert.equal(MAX_SKIP, 1024)
  assert.equal(RATCHET_INFO_MSG, 'trustweb-device-sync/v2/ratchet/msg')
  assert.equal(RATCHET_INFO_CHAIN, 'trustweb-device-sync/v2/ratchet/chain')
})

test('initChain: chain = root, next = 1, no skipped keys; refuses a root that is not 32 bytes', async () => {
  const root = randomBytes(32)
  assert.deepEqual(await initChain(root), { chain: toB64u(root), next: 1, skipped: {} })
  await assert.rejects(initChain(randomBytes(31)))
  await assert.rejects(initChain(randomBytes(33)))
})

test('send/receive in order', async () => {
  const root = randomBytes(32)
  const { wires } = await sendMany(root, 5)
  let r = await initChain(root)
  for (let ctr = 1; ctr <= 5; ctr++) {
    const got = await receiveKey(r, ctr)
    assert.ok(got)
    assert.ok(await opens(got.key, wires[ctr - 1], ctr))
    assert.equal(got.state.next, ctr + 1)
    assert.deepEqual(got.state.skipped, {})
    r = got.state
  }
})

test('sendKey and receiveKey never mutate the input state; keys are AES-GCM, non-extractable', async () => {
  const s0 = await initChain(randomBytes(32))
  const snap = JSON.stringify(s0)
  const sent = await sendKey(s0)
  assert.equal(JSON.stringify(s0), snap)
  assert.notEqual(sent.state, s0)
  assert.equal(sent.key.extractable, false)
  assert.equal((sent.key.algorithm as AesKeyAlgorithm).name, 'AES-GCM')
  assert.equal((sent.key.algorithm as AesKeyAlgorithm).length, 256)
  const got = await receiveKey(s0, 3)
  assert.ok(got)
  assert.equal(JSON.stringify(s0), snap)
  assert.equal(got.key.extractable, false)
})

test('out of order within MAX_SKIP: receive 5 first, then 1..4, each exactly once', async () => {
  const root = randomBytes(32)
  const { wires } = await sendMany(root, 5)
  const g5 = await receiveKey(await initChain(root), 5)
  assert.ok(g5)
  assert.ok(await opens(g5.key, wires[4], 5))
  assert.equal(g5.state.next, 6)
  assert.deepEqual(Object.keys(g5.state.skipped).sort(), ['1', '2', '3', '4'])
  let r = g5.state
  for (const ctr of [3, 1, 4, 2]) {
    const g = await receiveKey(r, ctr)
    assert.ok(g, `ctr ${ctr}`)
    assert.ok(await opens(g.key, wires[ctr - 1], ctr))
    assert.equal(g.state.skipped[String(ctr)], undefined, 'used skipped key is deleted')
    r = g.state
  }
  assert.deepEqual(r.skipped, {})
  assert.equal(r.next, 6)
  // and every one of them is now a replay
  for (let ctr = 1; ctr <= 5; ctr++) assert.equal(await receiveKey(r, ctr), null)
})

test('second use of a skipped key → null', async () => {
  const root = randomBytes(32)
  const g3 = await receiveKey(await initChain(root), 3)
  assert.ok(g3)
  const g1 = await receiveKey(g3.state, 1)
  assert.ok(g1)
  assert.equal(await receiveKey(g1.state, 1), null)
  // the skipped key for 2 is still there and works once
  const g2 = await receiveKey(g1.state, 2)
  assert.ok(g2)
  assert.equal(await receiveKey(g2.state, 2), null)
})

test('a ctr more than MAX_SKIP ahead → null, state unchanged; exactly MAX_SKIP ahead is accepted', async () => {
  const s = await initChain(randomBytes(32))
  const snap = JSON.stringify(s)
  assert.equal(await receiveKey(s, 1 + MAX_SKIP + 1), null)
  assert.equal(JSON.stringify(s), snap)
  const ok = await receiveKey(s, 1 + MAX_SKIP)
  assert.ok(ok)
  assert.equal(Object.keys(ok.state.skipped).length, MAX_SKIP)
  assert.equal(ok.state.next, MAX_SKIP + 2)
})

test('skipped keys are bounded by MAX_SKIP: the smallest ctrs are evicted', async () => {
  const root = randomBytes(32)
  const a = await receiveKey(await initChain(root), 11) // skips 1..10
  assert.ok(a)
  const b = await receiveKey(a.state, 12 + MAX_SKIP) // skips 12..MAX_SKIP+11 → total MAX_SKIP + 10 → the 10 oldest go
  assert.ok(b)
  const ctrs = Object.keys(b.state.skipped).map(Number).sort((x, y) => x - y)
  assert.equal(ctrs.length, MAX_SKIP)
  assert.equal(ctrs[0], 12)
  assert.equal(ctrs[ctrs.length - 1], 11 + MAX_SKIP)
  for (let c = 1; c <= 10; c++) assert.equal(await receiveKey(b.state, c), null, `evicted ${c}`)
  assert.ok(await receiveKey(b.state, 12))
  assert.ok(parseChainState(JSON.parse(JSON.stringify(b.state))))
})

test('invalid ctr → null', async () => {
  const s = await initChain(randomBytes(32))
  for (const c of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1' as unknown as number, null as unknown as number]) {
    assert.equal(await receiveKey(s, c), null, String(c))
  }
})

test('chain keys differ per step; a later state cannot re-derive or open an earlier message', async () => {
  const root = randomBytes(32)
  const { wires, state: sendState } = await sendMany(root, 3)
  // chain keys of consecutive send states are all distinct
  let s = await initChain(root)
  const chains = new Set([s.chain])
  for (let i = 0; i < 5; i++) {
    s = (await sendKey(s)).state
    chains.add(s.chain)
  }
  assert.equal(chains.size, 6)

  // receive 1 and 2, then feed ctr 1 again → null
  const g1 = await receiveKey(await initChain(root), 1)
  assert.ok(g1)
  const g2 = await receiveKey(g1.state, 2)
  assert.ok(g2)
  assert.equal(await receiveKey(g2.state, 1), null)

  // No 32-byte value in the later states' JSON opens message 1: neither used directly as an AES key nor as an HKDF input
  // (with either label). We collect every b64u string of either later state (receiver after 2, sender after 3).
  const strings: string[] = []
  const walk = (v: unknown): void => {
    if (typeof v === 'string') strings.push(v)
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { strings.push(k); walk(x) }
  }
  walk(JSON.parse(JSON.stringify(g2.state)))
  walk(JSON.parse(JSON.stringify(sendState)))
  let tried = 0
  for (const str of strings) {
    let raw: Uint8Array
    try { raw = fromB64u(str) } catch { continue }
    if (raw.length !== 32) continue
    const direct = await crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['decrypt'])
    assert.equal(await openMessage(direct, PHONE, LAPTOP, wires[0]), null)
    const base = await crypto.subtle.importKey('raw', raw as BufferSource, 'HKDF', false, ['deriveKey'])
    for (const info of [RATCHET_INFO_MSG, RATCHET_INFO_CHAIN]) {
      const k = await crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) as BufferSource },
        base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
      assert.equal(await openMessage(k, PHONE, LAPTOP, wires[0]), null)
    }
    tried++
  }
  assert.ok(tried >= 2, 'the test actually tried the chain keys')
  // sanity: the same procedure DOES open message 1 from the initial state (the root), so the check above is meaningful
  const base = await crypto.subtle.importKey('raw', root as BufferSource, 'HKDF', false, ['deriveKey'])
  const k1 = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(RATCHET_INFO_MSG) as BufferSource },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  assert.ok(await opens(k1, wires[0], 1))
})

test('state round-trips through JSON (including skipped keys)', async () => {
  const root = randomBytes(32)
  const { wires } = await sendMany(root, 4)
  const g4 = await receiveKey(await initChain(root), 4)
  assert.ok(g4)
  const restored = parseChainState(JSON.parse(JSON.stringify(g4.state)))
  assert.ok(restored)
  assert.deepEqual(restored, g4.state)
  const g2 = await receiveKey(restored, 2)
  assert.ok(g2)
  assert.ok(await opens(g2.key, wires[1], 2))
})

test('parseChainState rejects garbage', async () => {
  const good = (await receiveKey(await initChain(randomBytes(32)), 3))!.state
  assert.ok(parseChainState(good))
  const k32 = toB64u(randomBytes(32))
  const bad: unknown[] = [
    null, undefined, 1, 'x', [], [good],
    {},
    { ...good, chain: undefined },
    { ...good, chain: 5 },
    { ...good, chain: toB64u(randomBytes(31)) },
    { ...good, chain: 'not*b64u' },
    { ...good, next: 0 },
    { ...good, next: -1 },
    { ...good, next: 1.5 },
    { ...good, next: '4' },
    { ...good, next: Number.MAX_SAFE_INTEGER + 1 },
    { ...good, skipped: null },
    { ...good, skipped: [] },
    { ...good, skipped: { '4': k32 } }, // not < next
    { ...good, skipped: { '9': k32 } },
    { ...good, skipped: { '0': k32 } },
    { ...good, skipped: { '01': k32 } },
    { ...good, skipped: { '-1': k32 } },
    { ...good, skipped: { x: k32 } },
    { ...good, skipped: { '1': toB64u(randomBytes(16)) } },
    { ...good, skipped: { '1': 7 } },
    { ...good, extra: 1 },
  ]
  for (const v of bad) assert.equal(parseChainState(v), null, JSON.stringify(v) ?? String(v))
  // more than MAX_SKIP entries
  const many: Record<string, string> = {}
  for (let i = 1; i <= MAX_SKIP + 1; i++) many[String(i)] = k32
  assert.equal(parseChainState({ chain: k32, next: MAX_SKIP + 2, skipped: many }), null)
  delete many[String(MAX_SKIP + 1)]
  assert.ok(parseChainState({ chain: k32, next: MAX_SKIP + 2, skipped: many }))
  // the result is a copy, not the input object
  const p = parseChainState(good)!
  assert.notEqual(p, good)
  assert.notEqual(p.skipped, good.skipped)
})

test('two chains from different roots differ', async () => {
  const a = await sendMany(randomBytes(32), 2)
  const b = await initChain(randomBytes(32))
  const gb = await receiveKey(b, 1)
  assert.ok(gb)
  assert.equal(await opens(gb.key, a.wires[0], 1), false)
  assert.notEqual(a.state.chain, (await sendMany(randomBytes(32), 2)).state.chain)
})

test('send side and receive side from the same root agree for 50 messages in random order', async () => {
  const root = randomBytes(32)
  const { wires } = await sendMany(root, 50)
  const order = Array.from({ length: 50 }, (_, i) => i + 1)
  const rnd = randomBytes(50)
  for (let i = order.length - 1; i > 0; i--) {
    const j = rnd[i] % (i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  let r = await initChain(root)
  for (const ctr of order) {
    const g = await receiveKey(r, ctr)
    assert.ok(g, `ctr ${ctr}`)
    assert.ok(await opens(g.key, wires[ctr - 1], ctr), `opens ${ctr}`)
    r = g.state
  }
  assert.deepEqual(r.skipped, {})
  assert.equal(r.next, 51)
  for (const ctr of order) assert.equal(await receiveKey(r, ctr), null)
})

test('with the seal key resolver: the receiver commits the new state only after the wire opened', async () => {
  const root = randomBytes(32)
  const { wires } = await sendMany(root, 3)
  let committed = await initChain(root)
  const receive = async (wire: string): Promise<boolean> => {
    let pending: ChainState | null = null
    const m = await openMessage(async (ctr) => {
      const r = await receiveKey(committed, ctr)
      pending = r ? r.state : null
      return r ? r.key : null
    }, PHONE, LAPTOP, wire)
    if (m === null || pending === null) return false
    committed = pending
    return true
  }
  // a forged wire claiming ctr 3 (valid prefix, garbage ciphertext) must not advance the chain
  const forged = toB64u(Uint8Array.from([...fromB64u(wires[2]).slice(0, 20), ...randomBytes(1040)]))
  assert.equal(await receive(forged), false)
  assert.equal(committed.next, 1)
  assert.equal(await receive(wires[2]), true)
  assert.equal(await receive(wires[0]), true)
  assert.equal(await receive(wires[0]), false, 'replay')
  assert.equal(await receive(wires[1]), true)
  assert.deepEqual(committed.skipped, {})
})
