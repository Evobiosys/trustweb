/**
 * trustweb-peer: an always-on TrustWeb front door that NEVER decides an
 * answer by itself (owner, 2026-10-06 10:00: "not the server answers asks, I
 * do"). A server only carries out what its owner decided:
 *
 *   1. his live yes/no per ask: the peer FORWARDS the ask to the owner's
 *      phone (a 'query' envelope with relayed: true, the wire that already
 *      exists) and relays back what the owner's phone shared, or nothing;
 *   2. a permission he set in advance: a line in the inventory file that
 *      carries a `preset` block ({ by, at, note? }) may be shared without a
 *      live tap, and every such shared line is VISIBLY MARKED as allowed in
 *      advance (SharedItem.context). A line without a preset is never
 *      shared by this service, whatever its audience says.
 *
 * So the app's sentence "only a person can say yes" stays true for this
 * peer: the person said yes live (1) or in advance and visibly (2). Nothing
 * else answers. The owner's phone off = (1) yields nothing, honestly.
 *
 * Everything on the wire is what a phone sends: the did:peer:2 identity
 * (apps/demo/src/did.ts), the relay drain (relay.ts), the one-scan
 * connect-ack (connect_link.ts), the matcher (match/lexical.ts), the
 * surface-or-stay-silent decision (incoming_query.ts) and the sealed
 * fixed-length answer in which "nothing matched", "not shared" and "the
 * owner was unreachable" are the same bytes, sent at one moment fixed when
 * the ask arrived: RELAY_DEADLINE_MS after it (gate.ts), or, while the ask
 * is forwarded to the owner, the forward deadline, so WHEN an answer comes
 * says nothing either (only the owner's live share goes early: its content
 * says so anyway). Reused, not copied.
 *
 * Owner binding (the "claim" ceremony): the owner's phone becomes the owner
 * by scanning this peer's connect link while a claim window is open (a
 * file `claim-open` in the state dir, or TW_PEER_CLAIM=1 at start; the
 * window closes after claimWindowMs or at the first bind, whichever comes
 * first). After that, every other connect-ack is an asker. The owner's DID
 * is kept in state.json (0600), never logged.
 *
 * Two instances, same code:
 *   demo      PeerPolicy.Open: anyone who opens its connect link is an asker
 *             (acquaintance ring); named Jakob; exactly the owner's ten public
 *             allowed-in-advance lines, all with presets
 *             (demo_inventory.json); meant for the Swiss server.
 *   personal  PeerPolicy.Granted: a connect-ack is honoured only for a name
 *             the owner granted beforehand (grants.json); its inventory holds
 *             only lines the owner allowed in advance (inventory_export.ts).
 *             Host (questhub or sebra) is the owner's decision; not deployed
 *             yet; see README.txt.
 *
 * Hops (wave 6, apps/trustweb/src/hops.ts): an ask may carry how far it may
 * travel. The front door and its owner's phone are ONE person: an ask is
 * forwarded to the owner at the same step (`door: true`), and the owner's
 * phone passes it on to its own contacts where the asker allowed it. A preset
 * line answers a further-out ask only within its degrees (cascade.ts). The
 * answer moment stays fixed by the envelope alone (hops.ts doorAnswerDelayMs).
 *
 * Friends (wave 6d, Jakob 2026-10-08: "one dummy friend of mine that has a Tandem to lend out to friends of friends"): the
 * inventory file may also carry an optional `friends` section, [{ name, ring, allowedInAdvance: true, at?, note?, items: [{ text,
 * audience, degrees? }] }]. A friend of the owner who allowed her lines in advance is asked THROUGH this door exactly as her own
 * phone would be at the next step: only for an ask that may travel one more hop (hops.ts mayCascade), through cascade.ts
 * askSources at hop + 1 in HER ring for the owner, matched on their own (never merged with the door's lines), and every such line
 * comes back marked `via: [this door's name]` ("through Jakob") with her name in its context. Her lines never change WHEN an
 * answer is sent (the moment is fixed before anything is matched) and never answer a "My contacts" ask. An absent or malformed
 * section changes nothing.
 *
 * Privacy on this host: no ask text is ever logged; the log has counts and
 * outcomes only. The inventory file is read once at start and on SIGHUP.
 *
 * Run (from the repo root; tsx comes with the workspace):
 *   TW_PEER_STATE=/tmp/twpeer TW_PEER_INVENTORY=services/trustweb-peer/demo_inventory.json \
 *   TW_PEER_RELAY=https://app.idea2.site node_modules/.bin/tsx services/trustweb-peer/peer.ts
 * It writes <state>/demo-peer.json, the card a TrustWeb app reads to put this
 * peer into a demo-account link (apps/trustweb/src/demo_account.ts).
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import path from 'node:path'
import { createIdentity, deserializeIdentity, ecdhSharedSecret, serializeIdentity } from '../../apps/demo/src/did'
import type { Identity as DidIdentity } from '../../apps/demo/src/did'
import { createRelayChannel } from '../../apps/demo/src/relay'
import type { RelayChannel, RelayStatus } from '../../apps/demo/src/relay'
import { deriveEcdhPairKey, randomId } from '../../apps/demo/src/crypto'
import { decodeFromQr } from '../../apps/demo/src/wire'
import type { Envelope } from '../../apps/demo/src/wire'
import { RELAY_DEADLINE_MS, interpret, settleAt, truncateSharedJson } from '../../apps/demo/src/gate'
import { sealRelayAnswer } from '../../apps/demo/src/answer_key'
import { classifyIncomingQuery } from '../../apps/demo/src/incoming_query'
import { matchTemplate } from '../../apps/demo/src/match/lexical'
import { FREE_TEXT_MAX_LEN } from '../../apps/demo/src/types'
import type { AnswerEnvelope, MatchResult, QueryEnvelope, SharedItem, SharedPayload } from '../../apps/demo/src/types'
import type { QueryTemplate } from '../../apps/demo/src/types'
import type { ChatThread } from '../../apps/demo/src/types'
import { askSources, isDegrees } from '../../apps/trustweb/src/cascade'
import { answerDelayMs, dedupeItems, doorAnswerDelayMs, doorFields, hopInfo, mayCascade, mayForwardToOwner, RootMemory, sanitizeHopItems, seenHash, surfacesAt } from '../../apps/trustweb/src/hops'
import type { HopInfo } from '../../apps/trustweb/src/hops'
import { ASK_TEMPLATE_ID, askTemplate, forgivingAskTemplate, lineTextsOf } from '../../apps/trustweb/src/lexicon'
import { Audience, AUDIENCES, Ring, coarseWhen } from '../../apps/trustweb/src/model'
import { stripUnsafe } from '../../apps/trustweb/src/safe_text'
import type { AppState, InventoryItem, LineRef, Peer } from '../../apps/trustweb/src/model'

export enum PeerPolicy {
  /** Anyone who opens the connect link becomes an asker (the demo inventory). */
  Open = 'open',
  /** Only names granted beforehand (grants.json) become askers (the personal inventory). */
  Granted = 'granted',
}

