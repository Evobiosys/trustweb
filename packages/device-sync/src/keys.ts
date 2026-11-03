// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * keys.ts -- device identity and pair keys for device sync v2.
 *
 * WHY: the current sync (apps/trustweb/src/sync_link.ts) derives ONE symmetric key per pair and shows a 4-hex fingerprint. v2
 * keeps the same ceremony (a one-time code carried only in the QR code, Confirm on both screens) but tightens what comes out
 * of the key agreement:
 *  - Each device has a static X25519 key pair; `deviceId` is a hash of the public key, so an id cannot be claimed without the key.
 *  - X25519 ECDH → HKDF-SHA256 (salt = sha256 of the two public keys in byte order, so both sides agree without negotiating
 *    who is "first") → TWO directional AES-GCM-256 keys. A message sealed A→B cannot be reflected back to A as if it came from
 *    B, and each direction runs its own ratchet chain and counter (ratchet.ts) without collisions.
 *  - A 6-digit SAS (short authentication string) from the same HKDF, for the two humans to compare. 20 bits of comparison
 *    instead of 16; an active attacker who substitutes a key during pairing has about a one-in-a-million chance per attempt of
 *    producing the same digits.
 *  - The pairing-secret key (`secretKeyFromPairingSecret`) seals the single `pair` message. The secret travels only inside the
 *    QR code, never through the relay, which is what authenticates the joining device's public key to the offering device.
 *  - `x25519PublicKeyFromDidPeer2` reads the `E` key of an existing sync did:peer:2 (apps/demo/src/did.ts format), with a
 *    hand-rolled base58btc codec because this package has no dependencies.
 *
 * WHAT IS NOT CLAIMED (I7):
 *  - The keys here are static: whoever obtains a device's private key AND the pairing epoch AND the peer's public key can re-derive
 *    the pair roots. Forward secrecy comes from the layer above (ratchet.ts: keys deleted after use; sync.ts: the epoch is never
 *    stored), not from this file. No ephemeral DH step yet (no post-compromise security).
 *  - NO post-quantum security. X25519 falls to a large quantum computer; recorded traffic could be opened then.
 *  - NO metadata protection. Nothing here hides who talks to whom, when, or how much; the relay sees all of that.
 *  - The SAS is only as good as the humans comparing it. If nobody looks, an active attacker at pairing time is not detected.
 *  - The SAS is `uint32 mod 1e6`: the modulo bias (< 0.03 %) is accepted, not removed.
 *  - Private keys are WebCrypto CryptoKeys. `generateDeviceKeys` makes a NON-extractable one, so its secret bytes never exist in
 *    JavaScript; keystore.ts persists that CryptoKey object in IndexedDB. `deviceKeysFromSecret` still accepts raw bytes (the
 *    migration from the v1 localStorage blob, and tests) and then carries them in `secretKey`; keys loaded from the key store
 *    never do. Non-extractable is not "unusable": code running in the page can still call deriveBits with the key.
 *
 * Round 2: `derivePairRoots` gives two 32-byte directional ROOT keys (same salt and SAS as derivePairKeys) that seed the
 * per-direction KDF chains of ratchet.ts; the chain, not these roots, is what brings forward secrecy for message keys. The roots
 * themselves are still derivable from the static device keys, so a stolen device key still reveals them.
 */
import { concat, equalBytes, fromB64u, sha256, toB64u, utf8 } from './bytes.ts'

const subtle = (): SubtleCrypto => globalThis.crypto.subtle
const X25519 = { name: 'X25519' } as const
const KEY_LEN = 32
// DER prefix of a PKCS#8 PrivateKeyInfo for X25519 (OID 1.3.101.110) wrapping a 32-byte raw secret (RFC 8410).
const PKCS8_X25519_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20])
const X25519_MULTICODEC = Uint8Array.from([0xec, 0x01])

const LABEL_ID = 'trustweb-device-sync/v2/id'
const LABEL_LO_HI = 'trustweb-device-sync/v2/lo>hi'
const LABEL_HI_LO = 'trustweb-device-sync/v2/hi>lo'
const LABEL_SAS = 'trustweb-device-sync/v2/sas'
const LABEL_PAIR = 'trustweb-device-sync/v2/pair'
const LABEL_ROOT_LO_HI = 'trustweb-device-sync/v2/root/lo>hi'
const LABEL_ROOT_HI_LO = 'trustweb-device-sync/v2/root/hi>lo'
/** A pairing secret shorter than this is refused: it is the only thing authenticating the joining device. */
const MIN_PAIRING_SECRET = 16

