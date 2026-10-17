/**
 * Device sync, the pure part (wave 7, Jakob 2026-10-14: "some data on phone and some on Mac"; wave 13, 2026-10-17): what travels between
 * two of the owner's own devices, how two records merge, and the one-time pairing code. No DOM, no network: sync_link.ts sends, sync_view.ts shows.
 *
 * What travels (SyncBundle v2): people (with their note lines and fields), resources (inventory), past meetings, events, my own messenger
 * links with their share ticks (myChannels, contactShare), chats as TEXT ONLY (the ChatMessage fields; no image, no audio) and the sameAs map
 * ("these two persons are one"). All of it only sealed between the owner's own linked devices (sync_link.ts). Never the relay identity, peers,
 * connect code, hosting secret or any setting: those belong to one device. Pictures stay on their device (imageId is dropped).
 *
 * Merge, per entity (a person, a resource, a meeting, an event, one messenger link), by id: unknown ids are added; the same id on both sides
 * keeps the version with the newer stamp and takes over every field only the other side has; a person's note lines are united by id so
 * nothing is lost; nothing is ever deleted. When both sides changed the entity since the last sync it is listed as a conflict (the newer
 * one was kept; the other stays readable in "Review merge", which keeps up to 50 until dismissed). Chats are united per peer by message key
 * (the state further along wins), ordered by (sentAt, key) and trimmed to the chat.ts bound on every device alike (200 per person).
 * Unread is the larger of the two counts: a message read on one device may still show unread on the other.
 *
 * Stamps: no entity carries an updatedAt (and 40 edit sites would have to set one), so a stamp is found at sync time: an entity whose
 * content hash differs from the one stored at the last look gets "now" and this device's name (`by`; `from` = the device that first brought
 * it in, set once). Stored beside the record, never in it. CAVEAT: "newer" is a wall-clock comparison between two devices; a device with a
 * wrong clock can win edits it should lose. That is why the loser always stays readable in Review merge and a snapshot is taken before every merge.
 */
import type { AppState, InventoryItem, PastMeeting, Person, TwEvent } from './model'
import { CHANNELS } from './model'
import { MessageState, byStamp, sanitizeChatBook, trimThread } from './chat'
import type { ChatBook } from './chat'
import type { ChannelMap, ShareSettings } from './contact_share'
import { fillMissing, mergePersons, resolveSameAs, unitePerson } from './same_person'

/** 2: events, channels, chats and sameAs travel too. A device of version 1 shows "Update TrustWeb" (sync_link.ts hello). */
export const SYNC_VERSION = 2
/** A sync message older than this is ignored on arrival (the relay may hold it longer; see sync_link.ts). */
export const SYNC_TTL_MS = 10 * 60_000
/** The other device must answer "ready" within this, or it is not on. */
export const HANDSHAKE_MS = 30_000
/** Conflicts kept in AppState.syncReview. */
export const REVIEW_MAX = 50

export type SyncKind = 'person' | 'resource' | 'meeting' | 'event' | 'channel' | 'sameAs'
/** `by`: the device whose version was kept; `from`: the device that first brought the entity in (set once). */
export type Stamps = Record<string, { h: string; at: number; by: string; from?: string }>

export interface SyncBundle {
  v: number
  people: Person[]
  inventory: InventoryItem[]
  meetings: PastMeeting[]
  /** Entity key (kind prefix + id) -> the moment it last changed on the sender. */
  at: Record<string, number>
  /** Entity key -> the sender's device name that kept that version. */
  by?: Record<string, string>
  channels?: { mine: ChannelMap; share: ShareSettings }
  events?: TwEvent[]
  chats?: ChatBook
  sameAs?: Record<string, string>
}

export interface Conflict {
  kind: SyncKind
  id: string
  label: string
  /** Which side's version was kept (the newer one). */
  kept: 'mine' | 'theirs'
  mine: unknown
  theirs: unknown
  mineAt?: number
  mineBy?: string
  theirsAt?: number
  theirsBy?: string
}

export interface MergeResult {
  added: number
  updated: number
  conflicts: Conflict[]
}

export interface Counts { people: number; lines: number; resources: number; meetings: number; events: number; messages: number }