/** What the owner's phone did with a forwarded ask. */
export enum OwnerOutcome {
  /** No owner is bound, or forwarding is off: nothing was asked of anyone. */
  NotAsked = 'not-asked',
  Shared = 'shared',
  /** A decline, a no-match on the phone, or an undecodable answer: the same bytes to the asker. */
  Nothing = 'nothing',
  /** The owner's phone did not answer within forwardWaitMs (off, or still deciding). */
  Timeout = 'timeout',
}

export enum AskOutcome {
  NoMatch = 'no-match',
  Shared = 'shared',
  RateLimited = 'rate-limited',
}

/** A permission the owner set in advance for one line; `at` is an ISO date. */
export interface PresetPermission {
  by: string
  at: string
  note?: string
}

export interface PresetLine {
  item: InventoryItem
  preset: PresetPermission
}

export interface LoadedInventory {
  /** Lines the owner allowed in advance: the only lines this peer may share without a live tap. */
  preset: PresetLine[]
  /** Well-formed lines WITHOUT a preset: held, counted, never shared. */
  held: number
}

/** A friend of the door's owner who allowed her lines in advance, as loaded (wave 6d). */
export interface FriendEntry {
  name: string
  /** How the friend holds the owner: the ring the ask is handed to her in (cascade.ts admission at hop + 1). */
  ring: Ring
  /** The mark shown next to each of her lines: who, a friend of whom, allowed in advance by whom. */
  context: string
  items: InventoryItem[]
  /** The same lines with their aliases (other languages, compounds) appended: what the matcher reads. Never shown or sent. */
  matchable: InventoryItem[]
}

export interface LoadedFriends {
  friends: FriendEntry[]
  /** Shareable lines of all friends together. */
  lines: number
  /** Well-formed friend lines that are NOT shared: the friend did not allow them in advance, or they are too long. */
  held: number
}

export interface PeerOptions {
  /** Where state.json, demo-peer.json, grants.json and claim-open live. */
  stateDir: string
  /** The inventory file: { "items": [{ "text", "audience", "preset"?: { "by", "at", "note"? } }] }. */
  inventoryFile: string
  /** The relay's origin (the app's origin in production: https://app.idea2.site). */
  relayOrigin: string
  name?: string
  policy?: PeerPolicy
  /** Loopback health server port; 0 = none. */
  healthPort?: number
  maxPeers?: number
  asksPerHour?: number
  /** Forward asks to the bound owner's phone (default true). */
  forward?: boolean
  /** How long to wait for the owner's phone before answering the asker with the preset hits only. */
  forwardWaitMs?: number
  /** Opens a claim window now (same as the claim-open file). */
  claim?: boolean
  claimWindowMs?: number
  /** The minimum time between an ask's arrival and its answer; tests only, production keeps RELAY_DEADLINE_MS. */
  answerWindowMs?: number
  log?: (line: string) => void
}

/** The card a TrustWeb app reads (apps/trustweb/src/demo_account.ts isDemoPeerRef). */
export interface PeerCard {
  did: string
  id: string
  name: string
}

export interface PeerStatus {
  relay: RelayStatus
  peers: number
  owner: boolean
  forward: boolean
  claimOpen: boolean
  presetLines: number
  heldLines: number
  /** Friends of the owner whose lines this door answers through him, and how many lines (counts only, never their text). */
  friends: number
  friendLines: number
}

export interface RunningPeer {
  card: PeerCard
  status(): PeerStatus
  peerCount(): number
  stop(): Promise<void>
}

interface Owner {
  did: string
  displayName: string
  boundAt: number
}

interface PeerState {
  me: { id: string; displayName: string }
  identity: ReturnType<typeof serializeIdentity>
  peers: Peer[]
  owner?: Owner
}

