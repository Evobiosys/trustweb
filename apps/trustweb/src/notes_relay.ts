// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 32 (notes-relay): a shared note of more than ~100 items does not fit a link. It is sealed on this phone for the recipient (the same pair key as the
 * relay chat: X25519 between the two DIDs, then AES-GCM), cut into frames and left on the backup server (services/trustweb-backup/notes_relay.mjs) until the
 * recipient's app fetches and deletes it. The server holds opaque bytes only; I1: the note leaves the phone only sealed for the one person it is shared with.
 * Pure helpers plus two requests (postNote, pollRelay) with an injected fetch, so tests need no network.
 */
import { ecdhSharedSecret, type Identity } from '../../demo/src/did'
import { deriveEcdhPairKey, open, randomBytes, seal, toB64u } from '../../demo/src/crypto'
import { cleanNote, countBlocks, type SharedNote } from './notes_outline'

/** Up to this many items go the direct way (a link); above it, the relay. */
export const RELAY_ITEMS_MAX = 100
/** The server keeps a blob 29 days (its cap is 30). */
export const RELAY_TTL_MS = 29 * 86_400_000
/** The server's cap per blob. */
export const RELAY_BLOB_MAX = 20 * 1024 * 1024
const KEY_INFO = 'trustweb-notes-relay/v1'
const IV_BYTES = 12
const SET_ID_BYTES = 16
const HEADER_BYTES = SET_ID_BYTES + 4
const ON_KEY = 'trustweb.ui.notesrelay'
type Store = Pick<Storage, 'getItem' | 'setItem'>

export const relayNeeded = (note: SharedNote, max = RELAY_ITEMS_MAX, directAvailable = true): boolean => !directAvailable || countBlocks(note.blocks) > max

/** The relay is on unless this device switched it off (stored on the device only, like the sync mode). */
export function readRelayOn(st: Store = localStorage): boolean {
  try { return st.getItem(ON_KEY) !== 'off' } catch { return true }
}

export function writeRelayOn(on: boolean, st: Store = localStorage): void {
  try { st.setItem(ON_KEY, on ? 'on' : 'off') } catch { /* not remembered */ }
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

const pairKey = (me: Identity, theirDid: string): Promise<CryptoKey> => deriveEcdhPairKey(ecdhSharedSecret(me, theirDid), KEY_INFO)

/** [12-byte IV][AES-GCM of the note as JSON], under the pair key of `me` and `toDid`. */
export async function sealNote(note: SharedNote, me: Identity, toDid: string): Promise<Uint8Array> {
  const iv = randomBytes(IV_BYTES)
  const cipher = await seal(await pairKey(me, toDid), iv, new TextEncoder().encode(JSON.stringify(note)))
  return concat([iv, cipher])
}

/** The note `fromDid` sealed for `me`; null when it does not open or is damaged. Never throws. */
export async function openNote(bytes: Uint8Array, me: Identity, fromDid: string): Promise<SharedNote | null> {
  try {
    if (bytes.length <= IV_BYTES) return null
    const plain = await open(await pairKey(me, fromDid), bytes.slice(0, IV_BYTES), bytes.slice(IV_BYTES))
    return plain ? cleanNote(JSON.parse(new TextDecoder().decode(plain))) : null
  } catch {
    return null
  }
}

export function splitBytes(bytes: Uint8Array, max: number): Uint8Array[] {
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += max) out.push(bytes.slice(i, i + max))
  return out
}

/** The pieces of `bytes`, each behind a header [16-byte set id][u16 index][u16 count], so the recipient can put them back together. */
export function frameChunks(bytes: Uint8Array, max: number): Uint8Array[] {
  const setId = randomBytes(SET_ID_BYTES)
  const pieces = splitBytes(bytes, max)
  return pieces.map((piece, i) => {
    const frame = new Uint8Array(HEADER_BYTES + piece.length)
    frame.set(setId)
    new DataView(frame.buffer).setUint16(SET_ID_BYTES, i)
    new DataView(frame.buffer).setUint16(SET_ID_BYTES + 2, pieces.length)
    frame.set(piece, HEADER_BYTES)
    return frame
  })
}

const setIdOf = (frame: Uint8Array): string => toB64u(frame.slice(0, SET_ID_BYTES))

