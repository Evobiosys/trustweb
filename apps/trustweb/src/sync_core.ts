/**
 * Device sync, the pure part (wave 7, Jakob 2026-10-14: "some data on phone and some on Mac"): what travels between two of the
 * owner's own devices, how two records merge, and the one-time pairing code. No DOM, no network: sync_link.ts sends, sync_view.ts shows.
 *
 * What travels: people (with their note lines and fields), resources (inventory) and past meetings (the timeline). Never the relay
 * identity, peers, chats, connect code, hosting secret or any setting: those belong to one device.
 *
 * Merge, per entity (a person, a resource, a meeting), by id: unknown ids are added; the same id on both sides keeps the version with
 * the newer stamp; a person's note lines are united by id so nothing is lost; nothing is ever deleted. When both sides changed the
 * entity since the last sync it is listed as a conflict (the newer one was kept; the other stays readable in "Review merge").
 *
 * Stamps: no entity carries an updatedAt (and 40 edit sites would have to set one), so a stamp is found at sync time: an entity whose
 * content hash differs from the one stored at the last look gets "now". Stored beside the record, never in it.
 */
import type { AppState, InventoryItem, PastMeeting, Person } from './model'

export const SYNC_VERSION = 1
/** A sync message older than this is ignored on arrival (the relay may hold it longer; see sync_link.ts). */
export const SYNC_TTL_MS = 10 * 60_000
/** The other device must answer "ready" within this, or it is not on. */
export const HANDSHAKE_MS = 30_000

export type SyncKind = 'person' | 'resource' | 'meeting'
export type Stamps = Record<string, { h: string; at: number }>

export interface SyncBundle {
  v: typeof SYNC_VERSION
  people: Person[]
  inventory: InventoryItem[]
  meetings: PastMeeting[]
  /** Entity key (kind prefix + id) -> the moment it last changed on the sender. */
  at: Record<string, number>
}

export interface Conflict {
  kind: SyncKind
  id: string
  label: string
  /** Which side's version was kept (the newer one). */
  kept: 'mine' | 'theirs'
  mine: unknown
  theirs: unknown
}

export interface MergeResult {
  added: number
  updated: number
  conflicts: Conflict[]
}

export interface Counts { people: number; lines: number; resources: number; meetings: number }

const KEY_PREFIX: Record<SyncKind, string> = { person: 'p:', resource: 'i:', meeting: 'm:' }

/** djb2 over the JSON text: change detection on this device only, never compared across devices. */
function hashOf(v: unknown): string {
  const s = JSON.stringify(v)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function entities(s: { people: Person[]; inventory: InventoryItem[]; meetings?: PastMeeting[] }): [string, unknown][] {
  return [
    ...s.people.map((x): [string, unknown] => [KEY_PREFIX.person + x.id, x]),
    ...s.inventory.map((x): [string, unknown] => [KEY_PREFIX.resource + x.id, x]),
    ...(s.meetings ?? []).map((x): [string, unknown] => [KEY_PREFIX.meeting + x.id, x]),
  ]
}

/** The stamps after looking at the record now: unchanged entities keep theirs, new or edited ones get `now`. Gone ones drop out. */
export function refreshStamps(s: AppState, prev: Stamps, now: number): Stamps {
  const out: Stamps = {}
  for (const [key, e] of entities(s)) {
    const h = hashOf(e)
    out[key] = prev[key]?.h === h ? prev[key] : { h, at: now }
  }
  return out
}

export function bundleOf(s: AppState, stamps: Stamps): SyncBundle {
  return {
    v: SYNC_VERSION,
    people: s.people,
    inventory: s.inventory,
    meetings: s.meetings ?? [],
    at: Object.fromEntries(Object.entries(stamps).map(([k, x]) => [k, x.at])),
  }
}

export function countsOf(b: Pick<SyncBundle, 'people' | 'inventory' | 'meetings'>): Counts {
  return {
    people: b.people.length,
    lines: b.people.reduce((n, p) => n + p.lines.length, 0),
    resources: b.inventory.length,
    meetings: b.meetings.length,
  }
}

function isList(v: unknown): v is { id: string }[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'string')
}

/** The untrusted-input boundary: a decrypted bundle that is not exactly this shape is nothing. */
export function parseBundle(v: unknown): SyncBundle | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (o.v !== SYNC_VERSION || !isList(o.people) || !isList(o.inventory) || !isList(o.meetings)) return null
  if (typeof o.at !== 'object' || o.at === null) return null
  const people = o.people as unknown as Person[]
  if (!people.every((p) => Array.isArray(p.lines) && typeof p.name === 'string')) return null
  return o as unknown as SyncBundle
}

