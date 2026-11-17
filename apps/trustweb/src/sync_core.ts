/**
 * Device sync, the pure part (wave 7, Jakob 2026-10-14: "some data on phone and some on Mac"; wave 13, 2026-10-17): what travels between
 * two of the owner's own devices, how two records merge, and the one-time pairing code. No DOM, no network: sync_link.ts sends, sync_view.ts shows.
 *
 * What travels (SyncBundle v3): people (with their note lines and fields), resources (inventory), past meetings, events, my own messenger
 * links with their share ticks (myChannels, contactShare), chats as TEXT ONLY (the ChatMessage fields; no image, no audio), the sameAs map
 * ("these two persons are one") and, since wave 26 ("per default everything travels with sync"), EVERY other field of the record the owner
 * set: Do Not Disturb (chatsHidden), membraneLimit, city, engagementDays, feed, features, askDirectOnly, advanced, ... as `settings`. That
 * part is an exclusion list (SYNC_EXCLUDED), so a field added to AppState later rides along without touching this file. All of it only
 * sealed between the owner's own linked devices (sync_link.ts). Never what is structurally per device (SYNC_EXCLUDED): relay identity and
 * keys, peers, hosting secret, queues and caches of this phone, notification permission, the layout pick (localStorage, not in the record).
 * Pictures stay on their device (imageId is dropped; images are large). The connect code (public link + username) travels only when the pairing shares it
 * (wave 15, sync_code.ts), with the name shown on it (`displayName`, newer wins).
 *
 * Merge, per entity (a person, a resource, a meeting, an event, one messenger link), by id: unknown ids are added; the same id on both sides
 * keeps the version with the newer stamp and takes over every field only the other side has; a person's note lines are united by id so
 * nothing is lost; nothing is ever deleted. When both sides changed the entity since the last sync it is listed as a conflict (the newer
 * one was kept; the other stays readable in "Review merge", which keeps up to 50 until dismissed). Chats are united per peer by message key
 * (the state further along wins), ordered by (sentAt, key) and trimmed to the chat.ts bound on every device alike (200 per person).
 * Unread is the larger of the two counts: a message read on one device may still show unread on the other.
 *
 * Settings merge per field (stamp key 'g:<field>', the same stamps as below): a field only the other side has is taken, a field both have goes
 * to the newer stamp, a field only this side has stays (nothing is deleted, so switching a setting back to "absent" does not travel; store
 * the explicit value). A v2 bundle has no `settings` and reads as before.
 *
 * Stamps: no entity carries an updatedAt (and 40 edit sites would have to set one), so a stamp is found at sync time: an entity whose
 * content hash differs from the one stored at the last look gets "now" and this device's name (`by`; `from` = the device that first brought
 * it in, set once; the bundle's optional `from` carries it, v stays 2: parseBundle ignores unknown fields). Stored beside the record, never in it. CAVEAT: "newer" is a wall-clock comparison between two devices; a device with a
 * wrong clock can win edits it should lose. That is why the loser always stays readable in Review merge and a snapshot is taken before every merge.
 */
import type { AppState, InventoryItem, Invitation, PastMeeting, Peer, Person, TwEvent, TwTask } from './model'
import { CHANNELS } from './model'
import { CHAT_MAX_THREADS, MessageState, byStamp, lastAt, sanitizeChatBook, trimThread } from './chat'
import type { ChatBook } from './chat'
import type { ChannelMap, ShareSettings } from './contact_share'
import { withoutPersonImage } from './person_image'
import { fillMissing, mergePersons, resolveSameAs, unitePerson } from './same_person'
import { codesForBundle, parseCodeField, readCodeList, validLongUrl, wireOther } from './sync_code'
import type { CodeMerge } from './sync_code'
import type { ConnectRecord } from './connect_code'
import { pinnedFrom } from './membranes_five'
import { SCHEMA_VERSION } from './schema_version'
import { alive } from './deleted_people'
import { ALSO_DIDS_MAX } from './device_alias'
import { isTrashEntry, mergeTrash, trashKey } from './trash' // wave44c answers-44c (A4)
import type { TrashEntry } from './trash'

/** 3: `settings` (every non-excluded record field) travels too; v2 is still read. 2: events, channels, chats and sameAs travel too. A device of version 1 shows "Update TrustWeb" (sync_link.ts hello). */
export const HOP_MAX = 3
export const SYNC_VERSION = 3
/** A sync message older than this is ignored on arrival (the relay may hold it longer; see sync_link.ts). */
export const SYNC_TTL_MS = 10 * 60_000
/** The other device must answer "ready" within this, or it is not on. */
export const HANDSHAKE_MS = 30_000
/** Conflicts kept in AppState.syncReview. */
export const REVIEW_MAX = 50

/**
 * Record fields that never leave the device (or travel as an entity of their own above): everything else of AppState is a setting and rides along.
 * Adding a per-device field to AppState means adding it here; adding a setting means doing nothing.
 */
