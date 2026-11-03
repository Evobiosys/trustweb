// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, concat, fromB64u, fromUtf8, randomBytes, toB64u, utf8 } from './bytes.ts'
import { derivePairKeys, generateDeviceKeys } from './keys.ts'
import { AAD_PREFIX, PAD_BUCKETS, WIRE_VERSION, aadOf, openMessage, peekCtr, sealMessage } from './seal.ts'
import type { Sealed } from './seal.ts'

const PHONE = 'addr-phone'
const LAPTOP = 'addr-laptop'
const PREFIX = 8
const IV = 12
const TAG = 16
const OVER = PREFIX + IV + TAG // 36 bytes of framing around the padded plaintext

async function pair() {
  const a = await generateDeviceKeys()
  const b = await generateDeviceKeys()
  return { a: await derivePairKeys(a, b.publicKey), b: await derivePairKeys(b, a.publicKey) }
}

/** 8-byte big-endian unsigned counter, written without BigInt so values above 2^53 can be built for tests. */
function ctrBytes(hi: number, lo: number): Uint8Array {
  const out = new Uint8Array(8)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, hi, false)
  dv.setUint32(4, lo, false)
  return out
}
const ctr8 = (ctr: number) => ctrBytes(Math.floor(ctr / 2 ** 32), ctr >>> 0)

/** The padded frame sealMessage encrypts: 4-byte big-endian length || json || zeros up to the bucket. */
function frame(json: Uint8Array, bucket = PAD_BUCKETS.find((b) => b >= 4 + json.length)!): Uint8Array {
  const out = new Uint8Array(bucket)
  new DataView(out.buffer).setUint32(0, json.length, false)
  out.set(json, 4)
  return out
}

/** Seals an arbitrary plaintext under an arbitrary 8-byte prefix, with the AAD naming `aadCtr`. */
async function rawSeal(key: CryptoKey, from: string, to: string, ctr: number, plaintext: Uint8Array, prefix = ctr8(ctr)): Promise<string> {
  const iv = randomBytes(IV)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadOf(from, to, ctr) as BufferSource }, key, plaintext as BufferSource)
  return toB64u(concat(prefix, iv, new Uint8Array(ct)))
}

const msg: Sealed = { ctr: 1, kind: 'have', body: { heads: { p1: 3 }, name: 'Phone' } }

test('constants and aadOf (the counter is in the AAD)', () => {
  assert.equal(WIRE_VERSION, 2)
  assert.equal(AAD_PREFIX, 'trustweb-device-sync/v2')
  assert.equal(fromUtf8(aadOf(PHONE, LAPTOP, 7)), 'trustweb-device-sync/v2|addr-phone|addr-laptop|7')
  assert.throws(() => aadOf(PHONE, LAPTOP, 0))
  assert.throws(() => aadOf(PHONE, LAPTOP, 1.5))
})

test('round trip A.send → B.recv', async () => {
  const { a, b } = await pair()
  const wire = await sealMessage(a.send, PHONE, LAPTOP, msg)
  assert.match(wire, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, wire), msg)
})

test('wire layout: ctr (8 bytes BE, visible) || iv || ct; the plaintext is padded canonical JSON of {kind, body}', async () => {
  const { a, b } = await pair()
  const wire = await sealMessage(a.send, PHONE, LAPTOP, { body: { z: 1, a: 'Phone' }, kind: 'k', ctr: 7 })
  assert.equal(wire.includes('Phone'), false)
  const framed = fromB64u(wire)
  assert.deepEqual(framed.slice(0, PREFIX), ctr8(7))
  assert.equal(peekCtr(wire), 7)
  // prefix (8) + iv (12) + padded frame (smallest bucket, 1024) + tag (16)
  assert.equal(framed.length, OVER + 1024)
  // the exact plaintext: canonical JSON of {body, kind} (no ctr inside) in the length-prefixed, zero-padded frame
  const pt = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: framed.slice(PREFIX, PREFIX + IV) as BufferSource, additionalData: aadOf(PHONE, LAPTOP, 7) as BufferSource },
    b.recv, framed.slice(PREFIX + IV) as BufferSource))
  assert.deepEqual(pt, frame(utf8('{"body":{"a":"Phone","z":1},"kind":"k"}')))
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, wire), { ctr: 7, kind: 'k', body: { a: 'Phone', z: 1 } })
})

test('large counters round trip through the 8-byte prefix', async () => {
  const { a, b } = await pair()
  for (const ctr of [255, 256, 2 ** 32 - 1, 2 ** 32, 2 ** 32 + 1, Number.MAX_SAFE_INTEGER]) {
    const wire = await sealMessage(a.send, PHONE, LAPTOP, { ...msg, ctr })
    assert.equal(peekCtr(wire), ctr)
    assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, wire), { ...msg, ctr })
  }
})

