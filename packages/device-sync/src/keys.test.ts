// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { concat, equalBytes, randomBytes, sha256, toB64u, utf8 } from './bytes.ts'
import {
  base58btcDecode,
  base58btcEncode,
  derivePairKeys,
  deviceIdOf,
  deviceKeysFromSecret,
  generateDeviceKeys,
  secretKeyFromPairingSecret,
  sharedSecret,
  x25519PublicKeyFromDidPeer2,
} from './keys.ts'

const hex = (h: string): Uint8Array => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)))
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

// RFC 7748 §6.1 test vectors (published, not personal data).
const A_SECRET = hex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a')
const A_PUBLIC = hex('8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a')
const B_SECRET = hex('5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb')
const B_PUBLIC = hex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f')
const AB_SHARED = '4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742'

async function enc(key: CryptoKey, pt: Uint8Array): Promise<{ iv: Uint8Array; ct: Uint8Array }> {
  const iv = randomBytes(12)
  return { iv, ct: new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, pt as BufferSource)) }
}
async function dec(key: CryptoKey, m: { iv: Uint8Array; ct: Uint8Array }): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: m.iv as BufferSource }, key, m.ct as BufferSource))
  } catch {
    return null
  }
}

test('generateDeviceKeys: 32-byte keys, id derived from the public key', async () => {
  const k = await generateDeviceKeys()
  assert.equal(k.publicKey.length, 32)
  assert.equal(k.secretKey.length, 32)
  assert.equal(k.deviceId, await deviceIdOf(k.publicKey))
  const k2 = await generateDeviceKeys()
  assert.notEqual(k.deviceId, k2.deviceId)
})

test('deviceIdOf: 22 b64u chars of sha256(label || pub)', async () => {
  const id = await deviceIdOf(A_PUBLIC)
  assert.equal(id.length, 22)
  assert.equal(id, toB64u(await sha256(concat(utf8('trustweb-device-sync/v2/id'), A_PUBLIC))).slice(0, 22))
  await assert.rejects(deviceIdOf(new Uint8Array(31)))
})

test('deviceKeysFromSecret reproduces the generated public key (and the RFC 7748 vector)', async () => {
  const k = await generateDeviceKeys()
  const r = await deviceKeysFromSecret(k.secretKey)
  assert.deepEqual(r.publicKey, k.publicKey)
  assert.equal(r.deviceId, k.deviceId)
  assert.equal(toHex((await deviceKeysFromSecret(A_SECRET)).publicKey), toHex(A_PUBLIC))
  assert.equal(toHex((await deviceKeysFromSecret(B_SECRET)).publicKey), toHex(B_PUBLIC))
  await assert.rejects(deviceKeysFromSecret(new Uint8Array(16)))
})

test('sharedSecret: both sides agree; matches RFC 7748', async () => {
  const a = await deviceKeysFromSecret(A_SECRET)
  const b = await deviceKeysFromSecret(B_SECRET)
  assert.equal(toHex(await sharedSecret(a, B_PUBLIC)), AB_SHARED)
  assert.equal(toHex(await sharedSecret(b, A_PUBLIC)), AB_SHARED)
  const x = await generateDeviceKeys()
  const y = await generateDeviceKeys()
  assert.deepEqual(await sharedSecret(x, y.publicKey), await sharedSecret(y, x.publicKey))
})

test('sharedSecret: rejects bad lengths and low-order (all-zero result) public keys', async () => {
  const x = await generateDeviceKeys()
  await assert.rejects(sharedSecret(x, new Uint8Array(31)))
  await assert.rejects(sharedSecret(x, new Uint8Array(32))) // the zero point: shared secret would be all zero
  const one = new Uint8Array(32)
  one[0] = 1 // u = 1, also low order
  await assert.rejects(sharedSecret(x, one))
  await assert.rejects(sharedSecret({ ...x, secretKey: new Uint8Array(5) }, (await generateDeviceKeys()).publicKey))
})

test('derivePairKeys: same SAS on both sides; A.send opens with B.recv and NOT with B.send', async () => {
  const a = await generateDeviceKeys()
  const b = await generateDeviceKeys()
  const pa = await derivePairKeys(a, b.publicKey)
  const pb = await derivePairKeys(b, a.publicKey)
  assert.match(pa.sas, /^\d{6}$/)
  assert.equal(pa.sas, pb.sas)

  const m = await enc(pa.send, utf8('hello from Phone'))
  assert.deepEqual(await dec(pb.recv, m), utf8('hello from Phone'))
  assert.equal(await dec(pb.send, m), null)
  assert.equal(await dec(pa.recv, m), null)

  const back = await enc(pb.send, utf8('hello from Laptop'))
  assert.deepEqual(await dec(pa.recv, back), utf8('hello from Laptop'))
  assert.equal(await dec(pa.send, back), null)
})

