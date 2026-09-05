/**
 * Crypto primitives for the Web-of-Trust demo.
 *
 * WebCrypto only (`globalThis.crypto.subtle`). No dependencies. Works
 * identically in the browser and in Node >= 20 (both expose the same
 * `SubtleCrypto` global).
 *
 * ---------------------------------------------------------------------------
 * SECURITY NOTE -- read before reusing any of this outside the demo.
 * ---------------------------------------------------------------------------
 * `derivePairKey` is a *demo pairing*, not a security product. It binds the
 * two QR-exchanged nonces into a shared key, but it does this with **no
 * authenticated key exchange**: whoever sees both QR codes (e.g. an attacker
 * positioned during the connect ceremony) can compute the same key. A real
 * deployment needs an authenticated key agreement -- X25519 (or a PAKE) with
 * the public keys themselves carried in the QR codes and a fingerprint the
 * two humans can compare out of band -- not a KDF over two plaintext nonces.
 * Treat everything derived from this key as "keeps a passive local network
 * observer out", not as "resists an active attacker at pairing time".
 */

const B64U_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const B64U_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {}
  for (let i = 0; i < B64U_ALPHABET.length; i++) {
    table[B64U_ALPHABET[i]] = i
  }
  return table
})()

/** Cryptographically random bytes. */
export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

/**
 * A random identifier of exactly `len` base64url characters. Used for
 * Identity.id, ConnectEnvelope.nonce and QueryEnvelope.qid.
 */
export function randomId(len: number): string {
  if (len <= 0) return ''
  // Each base64url char encodes 6 bits; round up so we never run short.
  const bytesNeeded = Math.ceil((len * 6) / 8)
  return toB64u(randomBytes(bytesNeeded)).slice(0, len)
}

/**
 * base64url (RFC 4648 section 5), no padding. Hand-rolled rather than
 * btoa/Buffer so it behaves identically in the browser and in Node and never
 * risks a call-stack blowup from spreading a large byte array into
 * String.fromCharCode.
 */
export function toB64u(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  const len = bytes.length
  for (; i + 3 <= len; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out +=
      B64U_ALPHABET[(n >> 18) & 63] +
      B64U_ALPHABET[(n >> 12) & 63] +
      B64U_ALPHABET[(n >> 6) & 63] +
      B64U_ALPHABET[n & 63]
  }
  const rem = len - i
  if (rem === 1) {
    const n = bytes[i] << 16
    out += B64U_ALPHABET[(n >> 18) & 63] + B64U_ALPHABET[(n >> 12) & 63]
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out +=
      B64U_ALPHABET[(n >> 18) & 63] +
      B64U_ALPHABET[(n >> 12) & 63] +
      B64U_ALPHABET[(n >> 6) & 63]
  }
  return out
}

/**
 * Inverse of {@link toB64u}. Throws on any character outside the base64url
 * alphabet -- callers that need "never throw" semantics (e.g. wire.ts
 * decoding attacker-controlled QR content) must wrap this in try/catch.
 */
export function fromB64u(s: string): Uint8Array {
  const byteLen = Math.floor((s.length * 6) / 8)
  const out = new Uint8Array(byteLen)
  let bitBuffer = 0
  let bitCount = 0
  let outIdx = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    const val = B64U_LOOKUP[ch]
    if (val === undefined) {
      throw new Error(`fromB64u: invalid character ${JSON.stringify(ch)} at index ${i}`)
    }
    bitBuffer = (bitBuffer << 6) | val
    bitCount += 6
    if (bitCount >= 8) {
      bitCount -= 8
      out[outIdx++] = (bitBuffer >> bitCount) & 0xff
    }
  }
  return out
}

/**
 * HKDF-SHA256 the two pairing nonces into an AES-GCM 256 key.
 *
 * The two nonces are sorted before mixing so both devices -- regardless of
 * which one calls this with (mine, theirs) vs (theirs, mine) -- derive the
 * identical key.
 *
 * See the module-level SECURITY NOTE: this binds two QR nonces, it does not
 * authenticate either party.
 */