export const SYNC_EXCLUDED: ReadonlySet<string> = new Set([
  // carried by their own bundle parts, or the record's identity
  'v', 'schemaVersion', 'me', 'people', 'inventory', 'meetings', 'events', 'tasks', 'invitations', 'chats', 'sameAs', 'myChannels', 'contactShare', 'syncReview', 'channelReaders',
  // relay identity, keys, peers, hosting secret, connect codes
  'identity', 'peers', 'log', 'hosting', 'connectCode', 'seenConnectNonces', 'seenHandshakeNonces', 'handshakeLog', 'invites', 'invitesTaken', 'hideReports', 'otherCodes', 'pendingRenew', 'contactSent', 'contactSentChannels', 'autoSentRank',
  // queues, caches and counters of this phone
  'reachOutLog', 'reachOutHeld', 'reachOutsPaused', 'releasedTies', 'engagementNoticeDay', 'keepNoticeDay', 'birthdayNoticeDay', 'browserOnlyDismissed', 'engagementSince', 'awayAsks', 'sentAsks',
  'lateAnswers', 'heldAsks', 'unmatchedAsks', 'reaskSeen', 'received', 'found', 'imports', 'peerCardsUnmergedAt', 'dismissed',
  // true of this phone only: where I am, permissions and consents given here, the app shell, demo state, the tab row
  'atEvent', 'availability', 'heldAvailability', 'bookLinks', 'notificationsOn', 'notifOffered', 'notifFeatureSeen', 'onbDismissed', 'webSearchConsent', 'serverTranscriptionConsentAt',
  'serverTranscriptionConsent', 'apkVersion', 'apkCheckedAt', 'apkUpdates', 'tabOrder', 'tabRow', 'shareMode', 'demo', 'demoHidden', 'demoOffered',
  'testAccounts', 'testOf', 'demoOnlyForDemoAccounts', 'talkWeaveLocal', 'signalImport', 'serviceImports', 'agent',
  // wave 36 groups-to-join: the groups I could join or help and their ranking stay on this phone ("Only on this phone")
  'groups',
  // wave 42 push-popup: the notification inbox mirror stays on this phone
  'notifInbox', 'notifReadAt', 'notifDismissed',
  // wave 40 hover-sources: what I said about how two contacts relate stays on this phone
  'relations',
  // wave 37 co-notes-link: invites, guest shell, note chats and this device's secret belong to this phone only
  'coInvites', 'coGuest', 'coChats', 'coDevice',
  // wave 43c sync-devices: the Auto sync switch and the status line are this device's; wantsToConnect travels now (peer ids match on both devices)
  'syncAutoOff', 'syncStatus',
  // wave 43c social-hosting: the name listing is of THIS device's key; hosted records, the lookup cache and waiting intents are this phone's
  'discoverable', 'discoverOpen', 'hosted', 'nameCache', 'intentsIn',
  /* wave44c event-autosave */ 'drafts',
  /* wave44c answers-44c: tombstones travel as their own entities (x:<kind>:<id>) */ 'trash',
])

/** A setting that merges by its own rule instead of newest-wins as a whole (wave 36: co-created notes merge document by document). Registered by the module that owns the field. */
export const SETTING_MERGERS = new Map<string, (mine: unknown, theirs: unknown) => unknown>()

/** The settings of a record: every field not in SYNC_EXCLUDED. */
export function settingsOf(s: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(s).filter(([k, v]) => v !== undefined && !SYNC_EXCLUDED.has(k)))
}

export type SyncKind = 'person' | 'resource' | 'meeting' | 'event' | 'task' | 'invitation' | 'channel' | 'sameAs' | 'chat' | 'name' | 'peer'
/** `by`: the device whose version was kept; `from`: the device that first brought the entity in (set once). */
/** `rx`/`hp` (wave 44c): when this device took the entity from another one, and over how many devices it has come (0 = made where it was last edited); only such entities are forwarded, up to HOP_MAX. */
export type Stamps = Record<string, { h: string; at: number; by: string; from?: string; rx?: number; hp?: number }>

export interface SyncBundle {
  v: number
  /** schema_version.ts of the sending build; absent from builds before wave 21. */
  schemaVersion?: number
  people: Person[]
  inventory: InventoryItem[]
  meetings: PastMeeting[]
  /** Entity key (kind prefix + id) -> the moment it last changed on the sender. */
  at: Record<string, number>
  /** Entity key -> the sender's device name that kept that version. */
  by?: Record<string, string>
  /** Entity key -> the device that first brought it in (Stamps.from), so the origin survives a hop through a third device. Optional: an older device sends none. */
  from?: Record<string, string>
  /** Wave 44c: entity key -> devices the entity has already passed over (absent = 0); forwarding stops at HOP_MAX. */
  hp?: Record<string, number>
  channels?: { mine: ChannelMap; share: ShareSettings }
  events?: TwEvent[]
  /** Wave 24: optional, sent only when I have tasks; a device without the field leaves mine untouched. */
  tasks?: TwTask[]
  /** Wave 33: optional, sent only when I have invitations; an older build ignores the field. */
  invitations?: Invitation[]
  chats?: ChatBook
  sameAs?: Record<string, string>
  /** Wave 26 (v3): every record field the owner set that is not per device (settingsOf). Absent from v2. */
  settings?: Record<string, unknown>
  /** Wave 15: the public link and username of this account, when the pairing shares them (sync_code.ts), and the others it holds. Never part of a conflict or the sync log. */
  connectCode?: ConnectRecord
  otherCodes?: ConnectRecord[]
  /** Wave 15: the name shown on the public link (me.displayName), so it stays the same on every device; peer ids differ per device by design. */
  displayName?: string
  /** Wave 43c: my connections (syncPeer: without what only one device knows), so a person connected on one device can be messaged on the other. */
  peers?: Peer[]
  /** Wave 44c answers-44c (A4): deleted events, resources, tasks, meetings, invitations (trash.ts); an older build ignores the field. */
  trash?: TrashEntry[]
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
  /** Wave 15: what the codes of the bundle still need from the network (set by the link, sync_code.ts). */
  codes?: CodeMerge
}