const KEY_PREFIX = { person: 'p:', resource: 'i:', meeting: 'm:', event: 'e:' } as const

/** djb2 over the JSON text: change detection on this device only, never compared across devices. */
function hashOf(v: unknown): string {
  const s = JSON.stringify(v)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** A picture lives on one device only: the id would point at nothing there. */
function withoutImage(it: InventoryItem): InventoryItem {
  if (!it.imageId) return it
  const { imageId: _drop, ...rest } = it
  void _drop
  return rest
}

/** What one device decides alone about an event (where it came from, whether its counter hit went out): never sent. */
function syncEvent(ev: TwEvent): TwEvent {
  const { fromLink: _f, hitTagged: _h, srv: _s, ...rest } = ev
  void _f; void _h; void _s
  return rest
}

/** A meeting without the large parts that can be fetched again (transcript, early packs, late link): for snapshots and the review list. */
export function slimMeeting(m: PastMeeting): PastMeeting {
  const { outbox: _o, late: _l, ...rest } = m
  void _o; void _l
  return { ...rest, transcript: [] }
}

type Source = Pick<AppState, 'people' | 'inventory' | 'meetings' | 'events' | 'myChannels' | 'contactShare'>

function entities(s: Source): [string, unknown][] {
  return [
    ...s.people.map((x): [string, unknown] => [KEY_PREFIX.person + x.id, x]),
    ...s.inventory.map((x): [string, unknown] => [KEY_PREFIX.resource + x.id, withoutImage(x)]),
    ...(s.meetings ?? []).map((x): [string, unknown] => [KEY_PREFIX.meeting + x.id, x]),
    ...(s.events ?? []).map((x): [string, unknown] => [KEY_PREFIX.event + x.id, syncEvent(x)]),
    ...Object.entries(s.myChannels ?? {}).filter(([, v]) => v).map(([ch, v]): [string, unknown] => ['c:' + ch, v]),
    ...(s.contactShare ? [['s:share', s.contactShare] as [string, unknown]] : []),
  ]
}

const sourceOf = (b: SyncBundle): Source => ({ people: b.people, inventory: b.inventory, meetings: b.meetings, events: b.events, myChannels: b.channels?.mine, contactShare: b.channels?.share })

/** The stamps after looking at the record now: unchanged entities keep theirs, new or edited ones get `now` and this device's name. Gone ones drop out. */
export function refreshStamps(s: AppState, prev: Stamps, now: number, device: string): Stamps {
  const out: Stamps = {}
  for (const [key, e] of entities(s)) {
    const h = hashOf(e)
    out[key] = prev[key]?.h === h ? prev[key] : { h, at: now, by: device, from: prev[key]?.from ?? device }
  }
  return out
}

export function bundleOf(s: AppState, stamps: Stamps): SyncBundle {
  const entries = Object.entries(stamps)
  return {
    v: SYNC_VERSION,
    people: s.people,
    inventory: s.inventory.map(withoutImage),
    meetings: s.meetings ?? [],
    at: Object.fromEntries(entries.map(([k, x]) => [k, x.at])),
    by: Object.fromEntries(entries.map(([k, x]) => [k, x.by])),
    channels: { mine: s.myChannels ?? {}, share: s.contactShare ?? {} },
    events: (s.events ?? []).map(syncEvent),
    chats: sanitizeChatBook(s.chats),
    ...(s.sameAs ? { sameAs: s.sameAs } : {}),
  }
}

export function countsOf(b: Pick<SyncBundle, 'people' | 'inventory' | 'meetings' | 'events' | 'chats'>): Counts {
  return {
    people: b.people.length,
    lines: b.people.reduce((n, p) => n + p.lines.length, 0),
    resources: b.inventory.length,
    meetings: b.meetings.length,
    events: b.events?.length ?? 0,
    messages: Object.values(b.chats ?? {}).reduce((n, t) => n + t.messages.length, 0),
  }
}

function isList(v: unknown): v is { id: string }[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null && typeof (x as { id?: unknown }).id === 'string')
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A plain object of short strings (ids, device names); null when it is anything else. Keys that could hit the prototype are refused. */
function strMap(v: unknown): Record<string, string> | null {
  if (!isObj(v)) return null
  const out: Record<string, string> = {}
  for (const [k, x] of Object.entries(v)) {
    if (k === '__proto__' || k.length > 120 || typeof x !== 'string' || x.length > 120) return null
    out[k] = x
  }
  return out
}

const VALUE_MAX = 300

function parseChannels(v: unknown): SyncBundle['channels'] | null {
  if (!isObj(v) || !isObj(v.mine) || !isObj(v.share)) return null
  const mine: ChannelMap = {}
  for (const ch of CHANNELS) {
    const x = v.mine[ch]
    if (x === undefined) continue
    if (typeof x !== 'string' || x.length > VALUE_MAX) return null
    if (x) mine[ch] = x
  }
  const ticks = v.share.shareOnConnect
  if (ticks !== undefined && !isObj(ticks)) return null
  const shareOnConnect: Partial<Record<(typeof CHANNELS)[number], boolean>> = {}
  for (const ch of CHANNELS) {
    const x = ticks?.[ch]
    if (x === undefined) continue
    if (typeof x !== 'boolean') return null
    shareOnConnect[ch] = x
  }
  return { mine, share: Object.keys(shareOnConnect).length ? { shareOnConnect } : {} }
}

const isEvent = (e: unknown): e is TwEvent => isObj(e) && ['id', 'name', 'from', 'where'].every((k) => typeof e[k] === 'string')
  && typeof e.createdAt === 'number' && typeof e.attended === 'boolean'

/**
 * The untrusted-input boundary: a decrypted bundle that is not exactly this shape is nothing. Versions 1 and 2 are read; a v2 field that is
 * present but malformed makes the whole bundle nothing, and the result holds only what is known (chats through chat.ts sanitizeChatBook).
 */
export function parseBundle(v: unknown): SyncBundle | null {
  if (!isObj(v)) return null
  if ((v.v !== 1 && v.v !== 2) || !isList(v.people) || !isList(v.inventory) || !isList(v.meetings) || !isObj(v.at)) return null
  const people = v.people as unknown as Person[]
  if (!people.every((p) => Array.isArray(p.lines) && typeof p.name === 'string')) return null
  const out: SyncBundle = { v: v.v, people, inventory: v.inventory as unknown as InventoryItem[], meetings: v.meetings as unknown as PastMeeting[], at: v.at as Record<string, number> }
  if (v.v === 1) return out
  const by = v.by === undefined ? {} : strMap(v.by)
  const sameAs = v.sameAs === undefined ? {} : strMap(v.sameAs)
  const channels = parseChannels(v.channels)
  if (!by || !sameAs || !channels || !isList(v.events) || !v.events.every(isEvent) || !isObj(v.chats)) return null
  out.by = by
  out.channels = channels
  out.events = (v.events as TwEvent[]).map(syncEvent)
  out.chats = sanitizeChatBook(v.chats)
  const map = Object.entries(sameAs).filter(([k, x]) => k !== x)
  if (map.length) out.sameAs = Object.fromEntries(map)
  return out
}

interface Ctx { myAt: Stamps; theirs: SyncBundle; since: number; res: MergeResult }

function mergeList<T extends { id: string }>(
  kind: keyof typeof KEY_PREFIX, mine: T[], theirs: T[], c: Ctx, label: (x: T) => string, unite: (winner: T, loser: T) => T,
): T[] {
  const out = [...mine]
  const key = (x: T): string => KEY_PREFIX[kind] + x.id
  for (const t of theirs) {
    const i = out.findIndex((m) => m.id === t.id)
    if (i < 0) { out.push(t); c.res.added++; continue }
    const m = out[i]
    if (hashOf(m) === hashOf(t)) continue
    const mAt = c.myAt[key(m)]?.at ?? 0
    const tAt = c.theirs.at[key(t)] ?? 0
    const theirsWins = tAt > mAt
    if (mAt > c.since && tAt > c.since) {
      c.res.conflicts.push({
        kind, id: t.id, label: label(t), kept: theirsWins ? 'theirs' : 'mine', mine: m, theirs: t,
        mineAt: mAt, mineBy: c.myAt[key(m)]?.by, theirsAt: tAt, theirsBy: c.theirs.by?.[key(t)],
      })
    }
    out[i] = theirsWins ? unite(t, m) : unite(m, t)
    if (theirsWins) c.res.updated++
  }
  return out
}

/** The two maps united; both ends of a clash keep the lexicographically smaller target and the clash is listed. */
function uniteSameAs(mine: Record<string, string> | undefined, theirs: Record<string, string> | undefined, res: MergeResult): Record<string, string> | undefined {
  const out = { ...mine }
  for (const [k, v] of Object.entries(theirs ?? {})) {
    if (k === v) continue
    const have = Object.prototype.hasOwnProperty.call(out, k) ? out[k] : undefined
    if (have === undefined) { out[k] = v; res.added++ } else if (have !== v) {
      out[k] = have < v ? have : v
      res.conflicts.push({ kind: 'sameAs', id: k, label: k, kept: have < v ? 'mine' : 'theirs', mine: have, theirs: v })
    }
  }
  return Object.keys(out).length ? out : undefined
}

/** The incoming bundle with every person id (and the stamp keys and meeting links that name one) mapped through `map`. */
function remapBundle(b: SyncBundle, map: Record<string, string> | undefined): SyncBundle {
  if (!map) return b
  const id = (x: string): string => resolveSameAs(map, x)
  const at: Record<string, number> = {}
  const by: Record<string, string> = {}
  for (const [k, n] of Object.entries(b.at)) {
    const key = k.startsWith(KEY_PREFIX.person) ? KEY_PREFIX.person + id(k.slice(2)) : k
    if (at[key] === undefined || n > at[key]) { at[key] = n; if (b.by?.[k] !== undefined) by[key] = b.by[k] }
  }
  return {
    ...b, at, by,
    people: b.people.map((p) => (id(p.id) === p.id ? p : { ...p, id: id(p.id) })),
    meetings: b.meetings.map((m) => (m.personId && id(m.personId) !== m.personId ? { ...m, personId: id(m.personId) } : m)),
  }
}

const RANK: Record<MessageState, number> = { [MessageState.Pending]: 0, [MessageState.Received]: 1, [MessageState.Delivered]: 2 }
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

/** Per peer: messages united by key (the state further along wins, else the newer `at`), in the one device-independent order, trimmed alike. */
function mergeChats(mine: AppState, theirs: ChatBook, res: MergeResult): void {
  const book: ChatBook = { ...mine.chats }
  for (const [peerId, t] of Object.entries(theirs)) {
    const m = has(book, peerId) ? book[peerId] : undefined
    const byKey = new Map((m?.messages ?? []).map((x) => [x.key, x]))
    for (const x of t.messages) {
      const have = byKey.get(x.key)
      if (!have) { byKey.set(x.key, x); res.added++ } else if (RANK[x.state] > RANK[have.state] || (RANK[x.state] === RANK[have.state] && x.at > have.at)) byKey.set(x.key, x)
    }
    book[peerId] = { messages: trimThread([...byKey.values()].sort(byStamp)), unread: Math.max(m?.unread ?? 0, t.unread) }
  }
  if (Object.keys(theirs).length) mine.chats = book
}

/**
 * Per messenger link: a saved value beats none; both saved and different: the newer stamp wins (this side on a tie) and the other value is listed.
 * The share tick comes with the winning value; where the values agree (or I had none) a tick is ticked if either side ticked it.
 */
function mergeChannels(mine: AppState, theirs: NonNullable<SyncBundle['channels']>, c: Ctx): void {
  for (const ch of CHANNELS) {
    const t = theirs.mine[ch]
    if (!t) continue
    const m = mine.myChannels?.[ch]
    const mt = mine.contactShare?.shareOnConnect?.[ch]
    const tt = theirs.share.shareOnConnect?.[ch]
    const key = 'c:' + ch
    const theirsWins = !!m && m !== t && (c.theirs.at[key] ?? 0) > (c.myAt[key]?.at ?? 0)
    if (m && m !== t) {
      c.res.conflicts.push({
        kind: 'channel', id: ch, label: ch, kept: theirsWins ? 'theirs' : 'mine', mine: m, theirs: t,
        mineAt: c.myAt[key]?.at, mineBy: c.myAt[key]?.by, theirsAt: c.theirs.at[key], theirsBy: c.theirs.by?.[key],
      })
    }
    let tick = mt
    if (!m) { c.res.added++; tick = mt ?? tt } else if (m === t) tick = mt === true || tt === true ? true : mt ?? tt
    else if (theirsWins) { c.res.updated++; tick = tt }
    if (!m || theirsWins) mine.myChannels = { ...mine.myChannels, [ch]: t }
    if (tick !== mt && tick !== undefined) mine.contactShare = { ...mine.contactShare, shareOnConnect: { ...mine.contactShare?.shareOnConnect, [ch]: tick } }
  }
}

/**
 * Merges `theirs` into `mine` (mutating `mine`), `since` = when this pair last synced (0: never). Returns what happened.
 * Entities adopted from `theirs` take their stamp over, so they are not sent back as "changed here".
 * Persons declared the same (sameAs, mine and theirs united) are one before the lists merge, and local persons that the united map now
 * points at another local person are collapsed into it, so a dropped id never comes back.
 */
export function mergeBundle(mine: AppState, myStamps: Stamps, incoming: SyncBundle, since: number): MergeResult {
  const res: MergeResult = { added: 0, updated: 0, conflicts: [] }
  const sameAs = uniteSameAs(mine.sameAs, incoming.sameAs, res)
  if (sameAs) mine.sameAs = sameAs
  const theirs = remapBundle(incoming, sameAs)
  const c: Ctx = { myAt: myStamps, theirs, since, res }
  mine.people = mergeList('person', mine.people, theirs.people, c, (p) => p.name, unitePerson)
  mine.inventory = mergeList('resource', mine.inventory, theirs.inventory.map(withoutImage), c, (x) => x.text, fillMissing)
  mine.meetings = mergeList('meeting', mine.meetings ?? [], theirs.meetings, c, (x) => x.about, fillMissing)
  if (theirs.events?.length) mine.events = mergeList('event', mine.events ?? [], theirs.events, c, (x) => x.name, fillMissing)
  if (theirs.channels) mergeChannels(mine, theirs.channels, c)
  if (theirs.chats) mergeChats(mine, theirs.chats, res)
  collapseSamePersons(mine)
  return res
}

/** Every local person whose id the sameAs map sends to another local person is merged into that one. True when anything was. */
export function collapseSamePersons(s: AppState): boolean {
  let any = false
  for (const p of [...s.people]) {
    const to = resolveSameAs(s.sameAs, p.id)
    if (to !== p.id && mergePersons(s, to, p.id)) any = true
  }
  return any
}

/** After a merge: an entity now identical to the other side's keeps that side's stamp and device; one that arrived new remembers who brought it. */
export function stampsAfterMerge(s: AppState, before: Stamps, incoming: SyncBundle, now: number, device: string, theirName: string): Stamps {
  const theirs = remapBundle(incoming, s.sameAs)
  const fresh = refreshStamps(s, before, now, device)
  const theirHash = new Map(entities(sourceOf(theirs)).map(([k, e]) => [k, hashOf(e)]))
  for (const [key, e] of entities(s)) {
    const at = theirs.at[key]
    if (at === undefined) continue
    const from = before[key]?.from ?? theirName
    if (theirHash.get(key) === hashOf(e)) fresh[key] = { h: hashOf(e), at, by: theirs.by?.[key] ?? theirName, from }
    else fresh[key] = { ...fresh[key], from }
  }
  return fresh
}

/** The conflicts of a merge, kept in the record (newest first, at most REVIEW_MAX) until the owner dismisses them; meetings without their large parts. */
export function recordReview(s: AppState, conflicts: Conflict[]): void {
  if (!conflicts.length) return
  const slim = (x: unknown): unknown => (isObj(x) && Array.isArray(x.transcript) ? slimMeeting(x as unknown as PastMeeting) : x)
  s.syncReview = [...conflicts.map((c) => ({ ...c, mine: slim(c.mine), theirs: slim(c.theirs) })), ...(s.syncReview ?? [])].slice(0, REVIEW_MAX)
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