/** The demo front door is Jakob's (wave 5, owner 2026-10-07: in the demo people connect with him and his actual public lines). */
const DEFAULT_NAME = 'Jakob'
const DEFAULT_MAX_PEERS = 500
const DEFAULT_ASKS_PER_HOUR = 30
const DEFAULT_FORWARD_WAIT_MS = 120_000
const DEFAULT_CLAIM_WINDOW_MS = 10 * 60_000
const HOUR_MS = 3_600_000
const PRESET_NOTE_MAX_LEN = 120
/**
 * The longest inventory line (characters) the peer holds as shareable. It was 160 and cut a longer line short, which served the
 * owner's ten public lines as eight (two are 171 and 194 characters). It is NOT 400, as the first draft of wave 5 had it: an answer
 * is one fixed 512-byte block (ANSWER_BODY_LEN), the line travels with its `when` and `context` inside it, and a line too long for
 * that block is dropped from the answer whole (the asker gets "no match", the peer's log says "shared"). One line with the
 * standard preset context fits up to about 324 to 359 characters, so 300 is the sane upper bound; fitsAnswer below enforces the
 * real limit per line, whatever its preset says. A line over either is HELD (counted, never shared), never cut: what goes out is
 * exactly the text the owner allowed in advance.
 */
export const INVENTORY_LINE_MAX = 300
/** The longest coarse "when" label ("early September") and the widest name a front door is given: the worst case for the answer's size. */
const ANSWER_WORST_WHEN = 'early September'
const ANSWER_WORST_NAME_LEN = 40

/** Would this item, alone, still fit the answer block (apps/demo gate.ts truncateSharedJson)? */
function fitsBlock(item: SharedItem, from: string = 'x'.repeat(ANSWER_WORST_NAME_LEN)): boolean {
  const body = truncateSharedJson({ from, templateId: ASK_TEMPLATE_ID, items: [item] })
  return !new TextDecoder().decode(body).includes('"tr":1')
}

/** Would this line, alone, still fit the answer block under its own preset context? */
export function fitsAnswer(text: string, preset: PresetPermission): boolean {
  return fitsBlock({ text, when: ANSWER_WORST_WHEN, context: presetContext(preset) })
}

/** Would a friend's line, alone, still fit the answer block with her mark and the door's own name as the sender and as "through <door>"? (Exact, multibyte names included.) */
export function fitsFriendAnswer(text: string, context: string, doorName: string): boolean {
  return fitsBlock({ text, when: ANSWER_WORST_WHEN, context, via: [doorName] }, doorName)
}
const CLAIM_FILE = 'claim-open'
/** apps/demo's prune(): keep the relevance band, at most three lines (net.ts). */
const RELEVANCE_BAND = 0.5
const MAX_SHARED = 3

function prune(m: MatchResult): MatchResult {
  if (!m.hits.length) return m
  const top = m.hits[0].score
  return { ...m, hits: m.hits.filter((h) => h.score >= top * RELEVANCE_BAND).slice(0, MAX_SHARED) }
}

/** The template of an ask, for its id and what travels (the asker's own words only). */
function templateFor(text: string): QueryTemplate {
  return askTemplate(text)
}

/**
 * The ONE place this file runs the matcher on an ask (with apps/demo's prune). The template is
 * widened here by the preset lines (typos, plurals, "Community hof" for "Communityhof"); nothing
 * of that widening ever travels.
 */
export function matchAsk(text: string, threads: ChatThread[]): MatchResult {
  return prune(matchTemplate(forgivingAskTemplate(text, lineTextsOf(threads)), threads))
}

function isAudience(v: unknown): v is Audience {
  return typeof v === 'string' && (AUDIENCES as readonly string[]).includes(v)
}

/** A preset is accepted only when it names who allowed it and a parseable date; a malformed preset = no preset. */
export function parsePreset(v: unknown): PresetPermission | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.by !== 'string' || !o.by.trim()) return null
  if (typeof o.at !== 'string' || Number.isNaN(Date.parse(o.at))) return null
  const note = typeof o.note === 'string' && o.note.trim() ? o.note.trim().slice(0, PRESET_NOTE_MAX_LEN) : undefined
  return { by: o.by.trim(), at: o.at, ...(note ? { note } : {}) }
}

/** What the asker sees next to a line allowed in advance: who, when, and the owner's note if any. */
export function presetContext(p: PresetPermission): string {
  const day = p.at.slice(0, 10)
  return `Allowed in advance by ${p.by} (${day})` + (p.note ? `: ${p.note}` : '')
}

/** Parses the inventory file's `items`; a malformed line is skipped, never guessed at; a line without a preset, over INVENTORY_LINE_MAX, or too long for the answer block with its preset, is held. */
export function parseInventory(raw: unknown, now: number): LoadedInventory {
  const items = (raw as { items?: unknown } | null)?.items
  if (!Array.isArray(items)) return { preset: [], held: 0 }
  const out: LoadedInventory = { preset: [], held: 0 }
  for (const it of items) {
    const o = asRecord(it)
    if (typeof o.text !== 'string' || !o.text.trim() || !isAudience(o.audience)) continue
    const preset = parsePreset(o.preset)
    const text = o.text.trim()
    if (!preset || text.length > INVENTORY_LINE_MAX || !fitsAnswer(text, preset)) { out.held++; continue }
    // Wave 6: optional degrees (cascade.ts); absent or malformed = the default for its audience.
    const degrees = isDegrees(o.degrees) ? { degrees: o.degrees } : {}
    out.preset.push({
      item: { id: randomId(8), text, audience: o.audience, included: true, createdAt: now, ...degrees },
      preset,
    })
  }
  return out
}

/** Reads the inventory file (the owner's lines; the optional friends section is read by parseFriends from the same parse). */
export function loadInventory(file: string, now: number): LoadedInventory {
  return parseInventory(JSON.parse(readFileSync(file, 'utf8')), now)
}