export interface Counts { people: number; lines: number; resources: number; meetings: number; events: number; tasks: number; messages: number }

const SETTING_PREFIX = 'g:'
const KEY_PREFIX = { person: 'p:', resource: 'i:', meeting: 'm:', event: 'e:', task: 't:', invitation: 'v:' } as const
/** Wave 43c: a connection (by DID) and a chat thread (by peer id) are stamped entities too, so a delta can carry just them. */
const PEER_PREFIX = 'r:'
const CHAT_PREFIX = 'h:'
/** A connection's stamp key: its DID's key part (unique per identity), never the whole DID: a bundle refuses keys over 120 characters (strMap). */
const peerKey = (did: string): string => PEER_PREFIX + (did.split('.')[1] ?? did).slice(0, 100)

/** The connections that can travel: a record of an older build may hold one without a DID (it names nobody on the wire). */
const travelling = (peers: Peer[] | undefined): Peer[] => (peers ?? []).filter((p) => typeof p?.did === 'string' && typeof p.id === 'string')

/** A connection as it travels: what is true of the person, never this device's handshake bookkeeping (acks, ask-again, told, synced). */
export function syncPeer(p: Peer): Peer {
  const { heardAt: _h, ackTries: _t, ackSentAt: _s, askAgainDue: _d, askAgainSentAt: _a, synced: _y, toldDevices: _o, ...rest } = p
  void _h; void _t; void _s; void _d; void _a; void _y; void _o
  return rest
}

/** djb2 over the JSON text: change detection (a stored stamp), and the "identical on both sides" skip in stampsAfterMerge. The merge itself compares the JSON text, so a collision cannot keep an older version. */
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

/** review-44c: a tombstone as it travels: the same device-local fields stay home as for the live item (syncEvent, withoutImage). */
function syncTrash(t: TrashEntry): TrashEntry {
  if (t.kind === 'event') return { ...t, item: syncEvent(t.item as unknown as TwEvent) }
  if (t.kind === 'resource') return { ...t, item: withoutImage(t.item as unknown as InventoryItem) }
  return t
}

type Source = Pick<AppState, 'people' | 'inventory' | 'meetings' | 'events' | 'tasks' | 'invitations' | 'myChannels' | 'contactShare' | 'trash'> & { me?: { displayName: string }; peers?: Peer[]; chats?: ChatBook }

function entities(s: Source, settings: Record<string, unknown>): [string, unknown][] {
  return [
    ...Object.entries(settings).map(([k, x]): [string, unknown] => [SETTING_PREFIX + k, x]),
    // Wave 43c: a deleted person (30-day tombstone, deleted_people.ts) travels too, so a delete on one device deletes on the other.
    ...s.people.map((x): [string, unknown] => [KEY_PREFIX.person + x.id, withoutPersonImage(x)]),
    ...s.inventory.map((x): [string, unknown] => [KEY_PREFIX.resource + x.id, withoutImage(x)]),
    ...(s.meetings ?? []).map((x): [string, unknown] => [KEY_PREFIX.meeting + x.id, x]),
    ...(s.events ?? []).map((x): [string, unknown] => [KEY_PREFIX.event + x.id, syncEvent(x)]),
    ...(s.tasks ?? []).map((x): [string, unknown] => [KEY_PREFIX.task + x.id, x]),
    ...(s.invitations ?? []).map((x): [string, unknown] => [KEY_PREFIX.invitation + x.id, x]),
    ...(s.trash ?? []).map((x): [string, unknown] => [trashKey(x), syncTrash(x)]), // wave44c answers-44c (A4); review-44c: hashed as it travels
    ...Object.entries(s.myChannels ?? {}).filter(([, v]) => v).map(([ch, v]): [string, unknown] => ['c:' + ch, v]),
    ...(s.contactShare ? [['s:share', s.contactShare] as [string, unknown]] : []),
    ...(s.me?.displayName ? [['n:me', s.me.displayName] as [string, unknown]] : []),
    ...travelling(s.peers).map((x): [string, unknown] => [peerKey(x.did), syncPeer(x)]),
    // a thread key over the bundle's key limit stays out of the stamps (it still travels whole with Sync now)
    ...Object.entries(s.chats ?? {}).filter(([id]) => id.length <= 100).map(([id, t]): [string, unknown] => [CHAT_PREFIX + id, t]),
  ]
}

