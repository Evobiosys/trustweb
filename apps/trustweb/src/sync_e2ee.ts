// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Device sync v2, the crypto part (prototype; design: docs/design/device-sync-e2ee.md). Pure: WebCrypto and crypto.ts only, no DOM, no
 * network, no storage. sync_e2ee_link.ts drives it over the existing relay; sync_log.ts is what it carries.
 *
 * What v2 adds over the v1 seal in sync_link.ts (one AES-GCM key per pair, used in both directions, `exp` as the only freshness check):
 * - Key schedule: root = HKDF(X25519(own key, other device key) || one-time pairing secret), salted with both DIDs and the pairing epoch.
 *   One key per direction, so a frame can never be reflected back to its sender and read as the other device's.
 * - A six-digit check (SAS, short authentication string) from the same root, compared by the person on both screens (v1: four hex digits
 *   of the bare ECDH secret).
 * - Frame = clear header (version, epoch, sequence number) + random 96-bit IV + AES-GCM ciphertext; the header, both DIDs and a label are
 *   the additional data (AAD), so a header cannot be rewritten and a frame cannot be re-addressed.
 * - Padding to a few fixed size buckets: the relay learns a size class, not the size of a record.
 * - Replay guard: a window of seen sequence numbers with a moving floor, stored by the caller; the send counter is
 *   max(last + 1, now * 1000), so it keeps growing after a restore from an older backup.
 *
 * Not here: identity keys at rest (as v1, the caller's storage), forward secrecy (no ratchet yet), traffic analysis beyond sizes.
 */
import { fromB64u, randomBytes, toB64u } from '../../demo/src/crypto'

export const LABEL = 'trustweb-device-sync/v2'
const WIRE_VERSION = 2
const HEADER_LEN = 13
const IV_LEN = 12
const TAG_LEN = 16
/** Plaintext size classes (bytes, length prefix included). Above the last one a frame grows in steps of the last one. */
export const BUCKETS = [1024, 4096, 16_384, 65_536] as const
/** How many seen sequence numbers a pairing keeps; under the floor everything counts as seen. */
export const REPLAY_WINDOW = 512

const CODE_PREFIX = 'TWD2'
const LINK_KEY = 'tw-sync'
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/
const DID_RE = /^did:peer:2\.[A-Za-z0-9.:_-]{20,1500}$/

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s)
const subtle = (): SubtleCrypto => globalThis.crypto.subtle

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

// ---------------------------------------------------------------------------
// Pairing code and link: what the QR code shows, or what a link carries in its #fragment (never sent to any server).
// ---------------------------------------------------------------------------

export interface Offer { did: string; secret: string }

/** A fresh one-time pairing secret: 32 random bytes, base64url. */
export const newSecret = (): string => toB64u(randomBytes(32))

export function offerCode(did: string, secret: string): string {
  return [CODE_PREFIX, did, secret].join('~')
}

/** The code inside a link's fragment: a browser never sends the fragment to the server, and the app reads it locally. */
export function offerLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/#${LINK_KEY}=${encodeURIComponent(code)}`
}

/** A code, or a link with one in its fragment; null for anything else. */
export function parseOffer(text: string): Offer | null {
  let t = text.trim()
  const hash = t.indexOf('#')
  if (hash >= 0) {
    const params = new URLSearchParams(t.slice(hash + 1))
    t = params.get(LINK_KEY) ?? ''
  }
  const [prefix, did, secret, ...rest] = t.split('~')
  return prefix === CODE_PREFIX && rest.length === 0 && DID_RE.test(did ?? '') && SECRET_RE.test(secret ?? '') ? { did, secret } : null
}

// ---------------------------------------------------------------------------
// Key schedule
// ---------------------------------------------------------------------------

async function hkdfBits(ikm: Uint8Array, salt: Uint8Array, info: string, bits: number): Promise<Uint8Array> {
  const base = await subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await subtle().deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: utf8(info) as BufferSource }, base, bits))
}

async function hkdfAesKey(ikm: Uint8Array, info: string): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: utf8(info) as BufferSource },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export interface PairKeys {
  epoch: number
  /** Seals what this device sends to the other one. */
  sendKey: CryptoKey
  /** Opens what the other device sends to this one. */
  recvKey: CryptoKey
  /** The check both screens show, "123 456". */
  sas: string
}

export interface PairInput {
  /** X25519(own key-agreement secret, other device's key-agreement public key): did.ts ecdhSharedSecret. */
  ecdh: Uint8Array
  /** The one-time secret of the pairing code (raw bytes). */
  secret: Uint8Array
  myDid: string
  theirDid: string
  /** Chosen by the joining device per pairing; a re-pair gets a new one, so frames of an old pairing never open again. */
  epoch: number
}

/** Both devices call this with mirrored DIDs and get mirrored keys and the same check. */
export async function derivePairKeys(p: PairInput): Promise<PairKeys> {
  const [a, b] = [p.myDid, p.theirDid].sort()
  const salt = new Uint8Array(await subtle().digest('SHA-256', utf8(`${LABEL}\n${a}\n${b}\n${p.epoch}`) as BufferSource))
  const root = await hkdfBits(concat(p.ecdh, p.secret), salt, `${LABEL} root`, 256)
  const sasBytes = await hkdfBits(root, new Uint8Array(0), `${LABEL} sas`, 32)
  const n = new DataView(sasBytes.buffer).getUint32(0) % 1_000_000
  const digits = String(n).padStart(6, '0')
  return {
    epoch: p.epoch,
    sendKey: await hkdfAesKey(root, `${LABEL} key ${p.myDid}>${p.theirDid}`),
    recvKey: await hkdfAesKey(root, `${LABEL} key ${p.theirDid}>${p.myDid}`),
    sas: `${digits.slice(0, 3)} ${digits.slice(3)}`,
  }
}

