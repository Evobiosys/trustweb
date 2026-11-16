// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b hide-from-crypto (43b-D7, Jakob: "send the exclusion list along, all encrypted, so your friends can't see or modify it, and notify the
 * initial user if a friend's device tried to tamper with it, verifiably, with the sending itself"). The "Hide from" list of an ask that travels:
 *
 *   secret     per ask a random s0 (32 bytes); level L (the receivers L steps past the asker's direct contacts) uses
 *              sL = HKDF-SHA256(s(L-1), salt = root, "tw-hide-next-v1"): one-way, so a device further out cannot compute an earlier level.
 *   tags       per level the set { HMAC-SHA256(sL, did)[0..16) } of every DID hidden from, padded with random tags to a bucket of HIDE_BUCKET
 *              and sorted: no DID, no count below the bucket, different tags per level and per ask.
 *   blob       ExclusionBlob {v, r: root, d: asker DID, m: reach, x: expiry, t: tags per level, k: a commitment SHA-256(sL) per level
 *              0..m-1 (review-44: binds each level secret to the signed blob, so a forwarder cannot hand on another key that would make
 *              hidden DIDs further out test as not hidden), g: Ed25519 signature of the asker's identity key over all of it}. Forwarders pass it on unchanged; the reach is signed too, so it cannot be raised.
 *   level key  each receiver gets the secret of its own level in `hk`, inside the envelope sealed with the pair key (the sealed box): a
 *              forwarder at hop k tests its candidates for level k+1 with s(k+1) and hands s(k+1) on. It learns whether a DID it already
 *              holds is hidden, never the list (residual leak, see the report).
 *   check      verifyAskExclusion before an ask is honoured: a changed blob fails and the device answers like no match, passes nothing on,
 *              and seals a TamperReport straight to the asker's DID (answers-44a, Q3: not back through the device that changed the list).
 *              The report names nobody: no reporter DID, no signature; the MAC with its level secret proves that a device which received
 *              this ask at that hop made it; the asker rejects forged, replayed and "tampered" claims about the genuine blob.
 *   seal       sealHideReport: X25519 from a fresh ephemeral key to the asker's key-agreement key (handshake_crypto.ts key derivation,
 *              without the static-static part, so the sender stays anonymous to the asker), AES-GCM, padded to 256 bytes.
 * WebCrypto (HMAC, SHA-256) + apps/demo did.ts (@noble Ed25519, HKDF): runs in the browser and under node, never under plain-node MCP
 * (hide_reports.ts is the record side for that).
 */
import { hkdfSha256, resolveDidPeer, signBytes, verifyDidSignature, x25519Ephemeral, x25519Shared } from '../../demo/src/did'
import type { Identity } from '../../demo/src/did'
import { fromB64u, randomBytes, toB64u } from '../../demo/src/crypto'
import { HIDE_BLOB_MAX_JSON, HIDE_REPORT_MAX_JSON, HOP_CAP } from '../../demo/src/types'
import { deriveHandshakeKey, openHandshake, padWire, sealHandshake } from './handshake_crypto'
import type { HideReason } from './hide_reports'

export { HIDE_BLOB_MAX_JSON }
export type { HideReason } from './hide_reports'

/** The exclusion-list protocol version. A blob of a later version is 'unsupported': never forwarded unverified. */
export const ASK_EXCLUSION_V = 1
/** Every level's tag set is padded to a multiple of this (an empty list looks like a list of up to eight). */
export const HIDE_BUCKET = 8
/** The most DIDs one ask may hide from (all devices of all hidden people); more and the ask does not travel past direct contacts. */
export const HIDE_TAGS_MAX = 48
/** A blob is honoured this long after the ask (the late-answer keep, late_answers.ts LATE_KEEP_MS). */
export const HIDE_BLOB_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** The asker remembers this many report nonces (replay ledger). */
export const HIDE_REPORT_LEDGER_MAX = 200
const CLOCK_SLACK_MS = 60_000
const TAG_BYTES = 16
const TAG_RE = /^[A-Za-z0-9_-]{22}$/
const NONCE_RE = /^[A-Za-z0-9_-]{22}$/
const te = new TextEncoder()

export interface ExclusionBlob { v: number; r: string; d: string; m: number; x: number; t: string[][]; k: string[]; g: string }
export type ExclusionCheck = 'ok' | 'tampered' | 'unsupported'
export interface TamperReport { v: 1; r: string; hop: number; h: string; why: HideReason; n: string; at: number; mac: string }
/** answers-44a: the report sealed to the asker's DID, sent on the relay's raw path. */
export const HIDE_REPORT_WIRE = 'hide-report2'
export interface HideReportWire { v: 1; t: typeof HIDE_REPORT_WIRE; e: string; n: string; c: string }
export type ReportCheck =
  | { ok: true; seen: string[]; report: { hop: number; why: HideReason; at: number } }
  | { ok: false; reason: 'malformed' | 'forged' | 'replay' | 'not-tampered' }

export const newAskSecret = (): Uint8Array => randomBytes(32)

/** The secret of level `level` (0 = the asker's direct contacts) of the ask `root`. */
export function deriveHopSecret(s0: Uint8Array, root: string, level: number): Uint8Array {
  let s = s0
  for (let i = 0; i < level; i++) s = hkdfSha256(s, te.encode(root), 'tw-hide-next-v1', 32)
  return s
}

const hmacKey = (sk: Uint8Array, use: KeyUsage[]): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', sk as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, use)

async function tagOf(key: CryptoKey, did: string): Promise<string> {
  return toB64u(new Uint8Array(await crypto.subtle.sign('HMAC', key, te.encode('tw-hide-tag|' + did))).slice(0, TAG_BYTES))
}

/** The keyed tags of `dids` under the level secret `sk`, padded with random tags to the bucket and sorted. RangeError past HIDE_TAGS_MAX. */
export async function tagSet(sk: Uint8Array, dids: readonly string[]): Promise<string[]> {
  const uniq = [...new Set(dids)]
  if (uniq.length > HIDE_TAGS_MAX) throw new RangeError(`hide list over ${HIDE_TAGS_MAX}`)
  const key = await hmacKey(sk, ['sign'])
  const tags = await Promise.all(uniq.map((d) => tagOf(key, d)))
  const size = Math.max(1, Math.ceil(uniq.length / HIDE_BUCKET)) * HIDE_BUCKET
  while (tags.length < size) tags.push(toB64u(randomBytes(TAG_BYTES)))
  return tags.sort()
}

const signedBytes = (b: Omit<ExclusionBlob, 'g'>): Uint8Array => te.encode('tw-hide-v1|' + JSON.stringify([b.v, b.r, b.d, b.m, b.x, b.t, b.k]))

/** The commitment to a level secret (16 bytes of SHA-256, base64url): one-way, so it shows nothing of the secret. */
async function commitOf(sk: Uint8Array): Promise<string> {
  const msg = new Uint8Array([...te.encode('tw-hide-commit-v1|'), ...sk])
  return toB64u(new Uint8Array(await crypto.subtle.digest('SHA-256', msg as BufferSource)).slice(0, TAG_BYTES))
}

/** Review-44: is `sk` the level secret the asker committed to for `level` (0 = its direct contacts)? Only for a blob that verified. */
export async function verifyLevelKey(blob: ExclusionBlob, level: number, sk: Uint8Array): Promise<boolean> {
  const want = blob.k[level]
  return typeof want === 'string' && sk.length === 32 && (await commitOf(sk)) === want
}

/** The asker's signed blob for an ask of reach `maxHops` (effective, 2..HOP_CAP): tag sets for levels 1..maxHops-1. */
export async function signAskExclusion(identity: Identity, a: { root: string; maxHops: number; issuedAt: number; s0: Uint8Array; dids: readonly string[] }): Promise<ExclusionBlob> {
  const t: string[][] = []
  const k: string[] = [await commitOf(a.s0)]
  for (let level = 1; level < a.maxHops; level++) {
    const sk = deriveHopSecret(a.s0, a.root, level)
    t.push(await tagSet(sk, a.dids))
    k.push(await commitOf(sk))
  }
  const body = { v: ASK_EXCLUSION_V, r: a.root, d: identity.did, m: a.maxHops, x: a.issuedAt + HIDE_BLOB_TTL_MS, t, k }
  return { ...body, g: signBytes(identity, signedBytes(body)) }
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/**
 * Is `blob` the asker's, for this ask? `root`/`maxHops` as the envelope says; `hop` the receiver's hop (0 = straight from the asker, whose
 * DID must then be the sender's); `senderDid` the device it came from. Anything changed, malformed, expired or signed by a forwarder: 'tampered'.
 */
export function verifyAskExclusion(blob: unknown, c: { root: string | null; maxHops: number; hop: number; now: number; senderDid: string }): ExclusionCheck {
  if (typeof blob !== 'object' || blob === null) return 'tampered'
  const b = blob as Record<string, unknown>
  if (typeof b.v === 'number' && Number.isInteger(b.v) && b.v > ASK_EXCLUSION_V) return 'unsupported'
  if (b.v !== ASK_EXCLUSION_V || !isStr(b.r) || !isStr(b.d) || !isStr(b.g) || !Number.isInteger(b.m) || typeof b.x !== 'number') return 'tampered'
  const m = b.m as number
  if (!Array.isArray(b.t) || b.t.length !== m - 1 || m < 2 || m > HOP_CAP) return 'tampered'
  const t = b.t as unknown[]
  if (!t.every((l) => Array.isArray(l) && l.length > 0 && l.length % HIDE_BUCKET === 0 && l.every((x) => typeof x === 'string' && TAG_RE.test(x)))) return 'tampered'
  if (!Array.isArray(b.k) || b.k.length !== m || !b.k.every((x) => typeof x === 'string' && TAG_RE.test(x))) return 'tampered'
  if (b.r !== c.root || m !== c.maxHops) return 'tampered'
  if (c.now > b.x || b.x > c.now + HIDE_BLOB_TTL_MS + CLOCK_SLACK_MS) return 'tampered'
  if (c.hop === 0 ? b.d !== c.senderDid : b.d === c.senderDid) return 'tampered'
  const body = { v: ASK_EXCLUSION_V, r: b.r, d: b.d, m, x: b.x, t: t as string[][], k: b.k as string[] }
  return verifyDidSignature(b.d, signedBytes(body), b.g) ? 'ok' : 'tampered'
}

/** Is any of `dids` (one person's devices) hidden at `level` (>= 1)? `sk` is that level's secret. Only for a blob that verified. */
export async function isExcluded(blob: ExclusionBlob, level: number, sk: Uint8Array, dids: readonly string[]): Promise<boolean> {
  const tags = blob.t[level - 1]
  if (!tags || !dids.length) return false
  const key = await hmacKey(sk, ['sign'])
  for (const d of dids) if (tags.includes(await tagOf(key, d))) return true
  return false
}

/** What a receiver hashes of the blob it got (the tamper evidence): SHA-256 of its JSON, 16 bytes, base64url. */
export async function blobHash(received: unknown): Promise<string> {
  const json = JSON.stringify(received) ?? 'null'
  return toB64u(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(json))).slice(0, 16))
}