const sourceOf = (b: SyncBundle): Source => ({ people: b.people, inventory: b.inventory, meetings: b.meetings, events: b.events, tasks: b.tasks, invitations: b.invitations, myChannels: b.channels?.mine, contactShare: b.channels?.share, me: b.displayName ? { displayName: b.displayName } : undefined, peers: b.peers, chats: b.chats, trash: b.trash })

/** The stamps after looking at the record now: unchanged entities keep theirs, new or edited ones get `now` and this device's name. Gone ones drop out. */
export function refreshStamps(s: AppState, prev: Stamps, now: number, device: string): Stamps {
  const out: Stamps = {}
  for (const [key, e] of entities(s, settingsOf(s))) {
    const h = hashOf(e)
    out[key] = prev[key]?.h === h ? prev[key] : { h, at: now, by: device, from: prev[key]?.from ?? device }
  }
  return out
}

export function bundleOf(s: AppState, stamps: Stamps, shareCode = true): SyncBundle {
  const entries = Object.entries(stamps)
  return {
    v: SYNC_VERSION,
    schemaVersion: SCHEMA_VERSION,
    people: s.people.map(withoutPersonImage),
    inventory: s.inventory.map(withoutImage),
    meetings: s.meetings ?? [],
    at: Object.fromEntries(entries.map(([k, x]) => [k, x.at])),
    by: Object.fromEntries(entries.map(([k, x]) => [k, x.by])),
    ...(entries.some(([, x]) => x.from) ? { from: Object.fromEntries(entries.flatMap(([k, x]) => (x.from ? [[k, x.from]] : []))) } : {}),
    ...(entries.some(([, x]) => x.hp) ? { hp: Object.fromEntries(entries.flatMap(([k, x]) => (x.hp ? [[k, x.hp]] : []))) } : {}),
    channels: { mine: s.myChannels ?? {}, share: s.contactShare ?? {} },
    events: (s.events ?? []).map(syncEvent),
    ...(s.tasks?.length ? { tasks: s.tasks } : {}),
    ...(s.invitations?.length ? { invitations: s.invitations } : {}),
    ...(s.trash?.length ? { trash: s.trash.map(syncTrash) } : {}),
    chats: sanitizeChatBook(s.chats),
    ...(s.sameAs ? { sameAs: s.sameAs } : {}),
    settings: settingsOf(s),
    ...codesForBundle(s, shareCode),
    ...(shareCode && s.me?.displayName ? { displayName: s.me.displayName } : {}),
    peers: travelling(s.peers).map(syncPeer),
  }
}

/**
 * Wave 43c: the automatic sync's delta: the entities whose stamp THIS device set after `since`. Wave 44c: also what arrived from another device after `since`
 * (`rx`), so a third device pairs with one device only: not back to a device in `skip` (the receiver's sync id and, for an older build, its name) and not past HOP_MAX
 * devices. `since` 0 = the full bundle. Null when nothing changed. Codes travel with the full bundle only.
 */
export function deltaOf(s: AppState, stamps: Stamps, since: number, device: string, skip: readonly string[] = []): SyncBundle | null {
  if (!since) return bundleOf(s, stamps)
  const due = (x: Stamps[string]): boolean => (x.by === device ? x.at > since : !skip.includes(x.by) && (x.rx ?? 0) > since && (x.hp ?? 0) < HOP_MAX)
  const keys = new Set(Object.entries(stamps).filter(([, x]) => due(x)).map(([k]) => k))
  if (!keys.size) return null
  const full = bundleOf(s, stamps, false)
  const pick = <T>(prefix: string, list: T[], id: (x: T) => string): T[] => list.filter((x) => keys.has(prefix + id(x)))
  const sub = <V>(m: Record<string, V> | undefined): Record<string, V> => Object.fromEntries(Object.entries(m ?? {}).filter(([k]) => keys.has(k)))
  const channels = [...keys].some((k) => k.startsWith('c:') || k === 's:share')
  return {
    v: full.v, schemaVersion: full.schemaVersion,
    people: pick(KEY_PREFIX.person, full.people, (x) => x.id),
    inventory: pick(KEY_PREFIX.resource, full.inventory, (x) => x.id),
    meetings: pick(KEY_PREFIX.meeting, full.meetings, (x) => x.id),
    events: pick(KEY_PREFIX.event, full.events ?? [], (x) => x.id),
    ...(full.tasks ? { tasks: pick(KEY_PREFIX.task, full.tasks, (x) => x.id) } : {}),
    ...(full.invitations ? { invitations: pick(KEY_PREFIX.invitation, full.invitations, (x) => x.id) } : {}),
    ...(full.trash ? { trash: full.trash.filter((x) => keys.has(trashKey(x))) } : {}),
    peers: (full.peers ?? []).filter((x) => keys.has(peerKey(x.did))),
    chats: Object.fromEntries(Object.entries(full.chats ?? {}).filter(([id]) => keys.has(CHAT_PREFIX + id))),
    settings: Object.fromEntries(Object.entries(full.settings ?? {}).filter(([k]) => keys.has(SETTING_PREFIX + k))),
    channels: channels ? full.channels : { mine: {}, share: {} },
    ...(full.sameAs ? { sameAs: full.sameAs } : {}),
    ...(keys.has('n:me') && s.me?.displayName ? { displayName: s.me.displayName } : {}),
    at: sub(full.at), by: sub(full.by), ...(full.from ? { from: sub(full.from) } : {}), ...(full.hp ? { hp: sub(full.hp) } : {}),
  }
}