export interface DeviceKeys {
  readonly deviceId: string
  /** Raw X25519 public key, 32 bytes. */
  readonly publicKey: Uint8Array
  /** X25519 private key, usages ['deriveBits']; non-extractable when generated here or loaded from the key store. */
  readonly privateKey: CryptoKey
  /** Raw 32-byte secret: present ONLY for keys built from raw bytes (migration, tests); never for generated or stored keys. */
  readonly secretKey?: Uint8Array
}

export interface PairKeys {
  readonly send: CryptoKey
  readonly recv: CryptoKey
  readonly sas: string
}

function need32(b: Uint8Array, what: string): void {
  if (!(b instanceof Uint8Array) || b.length !== KEY_LEN) throw new Error(`${what} must be ${KEY_LEN} bytes`)
}

/** toB64u(sha256(utf8('trustweb-device-sync/v2/id') || publicKey)).slice(0, 22) -- 132 bits. */
export async function deviceIdOf(publicKey: Uint8Array): Promise<string> {
  need32(publicKey, 'public key')
  return toB64u(await sha256(concat(utf8(LABEL_ID), publicKey))).slice(0, 22)
}

async function importSecret(secretKey: Uint8Array, extractable: boolean): Promise<CryptoKey> {
  need32(secretKey, 'secret key')
  return subtle().importKey('pkcs8', concat(PKCS8_X25519_PREFIX, secretKey) as BufferSource, X25519, extractable, ['deriveBits'])
}

async function publicOf(priv: CryptoKey): Promise<Uint8Array> {
  const jwk = await subtle().exportKey('jwk', priv)
  if (typeof jwk.x !== 'string') throw new Error('X25519 export carried no public key')
  // jwk.x is base64url without padding, the same alphabet as bytes.ts.
  const pub = fromB64u(jwk.x)
  need32(pub, 'derived public key')
  return pub
}

async function importPublic(publicKey: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', publicKey as BufferSource, X25519, true, [])
}

function isX25519Private(k: unknown): k is CryptoKey {
  return (
    typeof CryptoKey !== 'undefined' &&
    k instanceof CryptoKey &&
    k.type === 'private' &&
    k.algorithm.name === 'X25519' &&
    k.usages.includes('deriveBits')
  )
}

async function ecdh(priv: CryptoKey, pub: CryptoKey): Promise<Uint8Array> {
  let bits: ArrayBuffer
  try {
    bits = await subtle().deriveBits({ name: 'X25519', public: pub }, priv, 256)
  } catch {
    // Node/WebCrypto refuse a low-order point themselves; report it the same way as our own check below.
    throw new Error('X25519: shared secret is all zero (low-order peer key)')
  }
  const s = new Uint8Array(bits)
  if (equalBytes(s, new Uint8Array(KEY_LEN))) throw new Error('X25519: shared secret is all zero (low-order peer key)')
  return s
}

/**
 * From raw secret bytes (the v1 storage format; tests). The returned private key is non-extractable; the public key is read
 * from a short-lived extractable import that is dropped right away. `secretKey` keeps a copy of the bytes for the caller
 * that still needs them (the migration); nothing else should.
 */
export async function deviceKeysFromSecret(secretKey: Uint8Array): Promise<DeviceKeys> {
  const publicKey = await publicOf(await importSecret(secretKey, true))
  const privateKey = await importSecret(secretKey, false)
  return { deviceId: await deviceIdOf(publicKey), publicKey, privateKey, secretKey: Uint8Array.from(secretKey) }
}

/**
 * From a stored CryptoKey and its public key (the key store's format). A non-extractable key cannot be asked for its public
 * key, so the pairing of the two is CHECKED instead: an ephemeral key pair `e` must give ECDH(priv, e.pub) == ECDH(e.priv, pub).
 * A store that hands back a mismatched pair is refused rather than producing a device that can never decrypt anything.
 */
