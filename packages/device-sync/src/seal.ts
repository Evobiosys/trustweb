// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * seal.ts -- the one envelope every device-sync message travels in.
 *
 * WHY: the relay (apps/demo/src/relay.ts, raw path) routes on a cleartext outer `to` and carries a cleartext `from`; both can be
 * rewritten by the relay or anyone who can submit to it. So the seal binds them: AES-GCM with a fresh random 12-byte IV and
 * AAD = `trustweb-device-sync/v2|<from>|<to>|<ctr>`. A wire that is re-addressed to another device, re-attributed to another
 * sender, or given another counter fails authentication and opens as `null`. An address containing the separator `|` is
 * refused (aadOf throws), so "a|b" + "c" can never authenticate as "a" + "b|c".
 *
 * Wire = base64url(ctr as 8-byte big-endian unsigned || iv (12) || ciphertext||tag (16)).
 * The counter sits OUTSIDE the ciphertext because the ratchet (ratchet.ts) derives the message key FROM the counter: the
 * receiver has to know which key to use before it can decrypt. It is authenticated (it is in the AAD), so it cannot be altered,
 * but it is not hidden. `peekCtr` reads it; `openMessage` accepts either a fixed key or a resolver `(ctr) => key | null`.
 * A resolver is called with an UNAUTHENTICATED counter (anyone can put any number in front of garbage), so a caller must treat
 * whatever state it derives there as tentative and commit it only after `openMessage` returned a message.
 *
 * Padding (PR #68 finding 4): the plaintext is
 *     4-byte big-endian length of J || J || zero bytes up to the smallest of PAD_BUCKETS (1 KiB, 4 KiB, 16 KiB, 64 KiB) >= 4 + |J|
 * where J = canonical JSON of `{ kind, body }`. A J longer than 65 532 bytes is refused ('too large to seal'); sync.ts pieces
 * (CHUNK_BYTES 45 000 raw → 60 000 base64url + a small body) fit the last bucket. `openMessage` accepts exactly that frame and
 * nothing else: the size must be the bucket the length implies, and every padding byte must be zero.
 *
 * `openMessage` never throws: every failure (bad base64url, too short, bad counter, resolver gives no key or throws, AEAD
 * failure, bad frame or padding, bad UTF-8, bad JSON, missing or invalid kind) is the same `null`, so a caller cannot leak
 * which check failed and must treat all of them as "not ours".
 *
 * WHAT IS NOT CLAIMED (I7):
 *  - Opening a wire proves only that someone holding this key sealed it for this (from, to, ctr). It does NOT prove freshness:
 *    replays are stopped by the caller (the ratchet's one-time message keys, or replay.ts), not here.
 *  - Forward secrecy is NOT a property of this file: with a static key (keys.ts derivePairKeys) there is none; with per-message
 *    keys from ratchet.ts there is what that module claims, no more. NO post-quantum security.
 *  - NO metadata protection. The relay sees both addresses and the time, and now also the COUNTER: how many messages this
 *    direction has carried so far, and gaps or reordering. That is one more piece of metadata than when the counter was inside
 *    the ciphertext, accepted as the price of per-message keys. Sizes are rounded up to one of four buckets, so the relay no
 *    longer learns the exact record size, but it still sees WHICH bucket (roughly: a small message, a few KiB, up to 16 KiB, or
 *    a full sync piece) and how many pieces a sync round has. Padding hides size within a bucket, not the shape of a sync.
 *  - Random 96-bit IVs: safe for far more messages than two personal devices will ever exchange under one key (the NIST
 *    2^32-messages bound), but this is a bound we rely on, not a nonce-misuse-resistant construction.
 */
import { canonicalJson, concat, fromB64u, fromUtf8, randomBytes, toB64u, utf8 } from './bytes.ts'

export const WIRE_VERSION = 2
export const AAD_PREFIX = 'trustweb-device-sync/v2'
/** Plaintext sizes (length prefix + JSON + zero padding) a sealed message is rounded up to. */
export const PAD_BUCKETS: readonly number[] = Object.freeze([1024, 4096, 16384, 65536])

const CTR_LEN = 8
const IV_LEN = 12
const TAG_LEN = 16
const LEN_LEN = 4
const MAX_JSON = PAD_BUCKETS[PAD_BUCKETS.length - 1] - LEN_LEN

export interface Sealed {
  ctr: number
  kind: string
  body: unknown
}

/** A fixed key, or a function that resolves the key for a counter (null = no key for it). */
export type KeyOrResolver = CryptoKey | ((ctr: number) => Promise<CryptoKey | null>)

function validCtr(ctr: unknown): ctr is number {
  return typeof ctr === 'number' && Number.isSafeInteger(ctr) && ctr > 0
}

/** utf8(`${AAD_PREFIX}|${from}|${to}|${ctr}`); throws if either address contains '|' or ctr is not a positive safe integer. */
export function aadOf(from: string, to: string, ctr: number): Uint8Array {
  if (from.includes('|') || to.includes('|')) throw new Error("device-sync address must not contain '|'")
  if (!validCtr(ctr)) throw new Error('aadOf: ctr must be a positive safe integer')
  return utf8(`${AAD_PREFIX}|${from}|${to}|${ctr}`)
}

function ctrPrefix(ctr: number): Uint8Array {
  const out = new Uint8Array(CTR_LEN)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, Math.floor(ctr / 2 ** 32), false)
  dv.setUint32(4, ctr >>> 0, false)
  return out
}

function readCtr(framed: Uint8Array): number | null {
  if (framed.length < CTR_LEN + IV_LEN + TAG_LEN) return null
  const dv = new DataView(framed.buffer, framed.byteOffset, CTR_LEN)
  const hi = dv.getUint32(0, false)
  if (hi >= 0x200000) return null // >= 2^53: not a safe integer
  const ctr = hi * 2 ** 32 + dv.getUint32(4, false)
  return validCtr(ctr) ? ctr : null
}

/** The counter in a wire's cleartext prefix (unauthenticated!), or null when the wire does not decode or is too short. */
export function peekCtr(wire: string): number | null {
  try {
    if (typeof wire !== 'string') return null
    return readCtr(fromB64u(wire))
  } catch {
    return null
  }
}

function pad(json: Uint8Array): Uint8Array {
  const bucket = PAD_BUCKETS.find((b) => b >= LEN_LEN + json.length)
  if (bucket === undefined || json.length > MAX_JSON) throw new Error(`sealMessage: too large to seal (${json.length} bytes of JSON, the most is ${MAX_JSON})`)
  const out = new Uint8Array(bucket) // zero-filled
  new DataView(out.buffer).setUint32(0, json.length, false)
  out.set(json, LEN_LEN)
  return out
}

/** The JSON inside a padded frame, or null unless the frame is exactly what {@link pad} produces. */
function unpad(pt: Uint8Array): Uint8Array | null {
  if (pt.length < LEN_LEN) return null
  const len = new DataView(pt.buffer, pt.byteOffset, pt.byteLength).getUint32(0, false)
  if (len > MAX_JSON) return null
  if (PAD_BUCKETS.find((b) => b >= LEN_LEN + len) !== pt.length) return null
  let nonzero = 0
  for (let i = LEN_LEN + len; i < pt.length; i++) nonzero |= pt[i]
  if (nonzero !== 0) return null
  return pt.subarray(LEN_LEN, LEN_LEN + len)
}

/**
 * base64url(ctr(8, BE) || iv || AES-GCM(key, iv, pad(utf8(canonicalJson({kind, body}))), aadOf(from, to, ctr))).
 * Rejects a message openMessage would refuse, and one whose JSON exceeds the largest bucket ('too large to seal').
 */
export async function sealMessage(key: CryptoKey, from: string, to: string, msg: Sealed): Promise<string> {
  if (!validCtr(msg.ctr)) throw new Error('sealMessage: ctr must be a positive safe integer')
  if (typeof msg.kind !== 'string') throw new Error('sealMessage: kind must be a string')
  const aad = aadOf(from, to, msg.ctr)
  const plaintext = pad(utf8(canonicalJson({ kind: msg.kind, body: msg.body })))
  const iv = randomBytes(IV_LEN)
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    plaintext as BufferSource,
  )
  return toB64u(concat(ctrPrefix(msg.ctr), iv, new Uint8Array(ct)))
}

/**
 * Inverse of {@link sealMessage}. Never throws; `null` for anything that is not an authentic, well-formed message.
 * With a resolver, the key is looked up for the wire's counter (only after the prefix decoded to a valid counter).
 */
export async function openMessage(key: KeyOrResolver, from: string, to: string, wire: string): Promise<Sealed | null> {
  try {
    if (typeof wire !== 'string') return null
    const framed = fromB64u(wire)
    const ctr = readCtr(framed)
    if (ctr === null) return null
    const aad = aadOf(from, to, ctr)
    const k = typeof key === 'function' ? await key(ctr) : key
    if (!k) return null
    const pt = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: framed.slice(CTR_LEN, CTR_LEN + IV_LEN) as BufferSource, additionalData: aad as BufferSource },
      k,
      framed.slice(CTR_LEN + IV_LEN) as BufferSource,
    )
    const json = unpad(new Uint8Array(pt))
    if (json === null) return null
    const v: unknown = JSON.parse(fromUtf8(json))
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    const o = v as Record<string, unknown>
    if (typeof o.kind !== 'string') return null
    return { ctr, kind: o.kind, body: o.body === undefined ? null : o.body }
  } catch {
    return null
  }
}
