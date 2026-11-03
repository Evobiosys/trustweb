// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * bytes.ts -- the byte/text/JSON helpers every other device-sync module stands on.
 *
 * WHY a file of its own (and not apps/demo/src/crypto.ts): this package has zero runtime dependencies and must not import a
 * sibling app. The helpers are also STRICTER than the demo's on purpose, because their output is hashed and authenticated:
 *  - `fromB64u` rejects every string that is not the one canonical unpadded encoding of some byte string (bad character,
 *    impossible length, non-zero trailing bits). One byte string = one text, so nothing upstream has to wonder whether two
 *    different wires carry "the same" ciphertext.
 *  - `fromUtf8` is fatal: invalid UTF-8 throws instead of silently becoming U+FFFD.
 *  - `canonicalJson` is the input of the log's hash chain and of every seal. Keys are sorted recursively (by UTF-16 code unit,
 *    i.e. JavaScript's default sort), undefined-valued object keys are omitted, and anything JSON cannot represent exactly
 *    (bigint, function, symbol, NaN/Infinity, undefined as a value or array element, non-plain objects such as Date/Map)
 *    throws rather than being coerced. Two devices that hold equal data therefore produce byte-identical text.
 *
 * WHAT IS NOT CLAIMED: canonicalJson is a deterministic serialisation for THIS package, not an implementation of RFC 8785 (JCS);
 * numbers are printed by JavaScript's own Number#toString. `equalBytes` is constant-time in the content of equal-length inputs
 * only (a length mismatch returns early: lengths are not secret here), and "constant time" is best effort in a JIT-compiled
 * language, not a verified property.
 */

const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const B64U_VAL: Int8Array = (() => {
  const t = new Int8Array(128).fill(-1)
  for (let i = 0; i < B64U.length; i++) t[B64U.charCodeAt(i)] = i
  return t
})()

/** base64url (RFC 4648 §5), no padding. */
export function toB64u(b: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 3 <= b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2]
    out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63] + B64U[(n >> 6) & 63] + B64U[n & 63]
  }
  const rem = b.length - i
  if (rem === 1) {
    const n = b[i] << 16
    out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63]
  } else if (rem === 2) {
    const n = (b[i] << 16) | (b[i + 1] << 8)
    out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63] + B64U[(n >> 6) & 63]
  }
  return out
}

/** Inverse of {@link toB64u}. Throws on a character outside the alphabet, an impossible length or non-zero trailing bits. */
export function fromB64u(s: string): Uint8Array {
  if (s.length % 4 === 1) throw new Error('fromB64u: impossible length')
  const out = new Uint8Array(Math.floor((s.length * 6) / 8))
  let buf = 0
  let bits = 0
  let o = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const v = c < 128 ? B64U_VAL[c] : -1
    if (v < 0) throw new Error(`fromB64u: invalid character at index ${i}`)
    buf = ((buf << 6) | v) & 0xffff
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (buf >> bits) & 0xff
    }
  }
  if ((buf & ((1 << bits) - 1)) !== 0) throw new Error('fromB64u: non-canonical trailing bits')
  return out
}

const ENC = new TextEncoder()
const DEC = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

export function utf8(s: string): Uint8Array {
  return ENC.encode(s)
}

/** Decodes UTF-8; throws on invalid input (fatal decoder). */
export function fromUtf8(b: Uint8Array): string {
  return DEC.decode(b)
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  let n = 0
  for (const p of parts) n += p.length
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Equal-length inputs are compared without an early exit; a length mismatch is simply false. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource))
}

/** Deterministic JSON: keys sorted recursively, undefined-valued keys omitted, arrays in order; throws on non-JSON values. */
export function canonicalJson(v: unknown): string {
  switch (typeof v) {
    case 'string':
      return JSON.stringify(v)
    case 'boolean':
      return v ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(v)) throw new TypeError('canonicalJson: non-finite number')
      return JSON.stringify(v)
    case 'object': {
      if (v === null) return 'null'
      if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x)).join(',')}]`
      const proto = Object.getPrototypeOf(v)
      if (proto !== Object.prototype && proto !== null) throw new TypeError('canonicalJson: not a plain object')
      const o = v as Record<string, unknown>
      const parts: string[] = []
      for (const k of Object.keys(o).sort()) {
        if (o[k] === undefined) continue
        parts.push(`${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      }
      return `{${parts.join(',')}}`
    }
    default:
      throw new TypeError(`canonicalJson: ${typeof v} is not JSON`)
  }
}