/** The rings a friend may hold the owner in: "intending" admits nothing (cascade.ts), so it is not a friend. */
const FRIEND_RINGS: readonly Ring[] = [Ring.Close, Ring.Friend, Ring.Acquaintance]
const FRIEND_NOTE_MAX_LEN = 60
const ALIASES_MAX = 6
/** Bounds on a friends section: every ask runs the matcher once per friend, on the event loop. */
const FRIENDS_MAX = 20
const FRIEND_ITEMS_MAX = 20
const ALIAS_MAX_LEN = 40

/** The mark next to a friend's line: whose it is, whose friend, and that she allowed it in advance (never a private detail). */
export function friendContext(name: string, doorName: string, at?: string, note?: string): string {
  return `${name}, a friend of ${doorName}. Allowed in advance by ${name}${at ? ` (${at})` : ''}${note ? `: ${note}` : ''}`
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}/

function optionalDay(v: unknown): string | undefined {
  return typeof v === 'string' && ISO_DAY_RE.test(v) && !Number.isNaN(Date.parse(v)) ? v.slice(0, 10) : undefined
}

/** Clips by code points, never through a surrogate pair. */
function clipChars(s: string, max: number): string {
  return [...s].slice(0, max).join('')
}

function optionalNote(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? stripUnsafe(v).trim().slice(0, FRIEND_NOTE_MAX_LEN) : undefined
}

/** How many entries a friend's `items` holds (counted as held when the friend is beyond the cap). */
function countLines(items: unknown): number {
  return Array.isArray(items) ? items.length : 0
}

/** The optional `aliases` of a line: a few short words, cleaned; anything else = none. */
/** A JSON value as a record, or an empty one: hostile content never throws out of the load path. */
function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function parseAliases(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const words = v.filter((w): w is string => typeof w === 'string').map((w) => stripUnsafe(w).trim().slice(0, ALIAS_MAX_LEN)).filter(Boolean)
  return [...new Set(words)].slice(0, ALIASES_MAX)
}

interface ParsedFriendItems {
  items: InventoryItem[]
  aliases: Map<string, string[]>
  held: number
}

/** One friend's lines: shareable ones become items; every other well-formed line (or any beyond FRIEND_ITEMS_MAX) is only counted as held. */
function parseFriendItems(raw: unknown, context: string, doorName: string, allowed: boolean, now: number): ParsedFriendItems {
  const out: ParsedFriendItems = { items: [], aliases: new Map(), held: 0 }
  if (!Array.isArray(raw)) return out
  for (const it of raw) {
    const o = asRecord(it)
    if (typeof o.text !== 'string' || !o.text.trim() || !isAudience(o.audience)) continue
    const text = stripUnsafe(o.text).trim()
    if (!text) continue
    if (!allowed || out.items.length >= FRIEND_ITEMS_MAX || text.length > INVENTORY_LINE_MAX || !fitsFriendAnswer(text, context, doorName)) { out.held++; continue }
    const degrees = isDegrees(o.degrees) ? { degrees: o.degrees } : {}
    const id = randomId(8)
    out.items.push({ id, text, audience: o.audience, included: true, createdAt: now, ...degrees })
    const aliases = parseAliases(o.aliases)
    if (aliases.length) out.aliases.set(id, aliases)
  }
  return out
}

/**
 * The optional `friends` section of the inventory file (wave 6d): [{ name, ring, allowedInAdvance: true, at?, note?, items }].
 * Absent or not an array = no friends, today's behaviour. An entry without a usable name or ring is skipped; one that did not set
 * `allowedInAdvance` to exactly true is held whole (counted, never shared). Never throws on content.
 */
export function parseFriends(raw: unknown, doorName: string, now: number): LoadedFriends {
  const out: LoadedFriends = { friends: [], lines: 0, held: 0 }
  const section = (raw as { friends?: unknown } | null)?.friends
  if (!Array.isArray(section)) return out
  for (const f of section) {
    if (out.friends.length >= FRIENDS_MAX) { out.held += countLines(asRecord(f).items); continue }
    const o = asRecord(f)
    const name = typeof o.name === 'string' ? clipChars(stripUnsafe(o.name).trim(), ANSWER_WORST_NAME_LEN) : ''
    const ring = FRIEND_RINGS.find((r) => r === o.ring)
    if (!name || !ring) continue
    const context = friendContext(name, doorName, optionalDay(o.at), optionalNote(o.note))
    const parsed = parseFriendItems(o.items, context, doorName, o.allowedInAdvance === true, now)
    out.held += parsed.held
    if (!parsed.items.length) continue
    const matchable = parsed.items.map((i) => ({ ...i, text: [i.text, ...(parsed.aliases.get(i.id) ?? [])].join(' ') }))
    out.friends.push({ name, ring, context, items: parsed.items, matchable })
    out.lines += parsed.items.length
  }
  return out
}

/** The answer from the owner's friends for an ask at the owner's door that arrived at step `hop` (their step is hop + 1). */
export function friendAnswers(friends: readonly FriendEntry[], text: string, hop: number, doorName: string): SharedItem[] {
  const out: SharedItem[] = []
  for (const friend of friends) {
    // Matched on the line plus its aliases; what is shown and sent is the line's own text.
    const asState: AppState = { v: 1, me: { id: 'door', displayName: doorName }, peers: [], people: [], inventory: friend.matchable, log: [], notificationsOn: false }
    const { threads, refs } = askSources(asState, friend.ring, hop + 1)
    const match = matchAsk(text, threads)
    if (!classifyIncomingQuery(match, false, true).surface) continue
    for (const h of match.hits) {
      const r = refs.get(h.threadId)
      const own = r ? friend.items.find((i) => `inv:${i.id}` === r.threadId) : undefined
      if (r && own) out.push({ text: own.text, when: coarseWhen(r.at), context: friend.context, via: [doorName] })
    }
  }
  return out
}

