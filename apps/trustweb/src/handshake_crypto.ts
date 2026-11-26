// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 handshake-crypto (43c-D1, Jakob: "encrypt the connect handshake with the QR key"). The one wire that used to travel in
 * cleartext, the scanner's connect-ack (apps/demo/src/connect_link.ts: its name, id and DID), is now sealed end to end:
 *
 *   QR (v2)    the shower's connect link carries `k=` = qrSecretOf(identity): HKDF of its X25519 secret key, 16 bytes, stable, no storage.
 *              The link's DID already carries the shower's X25519 public key (ephB below; the shower is not online during a scan, so its
 *              key-agreement key stands in for its ephemeral one).
 *   scanner    fresh ephemeral X25519 pair (ephA); dh = X25519(ephA.secret, ephB); ss = X25519(scanner static secret, ephB) (review-44:
 *              authenticates the claimed sender DID, so neither the relay nor a holder of the QR secret can seal in another DID's name);
 *              key = HKDF-SHA256(ikm = dh || ss || qrSecret,
 *              salt = ephA || ephB, info "tw-handshake-v2"); AES-256-GCM, random 12-byte nonce, additional data = the transcript
 *              (version, mode, sender DID, receiver DID). The plaintext is padded to 256-byte steps so the name length does not show.
 *   shower     recomputes dh with its own secret key and qrSecret from its own identity; a wrong QR secret, another receiver, another
 *              claimed sender, a flipped byte or a nonce seen before fail closed (HandshakeError) and nothing is added.
 *
 * Mode 'did': a connect without a QR (a DID add, the directory, the owner admitting a held reach-out) seals the same way with an
 * empty QR secret; the relay still cannot read or forge it (it needs a private key), but the sender proved no QR possession.
 * A link WITHOUT k= is a QR of an app before v2: linkHandshake says 'unsupported' and the app asks to update both phones
 * (HANDSHAKE_PLAINTEXT_FALLBACK = false: never silently plaintext). Key material (ephemeral secret, dh, ikm) is zeroed after use;
 * the AES key is a non-extractable CryptoKey.
 */
import { hkdfSha256, resolveDidPeer, x25519Ephemeral, x25519Shared } from '../../demo/src/did'
import type { Identity } from '../../demo/src/did'
import { fromB64u, randomBytes, toB64u } from '../../demo/src/crypto'
import type { ConnectAckEnvelope } from '../../demo/src/types'

export const HANDSHAKE_VERSION = 2
export const HANDSHAKE_WIRE = 'connect-ack2'
/** Switch: false = a QR without a key (an app before v2) is refused with "update the app on both phones", and a cleartext connect-ack is refused. */
export const HANDSHAKE_PLAINTEXT_FALLBACK = false
/** The replay ledger keeps the nonces of this many opened handshakes (the relay may hold wires indefinitely, so no time window). */
export const HS_NONCE_LEDGER_MAX = 500
/** The "Connection not secure" notice stays this long (a security notice outlasts the usual 5 s fade). */
export const HANDSHAKE_NOTICE_MS = 15_000
const PAD = 256
const QR_SECRET_BYTES = 16
const INFO = 'tw-handshake-v2'

import type { HandshakeFailure, HandshakeMode } from './handshake_status'
export type { HandshakeFailure, HandshakeMode } from './handshake_status'

export class HandshakeError extends Error {
  constructor(readonly reason: HandshakeFailure) { super('handshake ' + reason) }
}

export interface HandshakeBox { n: Uint8Array; c: Uint8Array }
export interface HandshakeWire { v: 1; t: typeof HANDSHAKE_WIRE; hv: 2; m: HandshakeMode; e: string; n: string; c: string }

const te = new TextEncoder()
const cat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** The QR secret of this identity (base64url, 22 chars): one-way from its X25519 secret key, so the same on every call. */
export function qrSecretOf(identity: Identity): string {
  return toB64u(hkdfSha256(identity.keyAgreement.secretKey, new Uint8Array(0), 'tw-qr-secret-v2', QR_SECRET_BYTES))
}

/**
 * The session key: HKDF over the ephemeral shared secret, the static-static one (`ss`, empty only in the primitive tests) and the QR secret,
 * salted with both public keys. `dh` and `ss` are zeroed.
 */
export async function deriveHandshakeKey(qrSecret: Uint8Array, ephA: Uint8Array, ephB: Uint8Array, dh: Uint8Array, ss: Uint8Array = new Uint8Array(0)): Promise<CryptoKey> {
  const ikm = cat(dh, ss, qrSecret)
  try {
    const base = await globalThis.crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveKey'])
    return await globalThis.crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: cat(ephA, ephB) as BufferSource, info: te.encode(INFO) },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    )
  } finally {
    ikm.fill(0)
    dh.fill(0)
    ss.fill(0)
  }
}

