/**
 * How far an ask travels (TrustWeb wave 6, Jakob 2026-10-08: "someone sets how
 * many degrees something is available, default is just 1 ... they can extend it
 * to 2, 3, custom or infinite"). The rules every phone and every front door
 * (services/trustweb-peer) apply to the optional hop fields of an ask
 * (apps/demo/src/types.ts QueryEnvelope, between the wave-6 markers). Pure and
 * DOM-free, so the unit tests, net.ts and the peer import the same functions.
 *
 * Counting, pinned once (the handover's "forward when hop < maxHops" read
 * with hop 0 at the asker would let a direct contact pass on a one-step ask):
 *   - `hop` on an envelope = how often it was passed on before it arrived.
 *     The asker sends hop 0; its direct contact B receives hop 0.
 *   - A receiver at hop h may pass the ask on only if h + 1 < maxHops.
 *     maxHops 1: B never passes on. maxHops 2: B passes on, C (hop 1) does not.
 *   - An item with `degrees` d answers an ask at hop h only if h <= d
 *     (cascade.ts): 0 = my direct contacts only, 1 = friends of friends.
 *   - A front door forwarding to its own owner's phone does not count a hop
 *     (`door: true`): the front door IS that person's inventory.
 *
 * Timing (gate.ts I3: WHEN an answer comes must say nothing): a phone answers
 * at receivedAt + answerDelayMs, a fixed function of the envelope alone, never
 * of whether it passed the ask on, whom it asked or what came back. Every step
 * left below a phone adds one answer window, so the answers of the next step
 * are always in before the phone's own moment. Only a person who takes longer
 * than that to decide is answered the moment they decide (as before).
 */
import { HOP_CAP, HOPS_UNBOUNDED, ROOT_RE, SEEN_ID_RE, SEEN_MAX, VIA_NAME_MAX } from '../../demo/src/types'
import type { QueryEnvelope, SharedItem } from '../../demo/src/types'
import type { AppState } from './model'
import { stripUnsafe } from './safe_text'

export { HOP_CAP, HOPS_UNBOUNDED }

/** The default reach of an ask: my direct contacts (Jakob: "default is just 1"). */
export const HOPS_DEFAULT = 1
/** The most people one phone passes a single ask on to (per step), closest rings first. */
export const MAX_FANOUT = 24
/** Base of every ask's timeout before wave 6 (net.ts ASK_TIMEOUT_MS): covers a front door's wait for its owner. */
export const BASE_ASK_TIMEOUT_MS = 180_000
/** The longest line a passed-on answer item may carry back (the peer's INVENTORY_LINE_MAX). */
const ITEM_TEXT_MAX = 300
const ITEM_META_MAX = 160
/** How many items a passed-on answer may hold (the answer block holds three at most anyway). */
const HOP_ITEMS_MAX = 6

/** The hop fields of one ask, read with every default applied. */
export interface HopInfo {
  /** The envelope carries hop fields at all (a wave-6 ask that may travel); false = an ask exactly as before. */
  travels: boolean
  /** The asker's reach, effective: 1..HOP_CAP ("no limit" reads HOP_CAP). */
  maxHops: number
  hop: number
  /** Steps left counting this receiver: 1 = it is the last one that may answer. */
  levelsLeft: number
  root: string | null
  seen: readonly string[]
  via: readonly string[]
  /** Forwarded by a front door to its owner's phone (the same person). */
  door: boolean
}

/** The asker's reach as stored or sent, made effective: absent or malformed = 1, "no limit" = HOP_CAP. */
export function effectiveMaxHops(maxHops: number | undefined): number {
  if (maxHops === HOPS_UNBOUNDED) return HOP_CAP
  if (typeof maxHops !== 'number' || !Number.isInteger(maxHops) || maxHops < 1) return HOPS_DEFAULT
  return Math.min(maxHops, HOP_CAP)
}

/** Is this a value the reach chooser may store (1..HOP_CAP or "no limit")? */
export function isReach(v: unknown): v is number {
  return v === HOPS_UNBOUNDED || (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= HOP_CAP)
}