const reportBytes = (r: Pick<TamperReport, 'r' | 'hop' | 'h' | 'why' | 'n' | 'at'>): Uint8Array =>
  te.encode('tw-hide-report-v2|' + JSON.stringify([1, r.r, r.hop, r.h, r.why, r.n, r.at]))

/** The receiver's report: what it got (`received`, hashed), at which hop, why; MAC'd with its level secret `sk`. No DID, no signature. */
export async function makeTamperReport(a: { root: string; hop: number; received: unknown; why: HideReason; sk: Uint8Array; at: number }): Promise<TamperReport> {
  const base = { r: a.root, hop: a.hop, h: await blobHash(a.received), why: a.why, n: toB64u(randomBytes(16)), at: a.at }
  const mac = toB64u(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(a.sk, ['sign']), reportBytes(base) as BufferSource)))
  return { v: 1, ...base, mac }
}

const SEAL_LABEL = 'tw-hide-report-seal-v1'
const sealTranscript = (askerDid: string): Uint8Array => te.encode(SEAL_LABEL + '|' + askerDid)

/** The report sealed to `askerDid` alone (anonymous sender: a fresh ephemeral key, no static one). Returns the wire text. */
export async function sealHideReport(rep: TamperReport, askerDid: string): Promise<string> {
  const pub = resolveDidPeer(askerDid).keyAgreementPublicKey
  const eph = x25519Ephemeral()
  try {
    const key = await deriveHandshakeKey(te.encode(SEAL_LABEL), eph.publicKey, pub, x25519Shared(eph.secretKey, pub))
    const box = await sealHandshake(padWire(JSON.stringify(rep)), key, sealTranscript(askerDid))
    const wire: HideReportWire = { v: 1, t: HIDE_REPORT_WIRE, e: toB64u(eph.publicKey), n: toB64u(box.n), c: toB64u(box.c) }
    return JSON.stringify(wire)
  } finally {
    eph.secretKey.fill(0)
  }
}

