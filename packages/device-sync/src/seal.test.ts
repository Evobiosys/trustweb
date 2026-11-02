// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, concat, fromB64u, fromUtf8, randomBytes, toB64u, utf8 } from './bytes.ts'
import { derivePairKeys, generateDeviceKeys } from './keys.ts'
import { AAD_PREFIX, WIRE_VERSION, aadOf, openMessage, sealMessage } from './seal.ts'
import type { Sealed } from './seal.ts'

const PHONE = 'addr-phone'
const LAPTOP = 'addr-laptop'

async function pair() {
  const a = await generateDeviceKeys()
  const b = await generateDeviceKeys()
  return { a: await derivePairKeys(a, b.publicKey), b: await derivePairKeys(b, a.publicKey) }
}

async function rawSeal(key: CryptoKey, from: string, to: string, plaintext: Uint8Array): Promise<string> {
  const iv = randomBytes(12)
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadOf(from, to) as BufferSource }, key, plaintext as BufferSource)
  return toB64u(concat(iv, new Uint8Array(ct)))
}

const msg: Sealed = { ctr: 1, kind: 'have', body: { heads: { p1: 3 }, name: 'Phone' } }

test('constants and aadOf', () => {
  assert.equal(WIRE_VERSION, 2)
  assert.equal(AAD_PREFIX, 'trustweb-device-sync/v2')
  assert.equal(fromUtf8(aadOf(PHONE, LAPTOP)), 'trustweb-device-sync/v2|addr-phone|addr-laptop')
})

test('round trip A.send → B.recv', async () => {
  const { a, b } = await pair()
  const wire = await sealMessage(a.send, PHONE, LAPTOP, msg)
  assert.match(wire, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, wire), msg)
})

test('the plaintext is canonical JSON of {ctr, kind, body} and does not appear on the wire', async () => {
  const { a, b } = await pair()
  const wire = await sealMessage(a.send, PHONE, LAPTOP, { body: { z: 1, a: 'Phone' }, kind: 'k', ctr: 7 })
  assert.equal(wire.includes('Phone'), false)
  const framed = fromB64u(wire)
  // iv (12) + plaintext + tag (16)
  assert.equal(framed.length, 12 + utf8(canonicalJson({ body: { a: 'Phone', z: 1 }, ctr: 7, kind: 'k' })).length + 16)
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, wire), { ctr: 7, kind: 'k', body: { a: 'Phone', z: 1 } })
})

test('tampering any single byte → null', async () => {
  const { a, b } = await pair()
  const framed = fromB64u(await sealMessage(a.send, PHONE, LAPTOP, msg))
  for (const i of [0, 5, 11, 12, 20, framed.length - 17, framed.length - 1]) {
    const t = Uint8Array.from(framed)
    t[i] ^= 0x01
    assert.equal(await openMessage(b.recv, PHONE, LAPTOP, toB64u(t)), null, `byte ${i}`)
  }
  // truncated
  assert.equal(await openMessage(b.recv, PHONE, LAPTOP, toB64u(framed.slice(0, -1))), null)
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
  assert.throws(() => aadOf('x|y', 'z'))
  assert.throws(() => aadOf('x', 'y|z'))
  await assert.rejects(sealMessage(a.send, 'x|y', 'z', msg))
  assert.equal(await openMessage(b.recv, 'x', 'y|z', wire), null)
})

test('two seals of the same message differ (fresh IV)', async () => {
  const { a, b } = await pair()
  const w1 = await sealMessage(a.send, PHONE, LAPTOP, msg)
  const w2 = await sealMessage(a.send, PHONE, LAPTOP, msg)
  assert.notEqual(w1, w2)
  assert.notDeepEqual(fromB64u(w1).slice(0, 12), fromB64u(w2).slice(0, 12))
  assert.deepEqual(await openMessage(b.recv, PHONE, LAPTOP, w1), await openMessage(b.recv, PHONE, LAPTOP, w2))
})

test('garbage / empty / non-b64u / short → null, never throws', async () => {
  const { b } = await pair()
  for (const w of ['', 'A', '!!!!', 'not base64url+/=', toB64u(randomBytes(11)), toB64u(randomBytes(12)), toB64u(randomBytes(27)), toB64u(randomBytes(200))]) {
    assert.equal(await openMessage(b.recv, PHONE, LAPTOP, w), null, JSON.stringify(w))
  }
  assert.equal(await openMessage(b.recv, PHONE, LAPTOP, 42 as unknown as string), null)
})

test('authentic but invalid content → null (bad UTF-8, bad JSON, bad ctr, bad kind)', async () => {
  const { a, b } = await pair()
  const open = async (pt: Uint8Array) => openMessage(b.recv, PHONE, LAPTOP, await rawSeal(a.send, PHONE, LAPTOP, pt))
  assert.deepEqual(await open(utf8('{"body":null,"ctr":1,"kind":"x"}')), { ctr: 1, kind: 'x', body: null })
  assert.equal(await open(Uint8Array.from([0xff, 0xfe])), null)
  assert.equal(await open(utf8('{not json')), null)
  assert.equal(await open(utf8('null')), null)
  assert.equal(await open(utf8('[1,"x",null]')), null)
  assert.equal(await open(utf8('{"ctr":1,"body":1}')), null)
  assert.equal(await open(utf8('{"ctr":1,"kind":5}')), null)
  for (const ctr of ['0', '-1', '1.5', '"1"', 'null', '9007199254740992']) {
    assert.equal(await open(utf8(`{"ctr":${ctr},"kind":"x"}`)), null, ctr)
  }
  // a missing body (canonicalJson omits an undefined one) opens as null; unknown extra keys are dropped
  assert.deepEqual(await open(utf8('{"ctr":2,"kind":"x"}')), { ctr: 2, kind: 'x', body: null })
  assert.deepEqual(await open(utf8('{"ctr":3,"extra":1,"kind":"x"}')), { ctr: 3, kind: 'x', body: null })
})

test('sealMessage rejects a message it could never open again', async () => {
  const { a } = await pair()
  await assert.rejects(sealMessage(a.send, PHONE, LAPTOP, { ctr: 0, kind: 'x', body: null }))
  await assert.rejects(sealMessage(a.send, PHONE, LAPTOP, { ctr: 1.5, kind: 'x', body: null }))
  await assert.rejects(sealMessage(a.send, PHONE, LAPTOP, { ctr: 1, kind: 'x', body: 1n }))
})