test('tampering any single byte → null (prefix, iv, ciphertext, tag)', async () => {
  const { a, b } = await pair()
  const framed = fromB64u(await sealMessage(a.send, PHONE, LAPTOP, msg))
  for (const i of [0, 7, 8, 13, 19, 20, 30, framed.length - 17, framed.length - 1]) {
    const t = Uint8Array.from(framed)
    t[i] ^= 0x01
    assert.equal(await openMessage(b.recv, PHONE, LAPTOP, toB64u(t)), null, `byte ${i}`)
  }
  // truncated
  assert.equal(await openMessage(b.recv, PHONE, LAPTOP, toB64u(framed.slice(0, -1))), null)
})

test('ctr tampered in the prefix → null (AAD mismatch), even to a valid counter', async () => {
  const { a, b } = await pair()
  const framed = fromB64u(await sealMessage(a.send, PHONE, LAPTOP, { ...msg, ctr: 5 }))
  for (const c of [4, 6, 1, 2 ** 40]) {
    const t = concat(ctr8(c), framed.slice(PREFIX))
    assert.equal(peekCtr(toB64u(t)), c)
    assert.equal(await openMessage(b.recv, PHONE, LAPTOP, toB64u(t)), null, `ctr ${c}`)
  }
})

test('peekCtr: garbage, short, zero or above 2^53 - 1 → null; never throws', () => {
  for (const w of ['', 'A', '!!!!', 'not base64url+/=', toB64u(randomBytes(7)), toB64u(new Uint8Array(40)), 42 as unknown as string, null as unknown as string]) {
    assert.equal(peekCtr(w), null, String(w))
  }
  assert.equal(peekCtr(toB64u(concat(ctrBytes(0, 1), randomBytes(28)))), 1)
  assert.equal(peekCtr(toB64u(concat(ctrBytes(0x200000, 0), randomBytes(28)))), null, '2^53')
  assert.equal(peekCtr(toB64u(concat(ctrBytes(0xffffffff, 0xffffffff), randomBytes(28)))), null)
  // shorter than a whole wire (prefix + iv + tag) → null even with a valid prefix
  assert.equal(peekCtr(toB64u(concat(ctrBytes(0, 1), randomBytes(27)))), null)
})

test('a key resolver: called with the counter; its key opens; null from it → null; a throwing resolver → null', async () => {
  const { a, b } = await pair()
  const wire = await sealMessage(a.send, PHONE, LAPTOP, { ...msg, ctr: 9 })
  const asked: number[] = []
  assert.deepEqual(await openMessage(async (c) => { asked.push(c); return b.recv }, PHONE, LAPTOP, wire), { ...msg, ctr: 9 })
  assert.deepEqual(asked, [9])
  assert.equal(await openMessage(async () => null, PHONE, LAPTOP, wire), null)
  assert.equal(await openMessage(async () => b.send, PHONE, LAPTOP, wire), null)
  assert.equal(await openMessage(async () => { throw new Error('boom') }, PHONE, LAPTOP, wire), null)
  // the resolver is not consulted for a wire whose prefix is unreadable
  let called = false
  assert.equal(await openMessage(async () => { called = true; return b.recv }, PHONE, LAPTOP, 'garbage'), null)
  assert.equal(called, false)
})

test('wrong key → null (other direction, other pair)', async () => {
  const { a, b } = await pair()
  const other = await pair()
  const wire = await sealMessage(a.send, PHONE, LAPTOP, msg)
  assert.equal(await openMessage(b.send, PHONE, LAPTOP, wire), null)
  assert.equal(await openMessage(a.recv, PHONE, LAPTOP, wire), null)
  assert.equal(await openMessage(other.b.recv, PHONE, LAPTOP, wire), null)
})

test('re-addressed or re-attributed wire → null', async () => {
  const { a, b } = await pair()
  const wire = await sealMessage(a.send, PHONE, LAPTOP, msg)
  assert.equal(await openMessage(b.recv, LAPTOP, PHONE, wire), null)
  assert.equal(await openMessage(b.recv, 'addr-other', LAPTOP, wire), null)
  assert.equal(await openMessage(b.recv, PHONE, 'addr-other', wire), null)
  // the separator cannot be shifted between fields: an address containing '|' is refused outright
  assert.throws(() => aadOf('x|y', 'z', 1))
  assert.throws(() => aadOf('x', 'y|z', 1))
  await assert.rejects(sealMessage(a.send, 'x|y', 'z', msg))
  assert.equal(await openMessage(b.recv, 'x', 'y|z', wire), null)
})