const B64U = /^[A-Za-z0-9_-]+$/
const isB64 = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && B64U.test(v)
/** Sealed ciphertext of a report at most HIDE_REPORT_MAX_JSON (padded) plus the GCM tag, as base64url. */
const WIRE_C_MAX = Math.ceil((HIDE_REPORT_MAX_JSON + 256 + 16) / 3) * 4

/** A sealed report wire, or null for anything else. */
export function parseHideReportWire(payload: string): HideReportWire | null {
  let o: unknown
  try { o = JSON.parse(payload) } catch { return null }
  if (typeof o !== 'object' || o === null) return null
  const w = o as Record<string, unknown>
  if (w.v !== 1 || w.t !== HIDE_REPORT_WIRE || !isB64(w.e, 64) || !isB64(w.n, 32) || !isB64(w.c, WIRE_C_MAX)) return null
  return { v: 1, t: HIDE_REPORT_WIRE, e: w.e, n: w.n, c: w.c }
}

/** The asker opens a report sealed to `me`; null when it does not open (another recipient, a changed byte) or is too large. */
export async function openHideReport(wire: HideReportWire, me: Identity): Promise<unknown> {
  try {
    const e = fromB64u(wire.e)
    if (e.length !== 32) return null
    const key = await deriveHandshakeKey(te.encode(SEAL_LABEL), e, me.keyAgreement.publicKey, x25519Shared(me.keyAgreement.secretKey, e))
    const plain = new TextDecoder().decode(await openHandshake({ n: fromB64u(wire.n), c: fromB64u(wire.c) }, key, sealTranscript(me.did), []))
    const json = plain.trimEnd()
    return json.length > HIDE_REPORT_MAX_JSON ? null : JSON.parse(json) as unknown
  } catch {
    return null
  }
}