export function countsOf(b: Pick<SyncBundle, 'people' | 'inventory' | 'meetings' | 'events' | 'tasks' | 'chats'>): Counts {
  return {
    people: alive(b.people).length,
    lines: alive(b.people).reduce((n, p) => n + p.lines.length, 0),
    resources: b.inventory.length,
    meetings: b.meetings.length,
    events: b.events?.length ?? 0,
    tasks: b.tasks?.length ?? 0,
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

const VALUE_MAX = 440
/** Entries in `at`, like the ceiling strMap puts on the others: one per entity, so far above any real record. */
const AT_MAX = 20_000

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

/** Settings: a plain JSON object without excluded or prototype keys; anything else is dropped alone (a record from a newer build still merges). */
function parseSettings(v: unknown): Record<string, unknown> | null {
  if (!isObj(v)) return null
  return Object.fromEntries(Object.entries(v).filter(([k]) => k !== '__proto__' && k.length <= 60 && !SYNC_EXCLUDED.has(k)))
}

const isTask = (e: unknown): e is TwTask => isObj(e) && ['id', 'title'].every((k) => typeof e[k] === 'string') && typeof e.stamp === 'number'
const isInvitation = (e: unknown): e is Invitation => isObj(e) && e.kind === 'invitation' && typeof e.id === 'string' && typeof e.status === 'string'
const isEvent = (e: unknown): e is TwEvent => isObj(e) && ['id', 'name', 'from', 'where'].every((k) => typeof e[k] === 'string')
  && typeof e.createdAt === 'number' && typeof e.attended === 'boolean'
/** review-44c: a tombstone's item is checked like the live list of its kind (a restore puts it there). */
const trashItemOk = (t: TrashEntry): boolean => (t.kind === 'event' ? isEvent(t.item) : t.kind === 'task' ? isTask(t.item) : t.kind === 'invitation' ? isInvitation(t.item) : isObj(t.item))

/**
 * The untrusted-input boundary: a decrypted bundle that is not exactly this shape is nothing. Versions 1 to 3 are read; a v2 field that is
 * present but malformed makes the whole bundle nothing, and the result holds only what is known (chats through chat.ts sanitizeChatBook).
 */
export function parseBundle(v: unknown): SyncBundle | null {
  if (!isObj(v)) return null
  if ((v.v !== 1 && v.v !== 2 && v.v !== 3) || !isList(v.people) || !isList(v.inventory) || !isList(v.meetings) || !isObj(v.at)) return null
  const people = (v.people as unknown as Person[]).map(pinnedFrom)
  if (!people.every((p) => Array.isArray(p.lines) && typeof p.name === 'string')) return null
  if (!Object.values(v.at).every((n) => Number.isFinite(n)) || Object.keys(v.at).length > AT_MAX) return null
  const out: SyncBundle = { v: v.v, people, inventory: v.inventory as unknown as InventoryItem[], meetings: v.meetings as unknown as PastMeeting[], at: v.at as Record<string, number> }
  if (typeof v.schemaVersion === 'number') out.schemaVersion = v.schemaVersion
  if (v.v === 1) return out
  const by = v.by === undefined ? {} : strMap(v.by)
  const from = v.from === undefined ? {} : strMap(v.from)
  const sameAs = v.sameAs === undefined ? {} : strMap(v.sameAs)
  const channels = parseChannels(v.channels)
  if (!by || !from || !sameAs || !channels || !isList(v.events) || !v.events.every(isEvent) || !isObj(v.chats)) return null
  if (v.tasks !== undefined && !(isList(v.tasks) && v.tasks.every(isTask))) return null
  if (v.invitations !== undefined && !(Array.isArray(v.invitations) && v.invitations.every(isInvitation))) return null
  if (v.trash !== undefined && !(Array.isArray(v.trash) && v.trash.length <= AT_MAX && v.trash.every((t) => isTrashEntry(t) && trashItemOk(t)))) return null
  out.by = by
  if (Object.keys(from).length) out.from = from
  if (isObj(v.hp)) {
    const hp = Object.entries(v.hp).filter(([k, n]) => k.length <= 120 && Number.isInteger(n) && (n as number) >= 0 && (n as number) <= HOP_MAX)
    if (hp.length) out.hp = Object.fromEntries(hp) as Record<string, number>
  }
  out.channels = channels
  out.events = (v.events as TwEvent[]).map(syncEvent)
  if (v.tasks) out.tasks = v.tasks as TwTask[]
  if (v.invitations) out.invitations = v.invitations as Invitation[]
  if (v.trash) out.trash = (v.trash as TrashEntry[]).map(syncTrash)
  out.chats = sanitizeChatBook(v.chats)
  const settings = parseSettings(v.settings)
  if (settings) out.settings = settings
  const map = Object.entries(sameAs).filter(([k, x]) => k !== x)
  if (map.length) out.sameAs = Object.fromEntries(map)
  // The codes are optional extras: a malformed one is dropped alone, never the bundle (a record from a newer build still merges).
  const code = parseCodeField(v.connectCode)
  if (code) {
    out.connectCode = code
    const others = readCodeList(v.otherCodes, [code.code]).filter((r) => validLongUrl(r.url)).map(wireOther)
    if (others.length) out.otherCodes = others
  }
  if (typeof v.displayName === 'string' && v.displayName.trim() && v.displayName.length <= 60) out.displayName = v.displayName
  if (Array.isArray(v.peers)) out.peers = v.peers.flatMap((p) => { const x = parsePeer(p); return x ? [x] : [] })
  return out
}

const PEER_DID = /^did:peer:2\.[A-Za-z0-9.:_-]{20,1500}$/
/** Wave 43c: one travelling connection, or null (dropped alone): known fields only, DIDs well formed. */
function parsePeer(v: unknown): Peer | null {
  if (!isObj(v)) return null
  const { id, displayName, did, ring, connectedAt, reachOut, alsoDids } = v
  if (typeof id !== 'string' || !id || id.length > 120 || id === '__proto__') return null
  if (typeof displayName !== 'string' || displayName.length > 120 || typeof did !== 'string' || !PEER_DID.test(did)) return null
  if (typeof ring !== 'string' || ring.length > 20 || typeof connectedAt !== 'number' || !Number.isFinite(connectedAt)) return null
  const also = Array.isArray(alsoDids) ? alsoDids.filter((d): d is string => typeof d === 'string' && PEER_DID.test(d) && d !== did).slice(0, ALSO_DIDS_MAX) : []
  return { id, displayName, did, ring: ring as Peer['ring'], connectedAt, ...(reachOut === true ? { reachOut: true as const } : {}), ...(also.length ? { alsoDids: also } : {}) }
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
    if (JSON.stringify(m) === JSON.stringify(t)) continue
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

/**
 * The two maps united, never with a cycle: both ends of a clash (X->Y vs X->Z) keep the lexicographically smaller target, a reverse pair
 * ({B:A} + {A:B}) keeps the larger id pointing at the smaller, and each such decision is listed.
 */
function uniteSameAs(mine: Record<string, string> | undefined, theirs: Record<string, string> | undefined, res: MergeResult): Record<string, string> | undefined {
  const out = { ...mine }
  const listed = (k: string, a: string, b: string, kept: Conflict['kept']): void => { res.conflicts.push({ kind: 'sameAs', id: k, label: k, kept, mine: a, theirs: b }) }
  for (const [k, v] of Object.entries(theirs ?? {})) {
    if (k === v) continue
    const have = has(out, k) ? out[k] : undefined
    if (have === v) continue
    const target = have === undefined || v < have ? v : have
    if (have !== undefined) listed(k, have, v, target === have ? 'mine' : 'theirs')
    if (resolveSameAs(out, target) === k) {
      if (out[target] !== k || k < target) { listed(k, String(have ?? ''), v, 'mine'); continue }
      delete out[target]
    }
    if (target !== have) { out[k] = target; if (have === undefined) res.added++ }
  }
  return Object.keys(out).length ? out : undefined
}

/** The incoming bundle with every person id (and the stamp keys and meeting links that name one) mapped through `map`. */
function remapBundle(b: SyncBundle, map: Record<string, string> | undefined): SyncBundle {
  if (!map) return b
  const id = (x: string): string => resolveSameAs(map, x)
  const at: Record<string, number> = {}
  const by: Record<string, string> = {}
  const from: Record<string, string> = {}
  const hp: Record<string, number> = {}
  for (const [k, n] of Object.entries(b.at)) {
    const key = k.startsWith(KEY_PREFIX.person) ? KEY_PREFIX.person + id(k.slice(2)) : k
    if (at[key] === undefined || n > at[key]) {
      at[key] = n
      if (b.by?.[k] !== undefined) by[key] = b.by[k]
      if (b.from?.[k] !== undefined) from[key] = b.from[k]
      if (b.hp?.[k] !== undefined) hp[key] = b.hp[k]
    }
  }
  return {
    ...b, at, by, from, ...(b.hp ? { hp } : {}),
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
  const quiet = Object.keys(book).sort((a, b) => lastAt(book[a]) - lastAt(book[b])).slice(0, Math.max(0, Object.keys(book).length - CHAT_MAX_THREADS))
  for (const id of quiet) delete book[id]
  if (quiet.length) res.conflicts.push({ kind: 'chat', id: 'threads', label: `${quiet.length} chat thread(s) dropped`, kept: 'mine', mine: `The ${quiet.length} quietest chat thread(s) were left out: ${CHAT_MAX_THREADS} is the most TrustWeb keeps.`, theirs: '' })
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

/** Per field: one only the other side has is taken; one both have and differ goes to the newer stamp (this side on a tie). Nothing is deleted. */
function mergeSettings(mine: AppState, theirs: SyncBundle, c: Ctx): void {
  const own = mine as unknown as Record<string, unknown>
  for (const [k, t] of Object.entries(theirs.settings ?? {})) {
    const m = has(own, k) ? own[k] : undefined
    if (m !== undefined && hashOf(m) === hashOf(t)) continue
    const rule = SETTING_MERGERS.get(k)
    if (rule) {
      const joined = rule(m, t)
      if (JSON.stringify(joined) !== JSON.stringify(m)) { own[k] = joined; if (m === undefined) c.res.added++; else c.res.updated++ }
      continue
    }
    if (m === undefined) c.res.added++
    else if ((theirs.at[SETTING_PREFIX + k] ?? 0) > (c.myAt[SETTING_PREFIX + k]?.at ?? 0)) c.res.updated++
    else continue
    own[k] = t
  }
}

/** The name shown on the public link: skipped when the other side has no timestamp for it; otherwise the newer wins and the difference is listed like a messenger link (F12). */
function mergeDisplayName(mine: AppState, myStamps: Stamps, theirs: SyncBundle, res: MergeResult): void {
  const t = theirs.at['n:me']
  const m = mine.me?.displayName
  if (!theirs.displayName || !t || !m || theirs.displayName === m) return
  const my = myStamps['n:me']
  const theirsWins = t > (my?.at ?? 0)
  res.conflicts.push({ kind: 'name', id: 'displayName', label: 'Name on my public link', kept: theirsWins ? 'theirs' : 'mine', mine: m, theirs: theirs.displayName, mineAt: my?.at, mineBy: my?.by, theirsAt: t, theirsBy: theirs.by?.['n:me'] })
  if (theirsWins) { mine.me.displayName = theirs.displayName; res.updated++ }
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
  // Wave 44c answers-44c (A4): tombstones first: their newer delete takes my copy away, my newer delete keeps their older copy out.
  const tomb = mergeTrash(mine, theirs.trash ?? [], { event: theirs.events ?? [], resource: theirs.inventory, task: theirs.tasks ?? [], meeting: theirs.meetings, invitation: theirs.invitations ?? [] },
    (k, id) => KEY_PREFIX[k] + id, (k) => myStamps[k]?.at ?? 0, (k) => theirs.at[k] ?? 0)
  res.updated += tomb.changed
  const live = tomb.lists as { event: TwEvent[]; resource: InventoryItem[]; task: TwTask[]; meeting: PastMeeting[]; invitation: Invitation[] }
  mine.people = mergeList('person', mine.people, theirs.people.map(withoutPersonImage), c, (p) => p.name, uniteKeepingDelete)
  mine.inventory = mergeList('resource', mine.inventory, live.resource.map(withoutImage), c, (x) => x.text, fillMissing)
  mine.meetings = mergeList('meeting', mine.meetings ?? [], live.meeting, c, (x) => x.about, fillMissing)
  if (live.event.length) mine.events = mergeList('event', mine.events ?? [], live.event, c, (x) => x.name, fillMissing)
  // A task is edited whole (ticking removes `done`): the newer version wins as it is, nothing is filled in from the older.
  if (live.task.length) mine.tasks = mergeList('task', mine.tasks ?? [], live.task, c, (x) => x.title, (winner) => winner)
  if (live.invitation.length) mine.invitations = mergeList('invitation', mine.invitations ?? [], live.invitation, c, (x) => x.event ?? x.place ?? x.id, (winner) => winner)
  if (theirs.channels) mergeChannels(mine, theirs.channels, c)
  if (theirs.chats) mergeChats(mine, theirs.chats, res)
  if (theirs.peers?.length) mergePeers(mine, theirs.peers, c)
  mergeSettings(mine, theirs, c)
  mergeDisplayName(mine, myStamps, theirs, res)
  collapseSamePersons(mine)
  dedupeByPeerId(mine)
  dropAnsweredWants(mine)
  return res
}

/** Wave 43c: a "Wants to connect" row whose connection has a card by now (Add was pressed on the other device) is answered: it goes. */
function dropAnsweredWants(s: AppState): void {
  if (!s.wantsToConnect?.length) return
  const carded = new Set(alive(s.people).flatMap((p) => (p.peerId ? [p.peerId] : [])))
  const rest = s.wantsToConnect.filter((w) => !carded.has(w.peerId))
  if (rest.length === s.wantsToConnect.length) return
  if (rest.length) s.wantsToConnect = rest
  else delete s.wantsToConnect
}

/** A person's two versions united, the winner's delete state kept as it is: an older delete never fills in over a newer edit, and an undelete travels. */
function uniteKeepingDelete(winner: Person, loser: Person): Person {
  const out = unitePerson(winner, loser)
  if (winner.deleted_at === undefined) delete out.deleted_at
  return out
}

/**
 * Wave 43c: connections by DID. An unknown one is added as `synced` and heard (this device never sends it a connect-ack: the other side would
 * make a second card for me). A known one: name and ring go to the newer stamp; the other devices (alsoDids) are united; this device's
 * bookkeeping (acks, told, id) stays.
 */
function mergePeers(mine: AppState, theirs: Peer[], c: Ctx): void {
  const peers = [...(mine.peers ?? [])]
  for (const t of theirs) {
    const i = peers.findIndex((p) => p.did === t.did)
    if (i < 0) { peers.push({ ...t, synced: true, heardAt: t.connectedAt }); c.res.added++; continue }
    const m = peers[i]
    const key = peerKey(t.did)
    const theirsWins = (c.theirs.at[key] ?? 0) > (c.myAt[key]?.at ?? 0)
    const also = [...new Set([...(m.alsoDids ?? []), ...(t.alsoDids ?? [])])].filter((d) => d !== m.did).slice(0, ALSO_DIDS_MAX)
    const next: Peer = { ...m, ...(theirsWins ? { displayName: t.displayName, ring: t.ring } : {}), ...(also.length ? { alsoDids: also } : {}) }
    if (JSON.stringify(next) !== JSON.stringify(m)) { peers[i] = next; c.res.updated++ }
  }
  mine.peers = peers
}

/** How much a card holds: note lines, then fields, then the older meeting, then the id (so both devices pick the same keeper). */
function richer(a: Person, b: Person): Person {
  const score = (p: Person): number[] => [p.lines.length, Object.keys(p.fields ?? {}).length, -p.metAt]
  const [x, y] = [score(a), score(b)]
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i] ? a : b
  return a.id < b.id ? a : b
}

/**
 * Wave 43c: cards of one connection (same peerId, not deleted) become one: the richer card is kept, the other merged into it (same_person.ts
 * mergePersons writes sameAs, so the other device collapses them too). Chats are keyed by peerId, so the chat list shows the person once. True when any merged.
 */
export function dedupeByPeerId(s: AppState): boolean {
  let any = false
  const seen = new Map<string, Person>()
  for (const p of [...s.people]) {
    if (!p.peerId || p.deleted_at !== undefined) continue
    const have = seen.get(p.peerId)
    if (!have) { seen.set(p.peerId, p); continue }
    const keep = richer(have, p)
    const drop = keep === have ? p : have
    if (mergePersons(s, keep.id, drop.id)) { any = true; seen.set(p.peerId, s.people.find((x) => x.id === keep.id) ?? keep) }
  }
  return any
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
  const theirHash = new Map(entities(sourceOf(theirs), theirs.settings ?? {}).map(([k, e]) => [k, hashOf(e)]))
  for (const [key, e] of entities(s, settingsOf(s))) {
    const at = theirs.at[key]
    if (at === undefined) continue
    const from = before[key]?.from ?? theirs.from?.[key] ?? theirName
    if (theirHash.get(key) === hashOf(e)) {
      // Wave 44c: what this merge changed here is taken over from that device: it may go on to a third one (rx, one more hop).
      const took = before[key]?.h !== hashOf(e) ? { rx: now, hp: (theirs.hp?.[key] ?? 0) + 1 } : { ...(before[key]?.rx !== undefined ? { rx: before[key].rx } : {}), ...(before[key]?.hp !== undefined ? { hp: before[key].hp } : {}) }
      fresh[key] = { h: hashOf(e), at, by: theirs.by?.[key] ?? theirName, from, ...took }
    }
    else fresh[key] = { ...fresh[key], from }
  }
  return fresh
}

/** Wave 44c: the stable id of a device in stamps (`by`, `from`): from its sync DID, never its editable name. */
export const syncIdOf = (did: string): string => 'd:' + (did.split('.')[1] ?? did).slice(-12)

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

/** Wave 44c: the QR of "Link a device" holds a link of the app (the phone's camera app opens it), the pairing code is its fragment. Switch: one constant. */
export const PAIR_LINK_BASE = 'https://app.trustweb.one/'
export const pairLink = (code: string): string => `${PAIR_LINK_BASE}#pair=${code}`
/** The code in a page fragment (`#pair=<code>`), or null. */
export const pairCodeFromHash = (hash: string): string | null => /^#?pair=([^&\s]+)/.exec(hash)?.[1] ?? null

export function pairingCode(did: string, secret: string): string {
  return [CODE_PREFIX, did, secret].join('~')
}

export function parsePairingCode(text: string): { did: string; secret: string } | null {
  const t = text.trim()
  // Wave 44c: the code also comes inside a link of the app (`/#pair=<code>`, or `/pair#<code>`): only the code matters, never the host.
  const [prefix, did, secret, ...rest] = (/(?:#pair=|\/pair#)([^&\s#]+)/.exec(t)?.[1] ?? t).split('~')
  return prefix === CODE_PREFIX && rest.length === 0 && DID_RE.test(did ?? '') && SECRET_RE.test(secret ?? '') ? { did, secret } : null
}

/** The 4-character check both devices show; a hex slice of the SHA-256 of the pair's shared secret. */
export async function fingerprintOf(shared: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', shared as BufferSource))
  return Array.from(d.subarray(0, 2), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}