test('two seals of the same message differ (fresh IV)', async () => {
  const { a, b } = await pair()
  const w1 = await sealMessage(a.send, PHONE, LAPTOP, msg)
  const w2 = await sealMessage(a.send, PHONE, LAPTOP, msg)
  assert.notEqual(w1, w2)
  assert.notDeepEqual(fromB64u(w1).slice(PREFIX, PREFIX + IV), fromB64u(w2).slice(PREFIX, PREFIX + IV))
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, w1), await openMessage(b.recv, PHONE, LAPTOP, w2))
})

test('garbage / empty / non-b64u / short → null, never throws', async () => {
  const { b } = await pair()
  for (const w of ['', 'A', '!!!!', 'not base64url+/=', toB64u(randomBytes(11)), toB64u(randomBytes(12)), toB64u(randomBytes(27)), toB64u(randomBytes(35)), toB64u(randomBytes(200)), toB64u(concat(ctr8(1), randomBytes(1100)))]) {
    assert.equal(await openMessage(b.recv, PHONE, LAPTOP, w), null, JSON.stringify(w))
  }
  assert.equal(await openMessage(b.recv, PHONE, LAPTOP, 42 as unknown as string), null)
})

test('authentic but invalid content → null (bad UTF-8, bad JSON, bad kind, bad ctr in the prefix)', async () => {
  const { a, b } = await pair()
  // the content checks run on the JSON inside a correct padding frame
  const open = async (pt: Uint8Array, ctr = 1) => openMessage(b.recv, PHONE, LAPTOP, await rawSeal(a.send, PHONE, LAPTOP, ctr, frame(pt)))
  assert.deepEqual(await open(utf8('{"body":null,"kind":"x"}')), { ctr: 1, kind: 'x', body: null })
  assert.equal(await open(Uint8Array.from([0xff, 0xfe])), null)
  assert.equal(await open(utf8('{not json')), null)
  assert.equal(await open(utf8('null')), null)
  assert.equal(await open(utf8('["x",null]')), null)
  assert.equal(await open(utf8('{"body":1}')), null)
  assert.equal(await open(utf8('{"kind":5}')), null)
  // a missing body (canonicalJson omits an undefined one) opens as null; unknown extra keys (an inner "ctr" too) are dropped
  assert.deepEqual(await open(utf8('{"kind":"x"}'), 2), { ctr: 2, kind: 'x', body: null })
  assert.deepEqual(await open(utf8('{"ctr":99,"extra":1,"kind":"x"}'), 3), { ctr: 3, kind: 'x', body: null })
  // an authentic wire whose prefix (and AAD) carries ctr 0 or 2^53 is still refused
  const json = frame(utf8('{"kind":"x"}'))
  const iv = randomBytes(IV)
  for (const [hi, lo] of [[0, 0], [0x200000, 0]]) {
    const aad = utf8(`${AAD_PREFIX}|${PHONE}|${LAPTOP}|${hi * 2 ** 32 + lo}`)
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource }, a.send, json as BufferSource)
    assert.equal(await openMessage(b.recv, PHONE, LAPTOP, toB64u(concat(ctrBytes(hi, lo), iv, new Uint8Array(ct)))), null, `${hi}:${lo}`)
  }
})

test('sealMessage rejects a message it could never open again', async () => {
  const { a } = await pair()
  await assert.rejects(sealMessage(a.send, PHONE, LAPTOP, { ctr: 0, kind: 'x', body: null }))
  await assert.rejects(sealMessage(a.send, PHONE, LAPTOP, { ctr: 1.5, kind: 'x', body: null }))
  await assert.rejects(sealMessage(a.send, PHONE, LAPTOP, { ctr: Number.MAX_SAFE_INTEGER + 1, kind: 'x', body: null }))
  await assert.rejects(sealMessage(a.send, PHONE, LAPTOP, { ctr: 1, kind: 'x', body: 1n }))
})

// ---------------------------------------------------------------------------------------------------------------------------
// Padding to size buckets (PR #68 finding 4)
// ---------------------------------------------------------------------------------------------------------------------------

const withBody = (n: number): Sealed => ({ ctr: 1, kind: 'x', body: 'a'.repeat(n) })
/** Length of the JSON sealMessage pads for a message whose body is a string of `n` ASCII characters. */
const jsonLen = (n: number) => utf8(canonicalJson({ kind: 'x', body: 'a'.repeat(n) })).length

test('PAD_BUCKETS', () => {
  assert.deepEqual(PAD_BUCKETS, [1024, 4096, 16384, 65536])
})

test('a 10-byte and a 900-byte message produce the same wire length (bucket 1024 + 12 IV + 16 tag, + 8 counter)', async () => {
  const { a, b } = await pair()
  const w10 = await sealMessage(a.send, PHONE, LAPTOP, withBody(10))
  const w900 = await sealMessage(a.send, PHONE, LAPTOP, withBody(900))
  assert.equal(fromB64u(w10).length, 1024 + IV + TAG + PREFIX)
  assert.equal(w10.length, w900.length)
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, w10), withBody(10))
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, w900), withBody(900))
})