export async function deviceKeysFromPrivateKey(privateKey: CryptoKey, publicKey: Uint8Array): Promise<DeviceKeys> {
  if (!isX25519Private(privateKey)) throw new Error('not an X25519 private key with usage deriveBits')
  need32(publicKey, 'public key')
  const pub = Uint8Array.from(publicKey)
  const eph = (await subtle().generateKey(X25519, false, ['deriveBits'])) as CryptoKeyPair
  const viaPriv = await ecdh(privateKey, eph.publicKey)
  const viaPub = await ecdh(eph.privateKey, await importPublic(pub))
  if (!equalBytes(viaPriv, viaPub)) throw new Error('public key does not match the private key')
  return { deviceId: await deviceIdOf(pub), publicKey: pub, privateKey }
}

/** A fresh device key: the private key is generated NON-extractable, so its bytes never exist outside WebCrypto. */
export async function generateDeviceKeys(): Promise<DeviceKeys> {
  const pair = (await subtle().generateKey(X25519, false, ['deriveBits'])) as CryptoKeyPair
  const publicKey = new Uint8Array(await subtle().exportKey('raw', pair.publicKey))
  need32(publicKey, 'generated public key')
  return { deviceId: await deviceIdOf(publicKey), publicKey, privateKey: pair.privateKey }
}

/** Raw X25519 ECDH with `mine.privateKey`. Throws on bad lengths and on an all-zero result (a low-order peer key). */
export async function sharedSecret(mine: DeviceKeys, theirPublicKey: Uint8Array): Promise<Uint8Array> {
  need32(theirPublicKey, 'peer public key')
  if (!isX25519Private(mine.privateKey)) throw new Error('not an X25519 private key with usage deriveBits')
  return ecdh(mine.privateKey, await importPublic(theirPublicKey))
}

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

async function hkdfBase(ikm: Uint8Array): Promise<CryptoKey> {
  return subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveKey', 'deriveBits'])
}

function hkdfParams(salt: Uint8Array, info: string): HkdfParams {
  return { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: utf8(info) as BufferSource }
}