export async function sealHandshake(msg: Uint8Array, key: CryptoKey, transcript: Uint8Array): Promise<HandshakeBox> {
  const n = randomBytes(12)
  const c = await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv: n as BufferSource, additionalData: transcript as BufferSource }, key, msg as BufferSource)
  return { n, c: new Uint8Array(c) }
}

/** Opens a box; a nonce in `seen` is a replay, any authentication failure is 'tampered'. */
export async function openHandshake(box: HandshakeBox, key: CryptoKey, transcript: Uint8Array, seen: readonly string[]): Promise<Uint8Array> {
  if (box.n.length !== 12) throw new HandshakeError('tampered')
  if (seen.includes(toB64u(box.n))) throw new HandshakeError('replay')
  try {
    return new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: box.n as BufferSource, additionalData: transcript as BufferSource }, key, box.c as BufferSource))
  } catch {
    throw new HandshakeError('tampered')
  }
}

/** The ledger with this nonce added, newest last, bounded. */
export const rememberHandshakeNonce = (seen: readonly string[], nonce: Uint8Array): string[] => [...seen, toB64u(nonce)].slice(-HS_NONCE_LEDGER_MAX)

/** How a connect from this link is sealed: 'qr' (v2 link), 'did' (no link: a DID add), 'unsupported' (a link of an app before v2). */
export function linkHandshake(link: { qk?: string | null }): HandshakeMode | 'unsupported' {
  if (typeof link.qk === 'string' && link.qk) return 'qr'
  if (link.qk === null) return HANDSHAKE_PLAINTEXT_FALLBACK ? 'did' : 'unsupported'
  return 'did'
}

const transcriptOf = (mode: HandshakeMode, fromDid: string, toDid: string): Uint8Array => te.encode(`${INFO}|${mode}|${fromDid}|${toDid}`)

const pad = (json: string): Uint8Array => {
  const raw = te.encode(json)
  const out = new Uint8Array(Math.ceil((raw.length + 1) / PAD) * PAD).fill(0x20) // JSON ignores trailing spaces
  out.set(raw)
  return out
}
/** answers-44a: hide_from_crypto.ts seals its tamper report padded the same way. */
export { pad as padWire }

/** The scanner's side: its connect-ack sealed by `from` to `toDid` (with that link's QR secret when there was one). Returns the wire text. */
export async function sealConnectAck(ack: ConnectAckEnvelope, from: Identity, toDid: string, qk?: string): Promise<string> {
  const mode: HandshakeMode = qk ? 'qr' : 'did'
  const ephB = resolveDidPeer(toDid).keyAgreementPublicKey
  const eph = x25519Ephemeral()
  try {
    const ss = x25519Shared(from.keyAgreement.secretKey, ephB)
    const key = await deriveHandshakeKey(qk ? fromB64u(qk) : new Uint8Array(0), eph.publicKey, ephB, x25519Shared(eph.secretKey, ephB), ss)
    const box = await sealHandshake(pad(JSON.stringify(ack)), key, transcriptOf(mode, from.did, toDid))
    const wire: HandshakeWire = { v: 1, t: HANDSHAKE_WIRE, hv: 2, m: mode, e: toB64u(eph.publicKey), n: toB64u(box.n), c: toB64u(box.c) }
    return JSON.stringify(wire)
  } finally {
    eph.secretKey.fill(0)
  }
}

