// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * seal.ts -- the one envelope every device-sync message travels in.
 *
 * WHY: the relay (apps/demo/src/relay.ts, raw path) routes on a cleartext outer `to` and carries a cleartext `from`; both can be
 * rewritten by the relay or anyone who can submit to it. So the seal binds them: AES-GCM with a fresh random 12-byte IV and
 * AAD = `trustweb-device-sync/v2|<from>|<to>`. A wire that is re-addressed to another device, or re-attributed to another
 * sender, fails authentication and opens as `null`. An address containing the separator `|` is refused (aadOf throws), so
 * "a|b" + "c" can never authenticate as "a" + "b|c".
 * The plaintext is canonical JSON of `{ ctr, kind, body }`; `ctr` is the per-direction counter replay.ts checks, and it is
 * INSIDE the authenticated plaintext, so the relay can neither read nor alter it. The wire is base64url(iv || ciphertext||tag).
 *
 * `openMessage` never throws: every failure (bad base64url, too short, AEAD failure, bad UTF-8, bad JSON, missing or invalid
 * ctr / kind) is the same `null`, so a caller cannot leak which check failed and must treat all of them as "not ours".
 *
 * WHAT IS NOT CLAIMED (I7):
 *  - Opening a wire proves only that someone holding this pair's directional key sealed it for this (from, to). It does NOT
 *    prove freshness: replays are stopped by replay.ts, not here.
 *  - NO forward secrecy (the key is static, see keys.ts), NO post-quantum security.
 *  - NO metadata protection: the relay sees both addresses, the time, and the ciphertext length, which is the plaintext length
 *    plus 28 bytes -- there is no padding.
 *  - Random 96-bit IVs: safe for far more messages than two personal devices will ever exchange under one key (the NIST
 *    2^32-messages bound), but this is a bound we rely on, not a nonce-misuse-resistant construction.
 */
import { canonicalJson, concat, fromB64u, fromUtf8, randomBytes, toB64u, utf8 } from './bytes.ts'

export const WIRE_VERSION = 2
export const AAD_PREFIX = 'trustweb-device-sync/v2'

const IV_LEN = 12
const TAG_LEN = 16

export interface Sealed {
  ctr: number
  kind: string
  body: unknown
}

/** utf8(`${AAD_PREFIX}|${from}|${to}`); throws if either address contains '|' (which would make the AAD ambiguous). */
export function aadOf(from: string, to: string): Uint8Array {
  if (from.includes('|') || to.includes('|')) throw new Error("device-sync address must not contain '|'")
  return utf8(`${AAD_PREFIX}|${from}|${to}`)
}

function validCtr(ctr: unknown): ctr is number {
  return typeof ctr === 'number' && Number.isSafeInteger(ctr) && ctr > 0
}

/** base64url(iv || AES-GCM(key, iv, utf8(canonicalJson(msg)), aad)). Rejects a message openMessage would refuse. */
export async function sealMessage(key: CryptoKey, from: string, to: string, msg: Sealed): Promise<string> {
  if (!validCtr(msg.ctr)) throw new Error('sealMessage: ctr must be a positive safe integer')
  if (typeof msg.kind !== 'string') throw new Error('sealMessage: kind must be a string')
  const aad = aadOf(from, to)
  const plaintext = utf8(canonicalJson({ ctr: msg.ctr, kind: msg.kind, body: msg.body }))
  const iv = randomBytes(IV_LEN)
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource, additionalData: aad as BufferSource },
    key,
    plaintext as BufferSource,
  )
  return toB64u(concat(iv, new Uint8Array(ct)))
}

/** Inverse of {@link sealMessage}. Never throws; `null` for anything that is not an authentic, well-formed message. */
export async function openMessage(key: CryptoKey, from: string, to: string, wire: string): Promise<Sealed | null> {
  try {
    if (typeof wire !== 'string') return null
    const framed = fromB64u(wire)
    if (framed.length < IV_LEN + TAG_LEN) return null
    const pt = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: framed.slice(0, IV_LEN) as BufferSource, additionalData: aadOf(from, to) as BufferSource },
      key,
      framed.slice(IV_LEN) as BufferSource,
    )
    const v: unknown = JSON.parse(fromUtf8(new Uint8Array(pt)))
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null
    const o = v as Record<string, unknown>
    if (!validCtr(o.ctr) || typeof o.kind !== 'string') return null
    return { ctr: o.ctr, kind: o.kind, body: o.body === undefined ? null : o.body }
  } catch {
    return null
  }
}