test('bucket edges: 4 + JSON = 1024 stays in 1024, one byte more goes to 4096; 1 200 bytes → 4096; 20 000 → 65536', async () => {
  const { a, b } = await pair()
  const overhead = jsonLen(0)
  const edge = withBody(1020 - overhead)
  const w1 = await sealMessage(a.send, PHONE, LAPTOP, edge)
  assert.equal(fromB64u(w1).length, 1024 + OVER)
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, w1), edge)
  const w2 = await sealMessage(a.send, PHONE, LAPTOP, withBody(1021 - overhead))
  assert.equal(fromB64u(w2).length, 4096 + OVER)
  const w3 = await sealMessage(a.send, PHONE, LAPTOP, withBody(1200))
  assert.equal(fromB64u(w3).length, 4096 + OVER)
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, w3), withBody(1200))
  const w4 = await sealMessage(a.send, PHONE, LAPTOP, withBody(20_000))
  assert.equal(fromB64u(w4).length, 65536 + OVER)
})

test('too large: JSON longer than 65 536 - 4 → throws; exactly 65 532 seals', async () => {
  const { a, b } = await pair()
  await assert.rejects(sealMessage(a.send, PHONE, LAPTOP, withBody(70_000)), /too large to seal/)
  const overhead = jsonLen(0)
  await assert.rejects(sealMessage(a.send, PHONE, LAPTOP, withBody(65_533 - overhead)), /too large to seal/)
  const max = withBody(65_532 - overhead)
  const w = await sealMessage(a.send, PHONE, LAPTOP, max)
  assert.equal(fromB64u(w).length, 65536 + OVER)
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, w), max)
})

test('padding bytes altered (under a valid AEAD) → null; bad length prefix → null; off-bucket size → null', async () => {
  const { a, b } = await pair()
  const json = utf8(canonicalJson({ kind: 'x', body: 'hello' }))
  const open = async (pt: Uint8Array) => openMessage(b.recv, PHONE, LAPTOP, await rawSeal(a.send, PHONE, LAPTOP, 1, pt))
  assert.deepEqual(await open(frame(json)), { ctr: 1, kind: 'x', body: 'hello' })
  for (const i of [4 + json.length, 500, 1023]) {
    const t = frame(json)
    t[i] = 1
    assert.equal(await open(t), null, `padding byte ${i}`)
  }
  // a length prefix that points past the end, one that is too short (cuts the JSON), and frames of the wrong size
  const long = frame(json)
  new DataView(long.buffer).setUint32(0, 1021, false)
  assert.equal(await open(long), null)
  const huge = frame(json)
  new DataView(huge.buffer).setUint32(0, 0xffffffff, false)
  assert.equal(await open(huge), null)
  const short = frame(json)
  new DataView(short.buffer).setUint32(0, json.length - 1, false)
  assert.equal(await open(short), null)
  assert.equal(await open(json), null, 'unframed JSON')
  assert.equal(await open(concat(Uint8Array.from([0, 0, 0, json.length]), json)), null, 'framed but not padded to a bucket')
  assert.equal(await open(frame(json, 2048)), null, 'not a bucket size')
  assert.equal(await open(frame(json, 4096)), null, 'a larger bucket than the length needs')
  assert.equal(await open(new Uint8Array(0)), null)
  assert.equal(await open(new Uint8Array(3)), null)
})

test("a sync.ts 'entries' piece of CHUNK_BYTES (45 000) raw bytes seals and opens (fits the 65 536 bucket)", async () => {
  const { a, b } = await pair()
  // built the way sync.ts builds it: body {sid, i, n, data: b64u(chunk), reply, name}; name at its 64-character cap
  const msg45: Sealed = {
    ctr: Number.MAX_SAFE_INTEGER, // the widest counter there can be (it is outside the padded JSON now, but keep the worst case)
    kind: 'entries',
    body: { sid: toB64u(randomBytes(12)), i: 199, n: 200, data: toB64u(randomBytes(45_000)), reply: true, name: 'N'.repeat(64) },
  }
  const w = await sealMessage(a.send, PHONE, LAPTOP, msg45)
  assert.equal(fromB64u(w).length, 65536 + OVER)
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, w), msg45)
  // headroom even if the 64-character name is all 4-byte UTF-8 characters
  const wide: Sealed = { ...msg45, body: { ...(msg45.body as object), name: '\u{1F600}'.repeat(64) } }
  assert.ok(utf8(canonicalJson({ kind: wide.kind, body: wide.body })).length + 4 <= 65536)
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, await sealMessage(a.send, PHONE, LAPTOP, wide)), wide)
})