/**
 * The owner's live share first, then the friends' lines, then the door's own: the answer is one fixed block and its tail is what
 * gets cut when it is full, so a friend's line (the one that needs the friend's mark) is never behind a long door line. Same
 * line twice (the owner's share and a friend's) is shown once, as a phone does (hops.ts dedupeItems).
 */
export function mergeAnswerItems(owner: readonly SharedItem[], preset: readonly SharedItem[], friends: readonly SharedItem[]): SharedItem[] {
  return dedupeItems([...owner, ...friends, ...preset]).slice(0, MAX_SHARED)
}

/**
 * How a granted name compares: Unicode NFC, trimmed, inner whitespace
 * collapsed, lower-cased. scripts/trustweb_peer_grant.sh stores names the
 * same way, so " Ben  Bauer " from a phone matches "Ben Bauer" on the list.
 */
export function grantKey(name: string): string {
  return name.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The names a Granted peer honours: { "names": ["anna-demo", ...] }, compared by grantKey. */
export function loadGrants(stateDir: string): Set<string> {
  const file = path.join(stateDir, 'grants.json')
  if (!existsSync(file)) return new Set()
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'))
  const names = (raw as { names?: unknown }).names
  return new Set(Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string').map(grantKey).filter(Boolean) : [])
}

/**
 * A file error for the log WITHOUT its content: JSON.parse quotes the start
 * of the text it failed on ("Unexpected token 'm', "my therapi"..."), and an
 * inventory or grants file must never reach the journal that way.
 */
export function fileErrorForLog(e: unknown): string {
  if (e instanceof SyntaxError) return 'not valid JSON'
  const code = (e as { code?: unknown } | null)?.code
  return typeof code === 'string' ? code : 'unreadable'
}

/** Sliding one-hour window per asker; the limit is per connected peer, not global. */
export class AskRateLimit {
  private readonly seen = new Map<string, number[]>()
  constructor(private readonly perHour: number) {}
  allow(did: string, now: number): boolean {
    const recent = (this.seen.get(did) ?? []).filter((t) => now - t < HOUR_MS)
    if (recent.length >= this.perHour) { this.seen.set(did, recent); return false }
    recent.push(now)
    this.seen.set(did, recent)
    return true
  }
}

/** The text the owner's phone shows for a forwarded ask: who asks, then what; bounded like any free text. */
export function forwardedText(askerName: string, text: string): string {
  return `${askerName}: ${text}`.slice(0, FREE_TEXT_MAX_LEN)
}

function loadState(stateDir: string, relayOrigin: string, name: string): PeerState {
  const file = path.join(stateDir, 'state.json')
  if (existsSync(file)) {
    const s = JSON.parse(readFileSync(file, 'utf8')) as PeerState
    if (s && s.me && s.identity && Array.isArray(s.peers)) return { ...s, me: { ...s.me, displayName: name } }
  }
  const identity = createIdentity(relayOrigin + '/relay')
  return { me: { id: randomId(12), displayName: name }, identity: serializeIdentity(identity), peers: [] }
}

function saveState(stateDir: string, s: PeerState): void {
  const file = path.join(stateDir, 'state.json')
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 })
  writeFileSync(file, readFileSync(tmp), { mode: 0o600 })
}

/** Loopback only; the Host header must be loopback too and no Origin is accepted (local-service rule). */
function healthServer(port: number, card: PeerCard, status: () => PeerStatus): Promise<Server> {
  const srv = createServer((req, res) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || req.headers.origin !== undefined) {
      res.writeHead(421).end()
      return
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return }
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }).end('ok'); return }
    if (req.url === '/card') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(card)); return }
    if (req.url === '/status') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(status()))
      return
    }
    res.writeHead(404).end()
  })
  return new Promise((resolve) => srv.listen(port, '127.0.0.1', () => resolve(srv)))
}