/** The asker's check of a report about its ask `root` (secret `s0`, the hash of the blob it sent, its nonce ledger `seen`). */
export async function verifyTamperReport(rep: unknown, c: { root: string; s0: Uint8Array; sentHash: string; seen: readonly string[]; now: number }): Promise<ReportCheck> {
  if (typeof rep !== 'object' || rep === null) return { ok: false, reason: 'malformed' }
  const r = rep as Record<string, unknown>
  const hop = r.hop as number
  if (r.v !== 1 || !isStr(r.r) || !Number.isInteger(hop) || hop < 0 || hop >= HOP_CAP || !isStr(r.h) || (r.why !== 'tampered' && r.why !== 'unsupported')
    || typeof r.n !== 'string' || !NONCE_RE.test(r.n) || typeof r.at !== 'number' || !isStr(r.mac)) return { ok: false, reason: 'malformed' }
  if (r.r !== c.root || r.at > c.now + CLOCK_SLACK_MS || r.at < c.now - HIDE_BLOB_TTL_MS) return { ok: false, reason: 'forged' }
  const base = { r: r.r, hop, h: r.h, why: r.why as HideReason, n: r.n, at: r.at }
  let mac: Uint8Array
  try { mac = fromB64u(r.mac) } catch { return { ok: false, reason: 'malformed' } }
  const key = await hmacKey(deriveHopSecret(c.s0, c.root, hop), ['verify'])
  if (!(await crypto.subtle.verify('HMAC', key, mac as BufferSource, reportBytes(base) as BufferSource))) return { ok: false, reason: 'forged' }
  if (c.seen.includes(r.n)) return { ok: false, reason: 'replay' }
  if (base.why === 'tampered' && base.h === c.sentHash) return { ok: false, reason: 'not-tampered' }
  return { ok: true, seen: [...c.seen, r.n].slice(-HIDE_REPORT_LEDGER_MAX), report: { hop, why: base.why, at: base.at } }
}