test('derivePairKeys: deterministic for the same pair (RFC vectors), different pairs → different keys', async () => {
  const a = await deviceKeysFromSecret(A_SECRET)
  const b = await deviceKeysFromSecret(B_SECRET)
  const c = await generateDeviceKeys()
  const ab1 = await derivePairKeys(a, b.publicKey)
  const ab2 = await derivePairKeys(a, b.publicKey)
  assert.equal(ab1.sas, ab2.sas)
  const m = await enc(ab1.send, utf8('x'))
  assert.deepEqual(await dec(ab2.send, m), utf8('x'))

  const ac = await derivePairKeys(a, c.publicKey)
  const ca = await derivePairKeys(c, a.publicKey)
  assert.equal(await dec(ac.send, m), null)
  assert.equal(await dec(ca.recv, m), null)
})

test('derivePairKeys: refuses to pair a device with its own key', async () => {
  const a = await generateDeviceKeys()
  await assert.rejects(derivePairKeys(a, a.publicKey))
})

test('secretKeyFromPairingSecret: same secret → same key; other secret → no', async () => {
  const s = randomBytes(32)
  const k1 = await secretKeyFromPairingSecret(s)
  const k2 = await secretKeyFromPairingSecret(Uint8Array.from(s))
  const k3 = await secretKeyFromPairingSecret(randomBytes(32))
  const m = await enc(k1, utf8('pair'))
  assert.deepEqual(await dec(k2, m), utf8('pair'))
  assert.equal(await dec(k3, m), null)
  await assert.rejects(secretKeyFromPairingSecret(new Uint8Array(0)))
})

test('base58btc: known vectors, leading zeros, round trip, bad chars', () => {
  assert.equal(base58btcEncode(utf8('Hello World!')), '2NEpo7TZRRrLZSi2U')
  assert.equal(base58btcEncode(new Uint8Array(0)), '')
  assert.equal(base58btcEncode(Uint8Array.from([0, 0, 1])), '112')
  assert.deepEqual(base58btcDecode('112'), Uint8Array.from([0, 0, 1]))
  for (let i = 0; i < 50; i++) {
    const b = randomBytes(i % 40)
    if (i % 5 === 0 && b.length > 1) b[0] = 0
    assert.deepEqual(base58btcDecode(base58btcEncode(b)), b)
  }
  assert.throws(() => base58btcDecode('0OIl'))
  assert.throws(() => base58btcDecode('abc+'))
})

function didPeer2(edPub: Uint8Array, xPub: Uint8Array | null): string {
  const v = 'Vz' + base58btcEncode(concat(Uint8Array.from([0xed, 0x01]), edPub))
  const s = 'S' + toB64u(utf8(JSON.stringify({ t: 'dm', s: 'https://relay.example' })))
  const parts = ['did:peer:2', v]
  if (xPub) parts.push('Ez' + base58btcEncode(concat(Uint8Array.from([0xec, 0x01]), xPub)))
  parts.push(s)
  return parts.join('.')
}

test('x25519PublicKeyFromDidPeer2: extracts the E key', async () => {
  const k = await generateDeviceKeys()
  const did = didPeer2(randomBytes(32), k.publicKey)
  assert.ok(equalBytes(x25519PublicKeyFromDidPeer2(did), k.publicKey))
  const did2 = didPeer2(randomBytes(32), A_PUBLIC)
  assert.equal(toHex(x25519PublicKeyFromDidPeer2(did2)), toHex(A_PUBLIC))
})

test('x25519PublicKeyFromDidPeer2: throws for a DID without E or with a malformed E', () => {
  assert.throws(() => x25519PublicKeyFromDidPeer2(didPeer2(randomBytes(32), null)))
  assert.throws(() => x25519PublicKeyFromDidPeer2('did:key:z6Mk'))
  assert.throws(() => x25519PublicKeyFromDidPeer2(''))
  const ed = 'Vz' + base58btcEncode(concat(Uint8Array.from([0xed, 0x01]), randomBytes(32)))
  // wrong multicodec (ed25519 prefix in the E slot)
  assert.throws(() => x25519PublicKeyFromDidPeer2(`did:peer:2.${ed}.Ez${base58btcEncode(concat(Uint8Array.from([0xed, 0x01]), randomBytes(32)))}`))
  // wrong length
  assert.throws(() => x25519PublicKeyFromDidPeer2(`did:peer:2.${ed}.Ez${base58btcEncode(concat(Uint8Array.from([0xec, 0x01]), randomBytes(31)))}`))
  // not multibase base58btc
  assert.throws(() => x25519PublicKeyFromDidPeer2(`did:peer:2.${ed}.Em${toB64u(randomBytes(34))}`))
  // bad base58 char
  assert.throws(() => x25519PublicKeyFromDidPeer2(`did:peer:2.${ed}.Ez0OIl`))
})
