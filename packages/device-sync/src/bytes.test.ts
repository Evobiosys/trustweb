// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalJson, concat, equalBytes, fromB64u, fromUtf8, randomBytes, sha256, toB64u, utf8 } from './bytes.ts'

test('b64u: round trips every length 0..64 and random bytes', () => {
  for (let n = 0; n <= 64; n++) {
    const b = randomBytes(n)
    const s = toB64u(b)
    assert.match(s, /^[A-Za-z0-9_-]*$/)
    assert.deepEqual(fromB64u(s), b)
  }
})

test('b64u: matches RFC 4648 §5 vectors (no padding)', () => {
  assert.equal(toB64u(utf8('')), '')
  assert.equal(toB64u(utf8('f')), 'Zg')
  assert.equal(toB64u(utf8('fo')), 'Zm8')
  assert.equal(toB64u(utf8('foo')), 'Zm9v')
  assert.equal(toB64u(utf8('foob')), 'Zm9vYg')
  assert.equal(toB64u(Uint8Array.from([0xfb, 0xff])), '-_8')
})

test('b64u: rejects bad characters and impossible lengths', () => {
  assert.throws(() => fromB64u('ab+c'))
  assert.throws(() => fromB64u('ab/c'))
  assert.throws(() => fromB64u('Zg=='))
  assert.throws(() => fromB64u('ab c'))
  assert.throws(() => fromB64u('A')) // 6 bits cannot encode a byte
  assert.throws(() => fromB64u('AAAAA'))
})

test('utf8 / fromUtf8 round trip; invalid UTF-8 throws', () => {
  const s = 'Phone — Ünïcödé ✓ 🙂'
  assert.equal(fromUtf8(utf8(s)), s)
  assert.throws(() => fromUtf8(Uint8Array.from([0xff, 0xfe])))
  assert.throws(() => fromUtf8(Uint8Array.from([0xc3])))
})

test('concat joins in order', () => {
  assert.deepEqual(concat(), new Uint8Array(0))
  assert.deepEqual(concat(Uint8Array.from([1]), new Uint8Array(0), Uint8Array.from([2, 3])), Uint8Array.from([1, 2, 3]))
})

test('equalBytes: equal, different, length mismatch', () => {
  assert.equal(equalBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3])), true)
  assert.equal(equalBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 4])), false)
  assert.equal(equalBytes(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2])), false)
  assert.equal(equalBytes(new Uint8Array(0), new Uint8Array(0)), true)
})

test('randomBytes: length and not constant', () => {
  assert.equal(randomBytes(32).length, 32)
  assert.equal(equalBytes(randomBytes(32), randomBytes(32)), false)
})

test('sha256: known vector', async () => {
  assert.equal(toB64u(await sha256(utf8('abc'))), 'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
})

test('canonicalJson: sorts nested keys, keeps array order, omits undefined', () => {
  const a = { b: 1, a: { z: [3, { y: 1, x: 2 }], c: 'x' }, u: undefined }
  const b = { a: { c: 'x', z: [3, { x: 2, y: 1 }] }, b: 1 }
  assert.equal(canonicalJson(a), '{"a":{"c":"x","z":[3,{"x":2,"y":1}]},"b":1}')
  assert.equal(canonicalJson(a), canonicalJson(b))
  assert.equal(canonicalJson([2, 1, null, true, 'é"']), '[2,1,null,true,"é\\""]')
  assert.equal(canonicalJson('s'), '"s"')
  assert.equal(canonicalJson(-0.5), '-0.5')
})

test('canonicalJson: stable across insertion order', () => {
  const o1: Record<string, number> = {}
  const o2: Record<string, number> = {}
  for (const k of ['m', 'b', 'z', 'a']) o1[k] = k.charCodeAt(0)
  for (const k of ['a', 'z', 'b', 'm']) o2[k] = k.charCodeAt(0)
  assert.equal(canonicalJson(o1), canonicalJson(o2))
})

test('canonicalJson: throws on non-JSON values', () => {
  assert.throws(() => canonicalJson(1n))
  assert.throws(() => canonicalJson(() => 1))
  assert.throws(() => canonicalJson(NaN))
  assert.throws(() => canonicalJson(Infinity))
  assert.throws(() => canonicalJson({ a: Symbol('s') }))
  assert.throws(() => canonicalJson(undefined))
  assert.throws(() => canonicalJson([undefined]))
  assert.throws(() => canonicalJson({ a: { b: 2n } }))
})