function mergeList<T extends { id: string }>(
  kind: SyncKind, mine: T[], theirs: T[], myAt: Stamps, theirAt: Record<string, number>, since: number,
  label: (x: T) => string, unite: (winner: T, loser: T) => T, res: MergeResult,
): T[] {
  const out = [...mine]
  const key = (x: T): string => KEY_PREFIX[kind] + x.id
  for (const t of theirs) {
    const i = out.findIndex((m) => m.id === t.id)
    if (i < 0) { out.push(t); res.added++; continue }
    const m = out[i]
    if (hashOf(m) === hashOf(t)) continue
    const mAt = myAt[key(m)]?.at ?? 0
    const tAt = theirAt[key(t)] ?? 0
    const theirsWins = tAt > mAt
    if (mAt > since && tAt > since) res.conflicts.push({ kind, id: t.id, label: label(t), kept: theirsWins ? 'theirs' : 'mine', mine: m, theirs: t })
    out[i] = theirsWins ? unite(t, m) : unite(m, t)
    if (theirsWins) res.updated++
  }
  return out
}

/** Winner's person, plus any note line only the loser has. */
function unitePerson(w: Person, l: Person): Person {
  const have = new Set(w.lines.map((x) => x.id))
  const extra = l.lines.filter((x) => !have.has(x.id))
  return extra.length ? { ...w, lines: [...w.lines, ...extra] } : w
}

/** A picture lives on one device only: the id would point at nothing here. */
function withoutImage(it: InventoryItem): InventoryItem {
  if (!it.imageId) return it
  const { imageId: _drop, ...rest } = it
  void _drop
  return rest
}

/**
 * Merges `theirs` into `mine` (mutating `mine`), `since` = when this pair last synced (0: never). Returns what happened.
 * Entities adopted from `theirs` take their stamp over, so they are not sent back as "changed here".
 */
export function mergeBundle(mine: AppState, myStamps: Stamps, theirs: SyncBundle, since: number): MergeResult {
  const res: MergeResult = { added: 0, updated: 0, conflicts: [] }
  mine.people = mergeList('person', mine.people, theirs.people, myStamps, theirs.at, since, (p) => p.name, unitePerson, res)
  mine.inventory = mergeList('resource', mine.inventory, theirs.inventory.map(withoutImage), myStamps, theirs.at, since, (x) => x.text, (w) => w, res)
  mine.meetings = mergeList('meeting', mine.meetings ?? [], theirs.meetings, myStamps, theirs.at, since, (x) => x.about, (w) => w, res)
  return res
}

/** After a merge: an entity now identical to the other side's keeps that side's stamp; everything else is looked at afresh. */
export function stampsAfterMerge(s: AppState, before: Stamps, theirs: SyncBundle, now: number): Stamps {
  const fresh = refreshStamps(s, before, now)
  const theirHash = new Map(entities(theirs).map(([k, e]) => [k, hashOf(e)]))
  for (const [key, e] of entities(s)) {
    const at = theirs.at[key]
    if (at !== undefined && theirHash.get(key) === hashOf(e)) fresh[key] = { h: hashOf(e), at }
  }
  return fresh
}

// ---------------------------------------------------------------------------
// Chunks: the relay refuses a wire over 128 KB, so a record travels as pieces.
// ---------------------------------------------------------------------------

/** Raw bytes per piece; base64 and the seal make it ~1.4x on the wire, well under the relay's 128 KB. */
export const CHUNK_BYTES = 45_000

export function toChunks(bundle: SyncBundle): Uint8Array[] {
  const bytes = new TextEncoder().encode(JSON.stringify(bundle))
  const out: Uint8Array[] = []
  for (let i = 0; i < bytes.length; i += CHUNK_BYTES) out.push(bytes.subarray(i, i + CHUNK_BYTES))
  return out
}

/** Pieces in order (all present) back to a bundle; null for anything that does not parse. */
export function fromChunks(pieces: Uint8Array[]): SyncBundle | null {
  const all = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of pieces) { all.set(p, at); at += p.length }
  try { return parseBundle(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all))) } catch { return null }
}

// ---------------------------------------------------------------------------
// Pairing code: the offering device's did:peer:2 and a one-time secret. "~" cannot occur in either.
// ---------------------------------------------------------------------------

const CODE_PREFIX = 'TWD1'
const SECRET_RE = /^[A-Za-z0-9_-]{22,43}$/
const DID_RE = /^did:peer:2\.[A-Za-z0-9.:_-]{20,1500}$/

export function pairingCode(did: string, secret: string): string {
  return [CODE_PREFIX, did, secret].join('~')
}

export function parsePairingCode(text: string): { did: string; secret: string } | null {
  const [prefix, did, secret, ...rest] = text.trim().split('~')
  return prefix === CODE_PREFIX && rest.length === 0 && DID_RE.test(did ?? '') && SECRET_RE.test(secret ?? '') ? { did, secret } : null
}

/** The 4-character check both devices show; a hex slice of the SHA-256 of the pair's shared secret. */
export async function fingerprintOf(shared: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', shared as BufferSource))
  return Array.from(d.subarray(0, 2), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}