/** The key the joining device seals its first message with: only someone holding the code can make or read it. */
export function offerKey(secret: Uint8Array, offerDid: string): Promise<CryptoKey> {
  return hkdfAesKey(secret, `${LABEL} offer ${offerDid}`)
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export interface FrameMeta { ep: number; seq: number }

function header(m: FrameMeta): Uint8Array {
  const h = new Uint8Array(HEADER_LEN)
  const v = new DataView(h.buffer)
  h[0] = WIRE_VERSION
  v.setUint32(1, m.ep >>> 0)
  v.setUint32(5, Math.floor(m.seq / 2 ** 32))
  v.setUint32(9, m.seq >>> 0)
  return h
}

const aadOf = (from: string, to: string, hdr: Uint8Array): Uint8Array => concat(utf8(`${LABEL}\n${from}\n${to}\n`), hdr)

/** The padded size for `n` plaintext bytes (4 bytes of length prefix included). */
export function padLen(n: number): number {
  const need = n + 4
  for (const b of BUCKETS) if (need <= b) return b
  const top = BUCKETS[BUCKETS.length - 1]
  return Math.ceil(need / top) * top
}

function pad(pt: Uint8Array): Uint8Array {
  const out = new Uint8Array(padLen(pt.length))
  new DataView(out.buffer).setUint32(0, pt.length)
  out.set(pt, 4)
  return out
}

function unpad(p: Uint8Array): Uint8Array | null {
  if (p.length < 4) return null
  const n = new DataView(p.buffer, p.byteOffset, p.byteLength).getUint32(0)
  return n <= p.length - 4 ? p.slice(4, 4 + n) : null
}

function decode(payload: string): Uint8Array | null {
  try { return fromB64u(payload) } catch { return null }
}

/** The clear header of a frame (what the relay sees besides the DIDs), or null when it is not a v2 frame. Says nothing about authenticity. */
export function peekFrame(payload: string): FrameMeta | null {
  const raw = decode(payload)
  if (!raw || raw.length < HEADER_LEN + IV_LEN + TAG_LEN || raw[0] !== WIRE_VERSION) return null
  const v = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  const seq = v.getUint32(5) * 2 ** 32 + v.getUint32(9)
  return Number.isSafeInteger(seq) ? { ep: v.getUint32(1), seq } : null
}

/** base64url(header || IV || AES-GCM(padded plaintext)), sealed for `to` as coming from `from`. */
export async function sealFrame(key: CryptoKey, meta: FrameMeta, from: string, to: string, plaintext: Uint8Array): Promise<string> {
  const hdr = header(meta)
  const iv = randomBytes(IV_LEN)
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: iv as BufferSource, additionalData: aadOf(from, to, hdr) as BufferSource }, key, pad(plaintext) as BufferSource))
  return toB64u(concat(hdr, iv, ct))
}

/** The plaintext and header of an authentic frame, or null for anything else (wrong key, direction, addresses, header, any flipped bit). Never throws. */
export async function openFrame(key: CryptoKey, from: string, to: string, payload: string): Promise<(FrameMeta & { plaintext: Uint8Array }) | null> {
  const meta = peekFrame(payload)
  const raw = meta && decode(payload)
  if (!meta || !raw) return null
  const hdr = raw.subarray(0, HEADER_LEN)
  try {
    const pt = await subtle().decrypt(
      { name: 'AES-GCM', iv: raw.subarray(HEADER_LEN, HEADER_LEN + IV_LEN) as BufferSource, additionalData: aadOf(from, to, hdr) as BufferSource },
      key, raw.subarray(HEADER_LEN + IV_LEN) as BufferSource,
    )
    const plaintext = unpad(new Uint8Array(pt))
    return plaintext ? { ...meta, plaintext } : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Replay guard. Admit a number only AFTER its frame opened, or a forged header could fill the window.
// ---------------------------------------------------------------------------

export interface ReplayState {
  /** Everything at or under this counts as seen. */
  floor: number
  /** Seen numbers above the floor, ascending, at most REPLAY_WINDOW. */
  seen: number[]
}

export const freshReplay = (): ReplayState => ({ floor: 0, seen: [] })

export function isReplay(st: ReplayState, seq: number): boolean {
  return seq <= st.floor || st.seen.includes(seq)
}

/** The state after `seq` was accepted; the oldest number drops into the floor once the window is full. Does not change `st`. */
export function admit(st: ReplayState, seq: number): ReplayState {
  const seen = [...st.seen, seq].sort((x, y) => x - y)
  let floor = st.floor
  while (seen.length > REPLAY_WINDOW) floor = seen.shift() as number
  return { floor, seen }
}

/** The next send number: one more than the last, and never under the clock in microsecond steps, so a restored older counter still grows. */
export function nextSeq(last: number, now: number): number {
  return Math.max(last + 1, Math.floor(now) * 1000)
}
