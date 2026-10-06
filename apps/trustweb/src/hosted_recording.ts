/**
 * A kept recording, sealed on this phone before it goes to the Swiss server
 * (wave 1733 round B, item 4). The server stores opaque bytes; only a phone
 * holding the hosted-account secret (swiss_server.ts) can open them.
 *
 * Layout: [0x01][12-byte random IV][AES-256-GCM( u32 header length | header JSON | take bytes ... ) + 16-byte tag]
 * header = {v: 1, takes: [{mimeType, offsetMs, durationMs, bytes}]}; the takes follow end to end.
 * AAD = "trustweb-hosted/v1/rec/<rid>", so a sealed recording cannot be replayed under another id.
 * Nothing about the meeting (who, where, the transcript) is in it: those live in the record.
 */
import type { StoredTake } from './audio_store'

const VERSION = 1
const IV_BYTES = 12
const TAG_BYTES = 16
const AAD_PREFIX = 'trustweb-hosted/v1/rec/'
/** Takes in one sealed recording; a header claiming more is refused. */
const MAX_TAKES = 200

interface SealedHeader {
  v: 1
  takes: { mimeType: string; offsetMs: number; durationMs: number; bytes: number }[]
}

const enc = new TextEncoder()
const dec = new TextDecoder()

function buf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

const aad = (rid: string): ArrayBuffer => buf(enc.encode(AAD_PREFIX + rid))

/** Seals the takes of one recording for the server. */
export async function sealRecording(key: CryptoKey, rid: string, takes: readonly StoredTake[]): Promise<Blob> {
  const header: SealedHeader = {
    v: 1,
    takes: takes.map((t) => ({ mimeType: t.mimeType, offsetMs: t.offsetMs, durationMs: t.durationMs, bytes: t.blob.size })),
  }
  const head = enc.encode(JSON.stringify(header))
  const parts = await Promise.all(takes.map(async (t) => new Uint8Array(await t.blob.arrayBuffer())))
  const plain = new Uint8Array(4 + head.length + parts.reduce((n, p) => n + p.length, 0))
  new DataView(plain.buffer).setUint32(0, head.length)
  plain.set(head, 4)
  let at = 4 + head.length
  for (const p of parts) { plain.set(p, at); at += p.length }
  const iv = new Uint8Array(IV_BYTES)
  crypto.getRandomValues(iv)
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: aad(rid) }, key, buf(plain)))
  const out = new Uint8Array(1 + IV_BYTES + cipher.length)
  out[0] = VERSION
  out.set(iv, 1)
  out.set(cipher, 1 + IV_BYTES)
  return new Blob([buf(out)], { type: 'application/octet-stream' })
}

function isHeader(v: unknown): v is SealedHeader {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return o.v === 1 && Array.isArray(o.takes) && o.takes.length <= MAX_TAKES && o.takes.every((t) => {
    if (typeof t !== 'object' || t === null) return false
    const x = t as Record<string, unknown>
    return typeof x.mimeType === 'string' && [x.offsetMs, x.durationMs, x.bytes].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)
  })
}

/** Opens a sealed recording back into takes; throws when it is not ours, damaged or changed. */
export async function openRecording(key: CryptoKey, rid: string, sealed: ArrayBuffer): Promise<StoredTake[]> {
  const bytes = new Uint8Array(sealed)
  if (bytes.length < 1 + IV_BYTES + TAG_BYTES + 4 || bytes[0] !== VERSION) throw new Error('not a sealed recording')
  const plain = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: buf(bytes.subarray(1, 1 + IV_BYTES)), additionalData: aad(rid) }, key, buf(bytes.subarray(1 + IV_BYTES)),
  ))
  const headLen = new DataView(plain.buffer, plain.byteOffset).getUint32(0)
  if (4 + headLen > plain.length) throw new Error('damaged recording')
  const header: unknown = JSON.parse(dec.decode(plain.subarray(4, 4 + headLen)))
  if (!isHeader(header)) throw new Error('damaged recording')
  const takes: StoredTake[] = []
  let at = 4 + headLen
  for (const t of header.takes) {
    if (at + t.bytes > plain.length) throw new Error('damaged recording')
    takes.push({ blob: new Blob([buf(plain.subarray(at, at + t.bytes))], { type: t.mimeType }), mimeType: t.mimeType, offsetMs: t.offsetMs, durationMs: t.durationMs })
    at += t.bytes
  }
  return takes
}