export async function startPeer(opts: PeerOptions): Promise<RunningPeer> {
  const name = opts.name ?? DEFAULT_NAME
  const policy = opts.policy ?? PeerPolicy.Open
  const maxPeers = opts.maxPeers ?? DEFAULT_MAX_PEERS
  const forward = opts.forward ?? true
  const forwardWaitMs = opts.forwardWaitMs ?? DEFAULT_FORWARD_WAIT_MS
  const answerWindowMs = opts.answerWindowMs ?? RELAY_DEADLINE_MS
  const log = opts.log ?? ((line: string): void => { console.log(new Date().toISOString() + ' ' + line) })
  mkdirSync(opts.stateDir, { recursive: true, mode: 0o700 })
  const state = loadState(opts.stateDir, opts.relayOrigin, name)
  const identity: DidIdentity = deserializeIdentity(state.identity)
  /** The inventory file read once: the door's own lines and the optional friends section come from the same parse. */
  const readInventoryFile = (now: number): { inventory: LoadedInventory; friends: LoadedFriends } => {
    const raw: unknown = JSON.parse(readFileSync(opts.inventoryFile, 'utf8'))
    return { inventory: parseInventory(raw, now), friends: parseFriends(raw, name, now) }
  }
  const first = readInventoryFile(Date.now())
  let inventory = first.inventory
  let friends = first.friends
  let grants = loadGrants(opts.stateDir)
  const limiter = new AskRateLimit(opts.asksPerHour ?? DEFAULT_ASKS_PER_HOUR)
  const keys = new Map<string, Promise<CryptoKey>>()
  const seenQids = new Set<string>()
  const roots = new RootMemory()
  /** Forwarded asks waiting for the owner's phone, by the forwarded qid. */
  const awaitingOwner = new Map<string, (env: AnswerEnvelope) => void>()
  let relayStatus: RelayStatus = 'connecting'

  const claimFile = path.join(opts.stateDir, CLAIM_FILE)
  let claimUntil = 0
  if (!state.owner && (opts.claim || existsSync(claimFile))) {
    claimUntil = Date.now() + (opts.claimWindowMs ?? DEFAULT_CLAIM_WINDOW_MS)
    log('claim window open: the first phone to open the connect link becomes the owner')
  }
  const claimOpen = (): boolean => !state.owner && Date.now() < claimUntil
  const closeClaim = (): void => {
    claimUntil = 0
    if (existsSync(claimFile)) unlinkSync(claimFile)
  }

  const card: PeerCard = { did: identity.did, id: state.me.id, name }
  writeFileSync(path.join(opts.stateDir, 'demo-peer.json'), JSON.stringify(card) + '\n')
  saveState(opts.stateDir, state)

  const presetById = (): Map<string, PresetPermission> => new Map(inventory.preset.map((l) => [l.item.id, l.preset]))

  /** What the matcher sees: this peer's preset lines only, nobody's notes, nothing held. */
  const asAppState = (): AppState => ({
    v: 1, me: state.me, peers: state.peers, people: [], inventory: inventory.preset.map((l) => l.item), log: [], notificationsOn: false,
  })

  const pairKey = (did: string): Promise<CryptoKey> => {
    let k = keys.get(did)
    if (!k) {
      k = deriveEcdhPairKey(ecdhSharedSecret(identity, did))
      keys.set(did, k)
    }
    return k
  }
  const peerByDid = (did: string): Peer | undefined => state.peers.find((p) => p.did === did)
  const isOwner = (did: string): boolean => state.owner?.did === did

  /** Granted policy: a connected person stays an asker only while the name is still on the grant list. */
  const stillGranted = (p: Peer): boolean => policy !== PeerPolicy.Granted || grants.has(grantKey(p.displayName))
  /** Granted policy: forget everyone whose grant was removed (scripts/trustweb_peer_grant.sh --remove + SIGHUP). */
  const pruneUngranted = (): number => {
    const before = state.peers.length
    state.peers = state.peers.filter(stillGranted)
    const dropped = before - state.peers.length
    if (dropped) saveState(opts.stateDir, state)
    return dropped
  }

  const reload = (): void => {
    let next: { inventory: LoadedInventory; friends: LoadedFriends }
    let nextGrants: Set<string>
    try {
      next = readInventoryFile(Date.now())
      nextGrants = loadGrants(opts.stateDir)
    } catch (e) {
      // Both stay as they were; the reason is logged without the file's content.
      log('reload failed (kept the previous inventory and grants): ' + fileErrorForLog(e))
      return
    }
    inventory = next.inventory
    friends = next.friends
    grants = nextGrants
    const dropped = pruneUngranted()
    log(`reloaded: ${inventory.preset.length} preset lines, ${inventory.held} held, ${grants.size} grants${dropped ? `, ${dropped} no longer granted (forgotten)` : ''}, ${friends.lines} friends' lines (${friends.friends.length} friends)`)
  }
  process.on('SIGHUP', reload)

  const channel: RelayChannel = createRelayChannel({ relayOrigin: opts.relayOrigin })
  channel.onStatus((s) => { relayStatus = s; log('relay ' + s) })

  // The one cleartext wire: "someone opened my link". While a claim window is
  // open the first unknown phone becomes the owner. Otherwise: Open policy
  // welcomes an asker; Granted policy only a name on the grant list. An
  // unknown DID that is not welcome is left un-acked and forgotten.
  channel.onRawWire((fromDid, payload) => {
    const env = decodeFromQr(payload)
    if (!env || env.t !== 'connect-ack' || env.did !== fromDid) return false
    if (isOwner(env.did)) return true
    if (peerByDid(env.did)) return true
    if (claimOpen()) {
      state.owner = { did: env.did, displayName: env.from.displayName || 'Owner', boundAt: Date.now() }
      closeClaim()
      saveState(opts.stateDir, state)
      log('owner bound; claim window closed')
      return true
    }
    if (policy === PeerPolicy.Granted) {
      const key = grantKey(env.from.displayName)
      if (!grants.has(key)) {
        log('connect-ack refused (not granted)')
        return true
      }
      // One phone per granted name: a name is not a secret, so a second phone
      // sending it is refused while the first holds it (--remove frees it).
      if (state.peers.some((p) => grantKey(p.displayName) === key)) {
        log('connect-ack refused (name already bound)')
        return true
      }
    }
    if (state.peers.length >= maxPeers) state.peers.shift()
    state.peers.push({ id: env.from.id, displayName: env.from.displayName || 'Someone', did: env.did, ring: Ring.Acquaintance, connectedAt: Date.now() })
    saveState(opts.stateDir, state)
    log(`peer connected (${state.peers.length} now)`)
    return true
  })

  channel.onEnvelope(
    async (fromDid) => {
      const p = peerByDid(fromDid)
      return isOwner(fromDid) || (p && stillGranted(p)) ? pairKey(fromDid) : null
    },
    (env, fromDid) => { void handle(env, fromDid) },
  )

  async function handle(env: Envelope, fromDid: string): Promise<void> {
    if (env.t === 'answer') {
      // Only the owner's phone answers this peer, and only to a forwarded ask.
      if (isOwner(fromDid)) awaitingOwner.get(env.qid)?.(env)
      return
    }
    if (env.t === 'query') await handleQuery(env, fromDid)
  }

  /**
   * An ask is put in front of the owner when one is bound, forwarding is on,
   * it has text, it is not his own, and its asker did not restrict it to their
   * direct contacts (`direct: true`, wave 3: the front door answers from its
   * preset lines and never passes such an ask on).
   */
  const forwards = (self: boolean, q: QueryEnvelope): boolean =>
    forward && Boolean(state.owner) && !self && Boolean(q.freeText) && mayForwardToOwner(q)

  /**
   * The ask that goes to the owner's phone: as before for an ask that does not
   * travel ("Name: text", relayed), and for a travelling one the same step with
   * `door: true`, the asker's name in `via` and the asker and this door in `seen`
   * (hops.ts doorFields), so the owner's phone may pass it on per the asker's reach.
   */
  async function ownerAsk(q: QueryEnvelope, info: HopInfo, asker: Peer, text: string, templateId: string): Promise<QueryEnvelope> {
    const base: QueryEnvelope = { v: 1, t: 'query', from: state.me, templateId, templateVersion: 1, qid: randomId(12), issuedAt: Date.now(), freeText: forwardedText(asker.displayName, text), relayed: true }
    if (!info.travels || !info.root) return base
    const seen = [await seenHash(info.root, asker.id), await seenHash(info.root, state.me.id)]
    return { ...base, freeText: text.slice(0, FREE_TEXT_MAX_LEN), ...doorFields(q, info, seen, asker.displayName) }
  }

  /** Puts the ask in front of the owner, as the ask it is; resolves with what the owner's phone shared by `deadline`. */
  async function forwardToOwner(asked: QueryEnvelope, info: HopInfo, asker: Peer, text: string, templateId: string, deadline: number): Promise<{ outcome: OwnerOutcome; items: SharedItem[] }> {
    const owner = state.owner
    if (!forward || !owner || !text) return { outcome: OwnerOutcome.NotAsked, items: [] }
    const key = await pairKey(owner.did)
    const q = await ownerAsk(asked, info, asker, text, templateId)
    const answered = new Promise<AnswerEnvelope | null>((resolve) => {
      const timer = setTimeout(() => { awaitingOwner.delete(q.qid); resolve(null) }, Math.max(0, deadline - Date.now()))
      awaitingOwner.set(q.qid, (env) => { clearTimeout(timer); awaitingOwner.delete(q.qid); resolve(env) })
    })
    // Never awaited ahead of the deadline timer (wave 6): a relay POST that hangs must not hold the asker's answer past it.
    void (async () => {
      try {
        await channel.send(owner.did, q, key)
      } catch {
        awaitingOwner.get(q.qid)?.({ v: 1, t: 'answer', qid: q.qid, body: '' })
      }
    })()
    const env = await answered
    if (!env) return { outcome: OwnerOutcome.Timeout, items: [] }
    const decoded = await interpret(env, key)
    if (decoded.outcome !== 'shared' || !decoded.shared) return { outcome: OwnerOutcome.Nothing, items: [] }
    // Untrusted bytes even from the owner's phone: well-formed items only (their `via` kept: "through <owner>").
    const items = sanitizeHopItems(decoded.shared.items)
    return items.length ? { outcome: OwnerOutcome.Shared, items } : { outcome: OwnerOutcome.Nothing, items: [] }
  }

  async function handleQuery(q: QueryEnvelope, fromDid: string): Promise<void> {
    if (seenQids.has(q.qid)) return
    seenQids.add(q.qid)
    if (seenQids.size > 5000) seenQids.clear()
    const receivedAt = Date.now()
    // The owner asking his own front door is a self-test: preset lines only, never forwarded back to him.
    const self = isOwner(fromDid)
    const peer: Peer | undefined = self
      ? { id: 'owner', displayName: state.owner?.displayName ?? 'Owner', did: fromDid, ring: Ring.Acquaintance, connectedAt: state.owner?.boundAt ?? receivedAt }
      : peerByDid(fromDid)
    if (!peer || (!self && !stillGranted(peer))) return
    const key = await pairKey(peer.did)
    const text = q.freeText ?? ''
    const tpl = templateFor(text)
    const info = hopInfo(q)
    // The same ask by another path, or a cycle back to this door (hops.ts): answered like no match, same moment.
    const repeat = roots.repeat(info.root, receivedAt)
    const cycle = info.travels && info.root !== null && info.seen.includes(await seenHash(info.root, state.me.id))
    // Also silent: an ask that arrived further out than its asker allowed (hops.ts surfacesAt), as on a phone.
    const silent = repeat || cycle || !surfacesAt(q)
    // ONE answer instant per ask, fixed before anything is decided: while the
    // ask goes to the owner's phone, every answer the owner did not add to is
    // sent at the forward deadline, so a decline, no match, the phone off and
    // the rate limit cannot be told apart by WHEN they arrive (gate.ts I3,
    // RELAY_DEADLINE_MS). Only the owner's live share goes early: its content
    // says so anyway. A travelling ask adds one window per further step (hops.ts).
    // The moment follows what this door WOULD do with such an ask, never whether it is a repeat or a cycle,
    // so a silent answer arrives exactly when a forwarded one would (nothing tells the asker it came twice).
    const wouldForward = forwards(self, q)
    const passOn = !silent && wouldForward
    const settleMs = wouldForward ? doorAnswerDelayMs(info, answerWindowMs, forwardWaitMs) : answerDelayMs({ ...info, door: false }, answerWindowMs)
    const ownerDeadline = receivedAt + settleMs
    const answer = async (payload: SharedPayload | null, early = false): Promise<void> => {
      await settleAt(receivedAt, early ? answerWindowMs : settleMs)
      const out = await sealRelayAnswer(q.qid, tpl.id, payload, { key, blocked: false })
      try { await channel.send(peer.did, out, key) } catch { /* the asker times out and sees "no match" */ }
    }
    if (!limiter.allow(peer.did, receivedAt)) {
      log('ask ' + AskOutcome.RateLimited)
      await answer(null)
      return
    }

    // 2. Lines the owner allowed in advance, visibly marked as such.
    const { threads, refs } = askSources(asAppState(), peer.ring, info.hop)
    const match = text && !silent ? matchAsk(text, threads) : { hits: [], distinctAuthors: 0, aboveThreshold: false }
    const { surface } = classifyIncomingQuery(match, false, Boolean(text))
    const presets = presetById()
    const presetItems: SharedItem[] = surface
      ? match.hits
          .map((h) => refs.get(h.threadId))
          .filter((r): r is LineRef => Boolean(r))
          .map((r) => {
            const p = presets.get(r.threadId.replace(/^inv:/, ''))
            return { text: r.text, when: coarseWhen(r.at), context: p ? presetContext(p) : r.context }
          })
      : []

    // 2. The owner's friends who allowed their lines in advance (wave 6d): only for an ask that may go one step further than this
    // door, as their own phones would answer it. They never change the moment (settleMs is fixed above) nor set `early`.
    const friendItems = !silent && !self && text && mayCascade(q) ? friendAnswers(friends.friends, text, info.hop, state.me.displayName) : []

    // 3. The owner's live decision, in parallel with the answer window.
    const owner = passOn ? await forwardToOwner(q, info, peer, text, tpl.id, ownerDeadline) : { outcome: OwnerOutcome.NotAsked, items: [] as SharedItem[] }

    const items = mergeAnswerItems(owner.items, presetItems, friendItems)
    // Shape kept stable for apps/trustweb/test/e2e/demo_account.mjs ("ask shared"): outcome first, then the parts.
    log(`ask ${items.length ? AskOutcome.Shared : AskOutcome.NoMatch} (${items.length}): preset=${presetItems.length} owner=${owner.outcome}${owner.outcome === OwnerOutcome.Shared ? `(${owner.items.length})` : ''} friend=${friendItems.length}`)
    if (!items.length) {
      await answer(null)
      return
    }
    await answer({ from: state.me.displayName, templateId: tpl.id, items }, owner.outcome === OwnerOutcome.Shared)
  }

  try {
    await channel.connect(identity)
  } catch {
    /* relay.ts keeps reconnecting on its own */
  }
  const status = (): PeerStatus => ({
    relay: relayStatus,
    peers: state.peers.length,
    owner: Boolean(state.owner),
    forward: forward && Boolean(state.owner),
    claimOpen: claimOpen(),
    presetLines: inventory.preset.length,
    heldLines: inventory.held,
    friends: friends.friends.length,
    friendLines: friends.lines,
  })
  const health = opts.healthPort ? await healthServer(opts.healthPort, card, status) : null
  log(`${name}: up with ${inventory.preset.length} preset lines (${inventory.held} held, never shared), policy ${policy}, ${state.peers.length} peers, owner ${state.owner ? 'bound' : 'not bound'}, forward ${forward ? 'on' : 'off'}, ${friends.lines} friends' lines (${friends.friends.length} friends${friends.held ? `, ${friends.held} held` : ''})`)

  return {
    card,
    status,
    peerCount: () => state.peers.length,
    stop: async () => {
      process.off('SIGHUP', reload)
      for (const resolve of awaitingOwner.values()) resolve({ v: 1, t: 'answer', qid: '', body: '' })
      channel.close()
      if (health) await new Promise<void>((resolve) => health.close(() => resolve()))
    },
  }
}