/** Reads the hop fields of an incoming ask. `direct: true` clamps the reach to 1 whatever else it says. */
export function hopInfo(q: Pick<QueryEnvelope, 'maxHops' | 'hop' | 'root' | 'seen' | 'via' | 'door' | 'direct'>): HopInfo {
  const travels = q.maxHops !== undefined && effectiveMaxHops(q.maxHops) > 1 && q.direct !== true
  const maxHops = travels ? effectiveMaxHops(q.maxHops) : HOPS_DEFAULT
  const hop = travels && typeof q.hop === 'number' ? q.hop : 0
  return {
    travels,
    maxHops,
    hop,
    levelsLeft: Math.max(0, maxHops - hop),
    root: travels && q.root && ROOT_RE.test(q.root) ? q.root : null,
    seen: travels ? (q.seen ?? []).filter((x) => SEEN_ID_RE.test(x)) : [],
    via: travels ? readVia(q.via) : [],
    door: q.door === true,
  }
}

/**
 * Is this ask put in front of the person at all? Not when a phone passed it on
 * although its asker wanted direct contacts only (relayed + direct, wave 3),
 * and not when it arrives further than its asker allowed (hop >= maxHops): both
 * are answered like no match, at the same moment, never shown.
 */
export function surfacesAt(q: Pick<QueryEnvelope, 'relayed' | 'direct' | 'maxHops' | 'hop' | 'door' | 'root' | 'seen' | 'via'>): boolean {
  if (q.relayed === true && q.direct === true) return false
  const info = hopInfo(q)
  return !info.travels || info.hop < info.maxHops
}

/** May a PHONE that received this ask pass it on to its own contacts (the next step)? */
export function mayCascade(q: Pick<QueryEnvelope, 'relayed' | 'direct' | 'maxHops' | 'hop' | 'door' | 'root' | 'seen' | 'via'>): boolean {
  const info = hopInfo(q)
  return info.travels && info.root !== null && surfacesAt(q) && info.hop + 1 < info.maxHops
}

/**
 * May a FRONT DOOR forward this ask to its owner's phone? Never a direct ask
 * (wave 3). An ask as before (no hop fields) goes to the owner as it always
 * did; a travelling one too, as long as it is within its reach (the owner's
 * phone then passes it on per mayCascade).
 */
export function mayForwardToOwner(q: Pick<QueryEnvelope, 'relayed' | 'direct' | 'maxHops' | 'hop' | 'door' | 'root' | 'seen' | 'via'>): boolean {
  return q.direct !== true && surfacesAt(q)
}

/** The share of an answer window a front door's owner keeps free, so his answer is back at the door before the door's own moment. */
export function doorSlackMs(windowMs: number): number {
  return Math.floor(windowMs / 4)
}

/**
 * How long after an ask arrived a PHONE answers it: one window per step left
 * (an ask as before: one window, unchanged). An ask a front door forwarded to
 * its owner keeps a slack free for the way back to the door.
 */
export function answerDelayMs(info: HopInfo, windowMs: number): number {
  if (!info.travels) return windowMs
  const steps = Math.max(1, info.levelsLeft)
  return windowMs * steps - (info.door ? doorSlackMs(windowMs) : 0)
}

/**
 * How long after an ask arrived a FRONT DOOR answers it while forwarding to
 * its owner. At hop 0 (asked straight at the door): its usual wait for the
 * owner (forwardWaitMs, at least one window) plus one window per further step.
 * Further out (hop >= 1) the asker's budget is the same as any phone's, so it
 * is exactly a phone's delay: the owner's phone answers a slack earlier.
 */
export function doorAnswerDelayMs(info: HopInfo, windowMs: number, forwardWaitMs: number): number {
  if (!info.travels) return Math.max(windowMs, forwardWaitMs)
  const steps = Math.max(1, info.levelsLeft)
  if (info.hop === 0) return Math.max(windowMs, forwardWaitMs) + windowMs * (steps - 1)
  return windowMs * steps
}