export async function derivePairKey(nonceA: string, nonceB: string): Promise<CryptoKey> {
  const [first, second] = [nonceA, nonceB].sort()
  const ikm = new TextEncoder().encode(`${first}|${second}`)
  const baseKey = await globalThis.crypto.subtle.importKey('raw', ikm, 'HKDF', false, [
    'deriveKey',
  ])
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('ew-demo-pair-v1'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * HKDF-SHA256 an X25519 ECDH shared secret (did.ts's `ecdhSharedSecret`) into
 * an AES-GCM 256 pair key.
 *
 * Real key agreement, unlike `derivePairKey` above: that function's input is
 * two plaintext nonces, so anyone who saw both -- including a relay either
 * nonce happened to pass through -- can compute the same key. This
 * function's input is an ECDH shared secret, which requires one party's
 * PRIVATE key-agreement key to compute; that key never leaves the device
 * that minted it, so a relay that carries both parties' did:peer:2 (public
 * keys only, as it must, to route -- relay.ts's module header) still cannot
 * derive this. See connect_link.ts's module header for why the one-scan
 * ceremony needs this instead of `derivePairKey`, and did.ts's
 * `ecdhSharedSecret` for the ECDH step itself.
 */
export async function deriveEcdhPairKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  const baseKey = await globalThis.crypto.subtle.importKey('raw', sharedSecret as BufferSource, 'HKDF', false, [
    'deriveKey',
  ])
  return globalThis.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: new TextEncoder().encode('ew-demo-ecdh-pair-v1'),
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * A fresh AES-GCM 256 key from the CSPRNG, bound to nothing and kept by
 * nobody.
 *
 * SECURITY (2026-09-06, follow-up 1 of the C-02/F-01 crypto review): this
 * exists so that a code path with NO pair key never falls back to deriving
 * one from data that travels in cleartext. `main.ts` used to answer a query
 * from an unknown sender under `derivePairKey(q.qid, q.qid)`; `qid` rides
 * unencrypted in both the QueryEnvelope and the AnswerEnvelope, so that key
 * was recomputable by anyone who saw either -- HKDF over public input is not
 * a secret. It was also recomputable ONLY by an eavesdropper: the asker
 * derives `pairKey(their own record of us)` and never the qid key, so
 * nothing sealed that way was ever readable by the one party entitled to
 * read it. The construction gave everything away and bought nothing.
 *
 * The replacement is deliberately a key nobody can reproduce, including us:
 * `generateKey` with `extractable: false`, never stored, never exported,
 * dropped the moment the seal returns. The resulting envelope is
 * undecryptable by everyone -- which is exactly right, because it only ever
 * carries the all-zero "nothing" plaintext (see `main.ts`'s `answerKeyFor`
 * and `gate.ts`'s `maskAnswerPlaintext`). Emitting a same-shape,
 * same-length, unreadable envelope keeps I3 intact; emitting nothing at all
 * would itself announce "this device does not know you".
 */
export async function randomThrowawayKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** AES-GCM encrypt. `iv` must be 12 bytes (the WebCrypto/NIST recommendation). */
export async function seal(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  // TS 5.9's DOM lib types `BufferSource` against `ArrayBuffer` specifically;
  // a bare `Uint8Array` parameter widens to `Uint8Array<ArrayBufferLike>` (it
  // may be backed by a SharedArrayBuffer), which no longer structurally
  // matches. The runtime values are perfectly normal typed arrays either way.
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    plaintext as BufferSource,
  )
  return new Uint8Array(ct)
}

/**
 * AES-GCM decrypt. Returns `null` on any authentication/format failure --
 * never throws. Callers (interpret(), decodeFromQr()) depend on this: a
 * corrupted or forged envelope must be indistinguishable from a genuine
 * "nothing" envelope, and that only holds if failure here is silent.
 */
export async function open(
  key: CryptoKey,
  iv: Uint8Array,
  ct: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    const pt = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ct as BufferSource,
    )
    return new Uint8Array(pt)
  } catch {
    return null
  }
}