function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`missing ${name}`)
  return v
}

function envFlag(name: string, fallback: boolean): boolean {
  const v = process.env[name]
  if (v === undefined) return fallback
  return v === '1' || v.toLowerCase() === 'true'
}

/** CLI entry: every setting from the environment (see the header and README.txt). */
export async function main(): Promise<void> {
  try {
    await run()
  } catch (e) {
    // Never the error's message: it can quote a line of the inventory file.
    console.error('trustweb-peer: could not start: ' + fileErrorForLog(e))
    process.exit(1)
  }
}

async function run(): Promise<void> {
  const policyRaw = process.env.TW_PEER_POLICY ?? PeerPolicy.Open
  const policy = (Object.values(PeerPolicy) as string[]).includes(policyRaw) ? (policyRaw as PeerPolicy) : PeerPolicy.Open
  const peer = await startPeer({
    stateDir: env('TW_PEER_STATE'),
    inventoryFile: env('TW_PEER_INVENTORY'),
    relayOrigin: env('TW_PEER_RELAY'),
    name: process.env.TW_PEER_NAME,
    policy,
    healthPort: Number(process.env.TW_PEER_HEALTH_PORT ?? 0),
    asksPerHour: process.env.TW_PEER_ASKS_PER_HOUR ? Number(process.env.TW_PEER_ASKS_PER_HOUR) : undefined,
    forward: envFlag('TW_PEER_FORWARD', true),
    forwardWaitMs: process.env.TW_PEER_FORWARD_WAIT_MS ? Number(process.env.TW_PEER_FORWARD_WAIT_MS) : undefined,
    claim: envFlag('TW_PEER_CLAIM', false),
    claimWindowMs: process.env.TW_PEER_CLAIM_MINUTES ? Number(process.env.TW_PEER_CLAIM_MINUTES) * 60_000 : undefined,
  })
  const bye = (): void => { void peer.stop().then(() => process.exit(0)) }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}

const entry = process.argv[1] ?? ''
if (/peer\.(ts|mjs|js)$/.test(entry)) void main()