const B64U = /^[A-Za-z0-9_-]+$/
const isB64 = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && B64U.test(v)

/** A sealed handshake wire, or null for anything else (a cleartext connect-ack included). */
export function parseHandshakeWire(payload: string): HandshakeWire | null {
  let o: unknown
  try { o = JSON.parse(payload) } catch { return null }
  if (typeof o !== 'object' || o === null) return null
  const w = o as Record<string, unknown>
  if (w.v !== 1 || w.t !== HANDSHAKE_WIRE || w.hv !== 2 || (w.m !== 'qr' && w.m !== 'did')) return null
  if (!isB64(w.e, 64) || !isB64(w.n, 32) || !isB64(w.c, 8192)) return null
  return { v: 1, t: HANDSHAKE_WIRE, hv: 2, m: w.m, e: w.e, n: w.n, c: w.c }
}

/** Is this a cleartext connect-ack (an app before v2)? */
export function isCleartextAck(payload: string): boolean {
  try { const o = JSON.parse(payload) as Record<string, unknown>; return o?.t === 'connect-ack' } catch { return false }
}

const innerAck = (o: unknown): ConnectAckEnvelope | null => {
  if (typeof o !== 'object' || o === null) return null
  const a = o as Record<string, unknown>
  const f = a.from as Record<string, unknown> | null
  if (a.v !== 1 || a.t !== 'connect-ack' || typeof a.did !== 'string' || !f || typeof f !== 'object' || typeof f.id !== 'string' || !f.id || typeof f.displayName !== 'string') return null
  if (a.reachOut !== undefined && a.reachOut !== true) return null
  if (a.ev !== undefined && a.ev !== true) return null
  if (a.inv !== undefined && (typeof a.inv !== 'string' || !a.inv || a.inv.length > 1200)) return null
  return { v: 1, t: 'connect-ack', from: { id: f.id, displayName: f.displayName }, did: a.did, ...(a.reachOut === true ? { reachOut: true as const } : {}), ...(a.ev === true ? { ev: true as const } : {}), ...(typeof a.inv === 'string' ? { inv: a.inv } : {}) }
}

/** The shower's side: opens a sealed connect-ack sent by `fromDid` to `me`. Returns the ack, the mode and the ledger with this nonce. */
export async function openConnectAck(wire: HandshakeWire, me: Identity, fromDid: string, seen: readonly string[]): Promise<{ ack: ConnectAckEnvelope; mode: HandshakeMode; seen: string[] }> {
  let ephA: Uint8Array, n: Uint8Array, c: Uint8Array
  try { ephA = fromB64u(wire.e); n = fromB64u(wire.n); c = fromB64u(wire.c) } catch { throw new HandshakeError('tampered') }
  if (ephA.length !== 32) throw new HandshakeError('tampered')
  const qs = wire.m === 'qr' ? fromB64u(qrSecretOf(me)) : new Uint8Array(0)
  let dh: Uint8Array, ss: Uint8Array
  try {
    dh = x25519Shared(me.keyAgreement.secretKey, ephA)
    ss = x25519Shared(me.keyAgreement.secretKey, resolveDidPeer(fromDid).keyAgreementPublicKey)
  } catch { qs.fill(0); throw new HandshakeError('tampered') }
  const key = await deriveHandshakeKey(qs, ephA, me.keyAgreement.publicKey, dh, ss)
  qs.fill(0)
  const plain = await openHandshake({ n, c }, key, transcriptOf(wire.m, fromDid, me.did), seen)
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder().decode(plain)) } catch { throw new HandshakeError('mismatch') }
  const ack = innerAck(parsed)
  if (!ack || ack.did !== fromDid) throw new HandshakeError('mismatch')
  return { ack, mode: wire.m, seen: rememberHandshakeNonce(seen, n) }
}

export { HANDSHAKE_LOG_MAX, handshakeStatus, logHandshake } from './handshake_status'
export type { HandshakeLogEntry } from './handshake_status'