async function aesKey(base: CryptoKey, salt: Uint8Array, info: string): Promise<CryptoKey> {
  return subtle().deriveKey(hkdfParams(salt, info), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

interface PairBase {
  readonly base: CryptoKey
  readonly salt: Uint8Array
  /** True when my public key sorts first (I am "lo"). */
  readonly iAmLo: boolean
  readonly sas: string
}

/** The part derivePairKeys and derivePairRoots share: order, salt, HKDF base from the ECDH secret, and the SAS. */
async function pairBase(mine: DeviceKeys, theirPublicKey: Uint8Array, context: Uint8Array): Promise<PairBase> {
  need32(theirPublicKey, 'peer public key')
  const order = compareBytes(mine.publicKey, theirPublicKey)
  if (order === 0) throw new Error('refusing to pair a device with its own key')
  const [lo, hi] = order < 0 ? [mine.publicKey, theirPublicKey] : [theirPublicKey, mine.publicKey]
  const salt = await sha256(concat(lo, hi, context))
  const base = await hkdfBase(await sharedSecret(mine, theirPublicKey))
  const sasBits = new DataView(await subtle().deriveBits(hkdfParams(salt, LABEL_SAS), base, 32)).getUint32(0, false)
  return { base, salt, iAmLo: order < 0, sas: String(sasBits % 1_000_000).padStart(6, '0') }
}

/**
 * `context` (optional) is mixed into the HKDF salt: sync.ts passes the pairing epoch (SHA-256 of the one-time pairing secret), so two
 * ceremonies between the SAME two device keys yield different keys and a different SAS. Without it, "unlink, pair again" would restart
 * the counters under the old keys and a wire captured under the earlier pairing could be opened once more. Both sides know the secret
 * (it was in the code), so both derive the same epoch; nothing of it crosses the relay in clear.
 */
export async function derivePairKeys(mine: DeviceKeys, theirPublicKey: Uint8Array, context: Uint8Array = new Uint8Array(0)): Promise<PairKeys> {
  const { base, salt, iAmLo, sas } = await pairBase(mine, theirPublicKey, context)
  const loHi = await aesKey(base, salt, LABEL_LO_HI)
  const hiLo = await aesKey(base, salt, LABEL_HI_LO)
  return iAmLo ? { send: loHi, recv: hiLo, sas } : { send: hiLo, recv: loHi, sas }
}

/**
 * Two 32-byte directional root keys for ratchet.ts (HKDF-SHA256 bits, infos 'trustweb-device-sync/v2/root/lo>hi' and
 * '.../root/hi>lo', the same salt as derivePairKeys) plus the same SAS. `send` seeds my sending chain, `recv` my receiving
 * chain; the peer gets them crosswise. The roots are raw bytes because the chain state is persisted (ratchet.ts ChainState).
 */
export async function derivePairRoots(
  mine: DeviceKeys,
  theirPublicKey: Uint8Array,
  context: Uint8Array = new Uint8Array(0),
): Promise<{ send: Uint8Array; recv: Uint8Array; sas: string }> {
  const { base, salt, iAmLo, sas } = await pairBase(mine, theirPublicKey, context)
  const loHi = new Uint8Array(await subtle().deriveBits(hkdfParams(salt, LABEL_ROOT_LO_HI), base, 256))
  const hiLo = new Uint8Array(await subtle().deriveBits(hkdfParams(salt, LABEL_ROOT_HI_LO), base, 256))
  return iAmLo ? { send: loHi, recv: hiLo, sas } : { send: hiLo, recv: loHi, sas }
}

/** HKDF(secret, salt empty, info 'trustweb-device-sync/v2/pair') → AES-GCM-256, for the one `pair` message. */
export async function secretKeyFromPairingSecret(secret: Uint8Array): Promise<CryptoKey> {
  if (!(secret instanceof Uint8Array) || secret.length < MIN_PAIRING_SECRET) {
    throw new Error(`pairing secret must be at least ${MIN_PAIRING_SECRET} bytes`)
  }
  return aesKey(await hkdfBase(secret), new Uint8Array(0), LABEL_PAIR)
}

// ---------------------------------------------------------------------------------------------------------------------------
// base58btc (Bitcoin alphabet) and did:peer:2 `E` extraction.
// ---------------------------------------------------------------------------------------------------------------------------

const base58Alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export function base58btcEncode(b: Uint8Array): string {
  let zeros = 0
  while (zeros < b.length && b[zeros] === 0) zeros++
  // Big-endian base-58 digits, little-endian in the working array.
  const digits: number[] = []
  for (let i = zeros; i < b.length; i++) {
    let carry = b[i]
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8
      digits[j] = carry % 58
      carry = (carry / 58) | 0
    }
    while (carry > 0) {
      digits.push(carry % 58)
      carry = (carry / 58) | 0
    }
  }
  let out = '1'.repeat(zeros)
  for (let i = digits.length - 1; i >= 0; i--) out += base58Alphabet[digits[i]]
  return out
}

export function base58btcDecode(s: string): Uint8Array {
  let zeros = 0
  while (zeros < s.length && s[zeros] === '1') zeros++
  const bytes: number[] = [] // little-endian
  for (let i = zeros; i < s.length; i++) {
    const v = base58Alphabet.indexOf(s[i])
    if (v < 0) throw new Error(`base58btc: invalid character at index ${i}`)
    let carry = v
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58
      bytes[j] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  const out = new Uint8Array(zeros + bytes.length)
  for (let i = 0; i < bytes.length; i++) out[out.length - 1 - i] = bytes[i]
  return out
}

/**
 * The X25519 key of a did:peer:2 (the first `E` element: multibase 'z' + base58btc of 0xec 0x01 || 32 bytes).
 * Throws if the DID is not did:peer:2, has no `E` element, or the element is malformed.
 */
export function x25519PublicKeyFromDidPeer2(did: string): Uint8Array {
  if (typeof did !== 'string' || !did.startsWith('did:peer:2.')) throw new Error('not a did:peer:2')
  const el = did.split('.').slice(1).find((p) => p.startsWith('E'))
  if (el === undefined) throw new Error('did:peer:2 has no E (key agreement) element')
  if (el[1] !== 'z') throw new Error('did:peer:2 E element is not multibase base58btc')
  const raw = base58btcDecode(el.slice(2))
  if (raw.length !== X25519_MULTICODEC.length + KEY_LEN || raw[0] !== X25519_MULTICODEC[0] || raw[1] !== X25519_MULTICODEC[1]) {
    throw new Error('did:peer:2 E element is not an X25519 public key')
  }
  return raw.slice(X25519_MULTICODEC.length)
}