/** How long the asker waits for answers to arrive, roughly (the dock's countdown). */
export function askWaitMs(maxHops: number | undefined, windowMs: number): number {
  return windowMs * effectiveMaxHops(maxHops)
}

/** When the asker gives up on one person's answer: the old timeout plus one window per further step. */
export function askTimeoutMs(maxHops: number | undefined, windowMs: number): number {
  return BASE_ASK_TIMEOUT_MS + windowMs * (effectiveMaxHops(maxHops) - 1)
}

/** One `seen` entry: SHA-256 of root and a phone's id, 16 hex characters. Salted per ask, so it cannot be followed across asks. */
export async function seenHash(root: string, id: string): Promise<string> {
  const bytes = new TextEncoder().encode(`tw-seen|${root}|${id}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The fields the ASKER puts on its ask: none for one step (the ask of the build before), else reach, hop 0, root and itself in `seen`. */
export function askFields(maxHops: number, root: string, selfSeen: string): Pick<QueryEnvelope, 'maxHops' | 'hop' | 'root' | 'seen'> {
  if (effectiveMaxHops(maxHops) <= HOPS_DEFAULT) return {}
  return { maxHops, hop: 0, root, seen: [selfSeen] }
}

function uniq(xs: readonly string[]): string[] {
  return [...new Set(xs)]
}

function cappedNames(xs: readonly string[]): string[] {
  return xs.map(clipName).filter(Boolean).slice(-HOP_CAP)
}

/** A name from the wire, as shown on a consent prompt or an answer: no bidi overrides or control characters (safe_text.ts), trimmed, clipped. */
function clipName(s: string): string {
  return stripUnsafe(s).trim().slice(0, VIA_NAME_MAX)
}

/**
 * The hop fields of the ask a PHONE passes on: one step further, the same
 * reach and root, itself and its sender added to `seen`, the sender's name
 * added to `via` (not for an ask its own front door handed it: the door and
 * this phone are one person, who is `from` on the next step anyway).
 * `relayed: true` keeps its meaning for an older build (it never passes such
 * an ask on). Never `direct`, never `door`.
 */
export function cascadeFields(q: Pick<QueryEnvelope, 'maxHops'>, info: HopInfo, seen: readonly string[], senderName: string): Pick<QueryEnvelope, 'relayed' | 'maxHops' | 'hop' | 'root' | 'seen' | 'via'> {
  return {
    relayed: true,
    maxHops: q.maxHops,
    hop: info.hop + 1,
    root: info.root ?? undefined,
    seen: uniq([...info.seen, ...seen]).slice(0, SEEN_MAX),
    via: cappedNames(info.door ? [...info.via] : [...info.via, senderName]),
  }
}

/**
 * The hop fields of the ask a FRONT DOOR forwards to its owner: the same step
 * (the door and the owner are one person), `door: true`, the asker's name in
 * `via` (so the owner sees who asks without the old "Name: text" prefix) and
 * the asker and the door in `seen`. Nothing for an ask as before: the door
 * then forwards it exactly as it always did.
 */
export function doorFields(q: Pick<QueryEnvelope, 'maxHops'>, info: HopInfo, seen: readonly string[], askerName: string): Pick<QueryEnvelope, 'door' | 'maxHops' | 'hop' | 'root' | 'seen' | 'via'> {
  if (!info.travels || !info.root) return {}
  return {
    door: true,
    maxHops: q.maxHops,
    hop: info.hop,
    root: info.root,
    seen: uniq([...info.seen, ...seen]).slice(0, SEEN_MAX),
    via: cappedNames([...info.via, askerName]),
  }
}

/** Who asks, as the receiver shows it: the first name in `via` for a passed-on ask, else the sender. */
export function askerOf(info: HopInfo, senderName: string): string {
  return info.via[0] ?? senderName
}

/** The people an ask came through to reach this phone, after its asker (the sender last), for "Ann asks, through Ben". */
export function throughOf(info: HopInfo, senderName: string): string[] {
  if (!info.via.length) return []
  return [...info.via.slice(1), senderName]
}

/** An untrusted `via` (wire or answer): a list of non-empty names, clipped, at most HOP_CAP; anything else = []. */
export function readVia(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string').map(clipName).filter(Boolean).slice(0, HOP_CAP)
}

function clip(v: unknown, max: number): string {
  return typeof v === 'string' ? stripUnsafe(v).slice(0, max) : ''
}

/** Items that came back from the next step (untrusted, decrypted): well-formed ones only, bounded. */
export function sanitizeHopItems(items: unknown): SharedItem[] {
  if (!Array.isArray(items)) return []
  const out: SharedItem[] = []
  for (const it of items) {
    if (typeof it !== 'object' || it === null) continue
    const o = it as Record<string, unknown>
    const text = clip(o.text, ITEM_TEXT_MAX).trim()
    if (!text) continue
    const via = readVia(o.via)
    out.push({ text, when: clip(o.when, ITEM_META_MAX), context: clip(o.context, ITEM_META_MAX), ...(via.length ? { via } : {}) })
    if (out.length >= HOP_ITEMS_MAX) break
  }
  return out
}

/** Marks items that came back through this phone: its own name goes first in their `via` ("through <me>"). */
export function markThrough(items: readonly SharedItem[], myName: string): SharedItem[] {
  const name = clipName(myName)
  return items.map((it) => ({ ...it, via: [name, ...readVia(it.via)].filter(Boolean).slice(0, HOP_CAP) }))
}

/** Same line from two paths (a diamond in the web): kept once. */
export function dedupeItems(items: readonly SharedItem[]): SharedItem[] {
  const seen = new Set<string>()
  return items.filter((it) => {
    const k = it.text.trim().toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** The roots a phone already answered: a second arrival of the same ask (another path) is answered like no match. Bounded. */
export class RootMemory {
  private readonly roots = new Map<string, number>()
  constructor(private readonly max = 2000) {}
  /** True when this root was seen before (and remembers it either way). */
  repeat(root: string | null, now: number): boolean {
    if (!root) return false
    if (this.roots.has(root)) return true
    this.roots.set(root, now)
    if (this.roots.size > this.max) {
      const oldest = this.roots.keys().next().value
      if (oldest !== undefined) this.roots.delete(oldest)
    }
    return false
  }
}

/** The reach this phone's asks go out with: "Ask only my direct contacts" wins, then the dock's "How far?", else 1. */
export function askReachOf(s: Pick<AppState, 'askReach' | 'askDirectOnly'>): number {
  if (s.askDirectOnly === true) return HOPS_DEFAULT
  return isReach(s.askReach) ? s.askReach : HOPS_DEFAULT
}

/** The "How far?" chooser in the ask dock, in order (Jakob: "default is just 1 ... they can extend it to 2, 3, custom or infinite"). */
export enum ReachChoice {
  Contacts = 'contacts',
  FriendsOfFriends = 'fof',
  Three = 'three',
  Custom = 'custom',
  NoLimit = 'no-limit',
}

export const REACH_CHOICES: readonly ReachChoice[] = [
  ReachChoice.Contacts, ReachChoice.FriendsOfFriends, ReachChoice.Three, ReachChoice.Custom, ReachChoice.NoLimit,
]

/** The chooser position of a stored reach. */
export function reachChoice(maxHops: number): ReachChoice {
  if (maxHops === HOPS_UNBOUNDED) return ReachChoice.NoLimit
  if (maxHops <= 1) return ReachChoice.Contacts
  if (maxHops === 2) return ReachChoice.FriendsOfFriends
  if (maxHops === 3) return ReachChoice.Three
  return ReachChoice.Custom
}

/** The reach a chooser position stands for; Custom keeps `custom`, clamped to 1..HOP_CAP. */
export function reachFor(choice: ReachChoice, custom: number): number {
  switch (choice) {
    case ReachChoice.Contacts: return 1
    case ReachChoice.FriendsOfFriends: return 2
    case ReachChoice.Three: return 3
    case ReachChoice.NoLimit: return HOPS_UNBOUNDED
    case ReachChoice.Custom: return Math.min(HOP_CAP, Math.max(1, Math.round(Number.isFinite(custom) ? custom : 1)))
  }
}