/** The bytes the frames of ONE set carry; null when a piece is missing, a frame is short or the frames belong to different sets. */
export function joinFrames(frames: Uint8Array[]): Uint8Array | null {
  if (!frames.length || frames.some((f) => f.length < HEADER_BYTES) || new Set(frames.map(setIdOf)).size !== 1) return null
  const count = new DataView(frames[0].buffer, frames[0].byteOffset).getUint16(SET_ID_BYTES + 2)
  const parts: (Uint8Array | undefined)[] = Array.from({ length: count })
  for (const f of frames) {
    const view = new DataView(f.buffer, f.byteOffset)
    if (view.getUint16(SET_ID_BYTES + 2) === count) parts[view.getUint16(SET_ID_BYTES)] = f.slice(HEADER_BYTES)
  }
  if (parts.some((p) => p === undefined)) return null
  return concat(parts as Uint8Array[])
}

const b64 = (bytes: Uint8Array): string => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export interface RelayEnvelope { to: string; from: string; blob: string; size: number; expires: number }

export const relayEnvelope = (to: string, from: string, bytes: Uint8Array, now: number): RelayEnvelope => ({ to, from, blob: b64(bytes), size: bytes.length, expires: now + RELAY_TTL_MS })

/** 64 hex characters only this key can make; the server stores their SHA-256 and lets the same token back in (first claim, like /backup). One per role. */
export async function relayToken(me: Identity, role: 'send' | 'read'): Promise<string> {
  const material = concat([new TextEncoder().encode(`${KEY_INFO}/${role}\0`), me.signing.secretKey])
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', material as BufferSource)), (b) => b.toString(16).padStart(2, '0')).join('')
}

type Answer = { status: number; ok: boolean; json?: () => Promise<unknown> }
export interface RelayDeps {
  /** The host the relay lives on (SERVER_ORIGIN). */
  origin: string
  fetch: (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<Answer>
  now: () => number
}

const route = (d: RelayDeps, query = ''): string => `${d.origin}/notes/relay${query}`
const forWho = (did: string, id?: string): string => `?for=${encodeURIComponent(did)}${id ? `&id=${id}` : ''}`

/** Seals `note` for `toDid` and leaves it on the relay. True when every piece went up; false (never a throw) otherwise. */
export async function postNote(d: RelayDeps, note: SharedNote, me: Identity, toDid: string): Promise<boolean> {
  try {
    const headers = { 'Content-Type': 'application/json', 'X-Relay-Token': await relayToken(me, 'send') }
    for (const frame of frameChunks(await sealNote(note, me, toDid), RELAY_BLOB_MAX - HEADER_BYTES)) {
      const res = await d.fetch(route(d), { method: 'POST', headers, body: JSON.stringify(relayEnvelope(toDid, me.did, frame, d.now())) })
      if (!res.ok) return false
    }
    return true
  } catch {
    return false
  }
}

const jsonOf = async (res: Answer): Promise<Record<string, unknown> | null> => (res.ok && res.json ? ((await res.json()) as Record<string, unknown>) : null)

/** What is waiting for `me` from senders `knownFrom` accepts: each note that opens is deleted from the relay; one that does not open (or is not complete yet) stays. Never throws. */
export async function pollRelay(d: RelayDeps, me: Identity, knownFrom: (did: string) => boolean = () => true): Promise<{ from: string; note: SharedNote }[]> {
  try {
    const headers = { 'X-Relay-Token': await relayToken(me, 'read') }
    const listed = await jsonOf(await d.fetch(route(d, forWho(me.did)), { headers }))
    const sets = new Map<string, { from: string; ids: string[]; frames: Uint8Array[] }>()
    for (const item of (listed?.items ?? []) as { id: string; from: string }[]) {
      if (!knownFrom(item.from)) continue
      const one = await jsonOf(await d.fetch(route(d, forWho(me.did, item.id)), { headers }))
      if (typeof one?.blob !== 'string') continue
      const frame = unb64(one.blob)
      if (frame.length < HEADER_BYTES) continue
      const key = `${item.from}/${setIdOf(frame)}`
      const set = sets.get(key) ?? { from: item.from, ids: [], frames: [] }
      set.ids.push(item.id)
      set.frames.push(frame)
      sets.set(key, set)
    }
    const got: { from: string; note: SharedNote }[] = []
    for (const set of sets.values()) {
      const bytes = joinFrames(set.frames)
      const note = bytes && await openNote(bytes, me, set.from)
      if (!note) continue
      got.push({ from: set.from, note })
      for (const id of set.ids) await d.fetch(route(d, forWho(me.did, id)), { method: 'DELETE', headers })
    }
    return got
  } catch {
    return []
  }
}
