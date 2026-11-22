// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-group-chat (Jakob 2026-11-19, replaces D2 of answers-44d, the fan-out of "Message everyone" into each person's own chat):
 * every event has ONE shared thread. Members = the hosts + the people joining. No server holds it:
 *   - an item (a message, or a join / leave notice) travels as a sealed `event` envelope with `gc` (apps/demo wire.ts parseGroupChat), pair key
 *     per connected member, over the existing relay (net.ts sendEvent), like every other event envelope;
 *   - guests are usually connected to the host only, so a HOST's device passes every new item on to the other members it is connected to
 *     (never back to the sender, never to someone who left); ids dedupe, so co-hosts forwarding to each other never loop;
 *   - from a host, the author name travels as given (the host vouches); from anyone else, the author is that sender as my device knows them;
 *   - the host's device announces a join (an accepted invitation `joined`, a yes rsvp) and a leave (a no rsvp, the member's own Leave), and sends
 *     a new member the last EVENT_CHAT_HISTORY messages;
 *   - my other devices get the threads through the sync bundle as the setting `eventChats`, merged item by item (SETTING_MERGERS below).
 * Membership on my device: `mem` per thread ('me' or a person id -> on/off with the time of the change). Pure store functions plus one engine
 * whose transport the app hands in (main.ts), so the rules test without a relay.
 */
import type { EventEnvelope } from '../../demo/src/types'
import { EVENT_CHAT_TEXT_MAX } from '../../demo/src/types'
import type { AppState, Person, TwEvent } from './model'
import { attendees } from './events'
import { everyoneAt, hostedBy } from './event_community'
import { isEventHost } from './event_roles'
import { namedHost } from './event_conference'
import { cleanHelloName } from './hello'
import { stripUnsafe } from './safe_text'
import { SETTING_MERGERS } from './sync_core'

export { EVENT_CHAT_TEXT_MAX }
/** Items kept per event (the oldest go first). */
export const EVENT_CHAT_KEEP = 300
/** Threads kept (the quietest go first). */
export const EVENT_CHAT_MAX_THREADS = 100
/** A new member gets this many of the latest messages from the host's device. */
export const EVENT_CHAT_HISTORY = 20
/** A sender's clock may lie this far ahead before it is clamped. */
const SKEW_MS = 5 * 60_000
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const NAME_MAX = 40

export type GcKind = 'msg' | 'join' | 'leave'
export interface GcItem {
  m: string
  k: GcKind
  by: string
  /** The author's time (clamped): the one order on every device. */
  ts: number
  /** When it reached this device. */
  at: number
  text?: string
  /** Mine: `pending` until one member's device took it. */
  mine?: true
  state?: 'pending' | 'sent'
}
export interface EventThread { items: GcItem[]; unread: number; mem?: Record<string, { on: boolean; at: number }> }
export type EventChats = Record<string, EventThread>

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const order = (a: GcItem, b: GcItem): number => a.ts - b.ts || (a.m < b.m ? -1 : a.m > b.m ? 1 : 0)
const live = (p: Person): boolean => p.deleted_at === undefined && !p.via
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Text fit to send and keep: no hidden characters, tidy line breaks; null when empty or too long. */
export function cleanGcText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = stripUnsafe(raw).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t && t.length <= EVENT_CHAT_TEXT_MAX ? t : null
}
const cleanName = (raw: unknown): string => cleanHelloName(String(raw ?? '')).slice(0, NAME_MAX)

function sanitizeItem(v: unknown): GcItem | null {
  if (!isObj(v)) return null
  const k = v.k === 'msg' || v.k === 'join' || v.k === 'leave' ? v.k : null
  const by = cleanName(v.by)
  if (!k || typeof v.m !== 'string' || !ID_RE.test(v.m) || !by || !num(v.ts) || !num(v.at)) return null
  const text = k === 'msg' ? cleanGcText(v.text) : null
  if (k === 'msg' && !text) return null
  const mine = v.mine === true
  const state = mine && (v.state === 'pending' || v.state === 'sent') ? v.state : undefined
  return { m: v.m, k, by, ts: v.ts, at: v.at, ...(text ? { text } : {}), ...(mine ? { mine: true as const } : {}), ...(state ? { state } : {}) }
}

function sanitizeThread(v: unknown): EventThread | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null
  const seen = new Set<string>()
  const items = v.items.map(sanitizeItem).filter((i): i is GcItem => i !== null && !seen.has(i.m) && !!seen.add(i.m)).sort(order).slice(-EVENT_CHAT_KEEP)
  const mem = isObj(v.mem) ? Object.fromEntries(Object.entries(v.mem).filter(([key, x]) => key.length <= 120 && isObj(x) && typeof x.on === 'boolean' && num(x.at)).map(([key, x]) => [key, { on: (x as { on: boolean }).on, at: (x as { at: number }).at }])) : {}
  if (!items.length && !Object.keys(mem).length) return null
  return { items, unread: num(v.unread) ? Math.min(Math.floor(v.unread), EVENT_CHAT_KEEP) : 0, ...(Object.keys(mem).length ? { mem } : {}) }
}

const lastAt = (t: EventThread): number => t.items[t.items.length - 1]?.at ?? 0
function bounded(c: EventChats): EventChats {
  const ids = Object.keys(c)
  if (ids.length <= EVENT_CHAT_MAX_THREADS) return c
  return Object.fromEntries(ids.sort((a, b) => lastAt(c[b]) - lastAt(c[a])).slice(0, EVENT_CHAT_MAX_THREADS).map((id) => [id, c[id]]))
}

/** A stored or synced value: what is valid, bounded; never throws. */
export function sanitizeEventChats(raw: unknown): EventChats {
  if (!isObj(raw)) return {}
  const out: EventChats = {}
  for (const [id, t] of Object.entries(raw)) {
    const clean = ID_RE.test(id) ? sanitizeThread(t) : null
    if (clean) out[id] = clean
  }
  return bounded(out)
}

/** Own-device merge (sync_core mergeSettings): items united by id (a sent copy beats a pending one), unread the larger, membership by the newer change. */
export function mergeEventChats(mine: unknown, theirs: unknown): EventChats {
  const a = sanitizeEventChats(mine)
  const b = sanitizeEventChats(theirs)
  const out: EventChats = { ...a }
  for (const [id, t] of Object.entries(b)) {
    const m = a[id]
    if (!m) { out[id] = t; continue }
    const byId = new Map(m.items.map((i) => [i.m, i]))
    for (const i of t.items) { const have = byId.get(i.m); if (!have || (have.state === 'pending' && i.state === 'sent')) byId.set(i.m, i) }
    const mem = { ...m.mem }
    for (const [key, x] of Object.entries(t.mem ?? {})) if (!mem[key] || x.at > mem[key].at) mem[key] = x
    out[id] = { items: [...byId.values()].sort(order).slice(-EVENT_CHAT_KEEP), unread: Math.max(m.unread, t.unread), ...(Object.keys(mem).length ? { mem } : {}) }
  }
  return bounded(out)
}
SETTING_MERGERS.set('eventChats', mergeEventChats)

/** review-45 (merge-events): the gone event's thread joins the kept event's (items by id, membership by the newer change, unread added); the gone key goes. */
export function moveEventThread(s: Pick<AppState, 'eventChats'>, goneId: string, keepId: string): void {
  const all = sanitizeEventChats(s.eventChats)
  const gone = all[goneId]
  if (!gone || goneId === keepId) return
  const keep = all[keepId]
  const joined = keep ? mergeEventChats({ x: keep }, { x: gone }).x : gone
  const { [goneId]: _gone, ...rest } = all
  s.eventChats = bounded({ ...rest, [keepId]: { ...joined, unread: Math.min(EVENT_CHAT_KEEP, (keep?.unread ?? 0) + gone.unread) } })
}

type Rec = Pick<AppState, 'people' | 'me'> & Partial<Pick<AppState, 'events' | 'extData' | 'uiRings' | 'eventChats' | 'eventMerged'>>

/** The thread of one event (empty when none yet). */
export function threadOf(s: Pick<AppState, 'eventChats'>, id: string): EventThread {
  return sanitizeEventChats(s.eventChats)[id] ?? { items: [], unread: 0 }
}
function putThread(s: Pick<AppState, 'eventChats'>, id: string, t: EventThread): void {
  s.eventChats = bounded({ ...sanitizeEventChats(s.eventChats), [id]: t })
}
const isLeft = (t: EventThread, key: string): boolean => t.mem?.[key]?.on === false
const withMem = (t: EventThread, key: string, on: boolean, at: number): EventThread => ({ ...t, mem: { ...t.mem, [key]: { on, at } } })
function withItem(t: EventThread, item: GcItem): EventThread {
  return { ...t, items: [...t.items, item].sort(order).slice(-EVENT_CHAT_KEEP), unread: Math.min(EVENT_CHAT_KEEP, t.unread + (item.k === 'msg' && !item.mine ? 1 : 0)) }
}

/** Unread messages of one event's chat (`id`, the badge on its Event chat button), or of all event chats. */
export function eventChatUnread(s: Pick<AppState, 'eventChats'>, id?: string): number {
  return id === undefined ? Object.values(sanitizeEventChats(s.eventChats)).reduce((n, t) => n + t.unread, 0) : threadOf(s, id).unread
}

const iHost = (s: Rec, ev: TwEvent): boolean => isEventHost(ev, s.me.displayName, s.people)
/** I take part: I host it or I attend it. */
const iTakePart = (s: Rec, ev: TwEvent): boolean => iHost(s, ev) || ev.attended

/** The people on my device at this event (hosts by name, the people joining, the people tagged with it), connected or not, left or not. */
function atEvent(s: Rec, ev: TwEvent): Person[] {
  const out = new Map<string, Person>()
  for (const p of [...everyoneAt(s, ev), ...attendees(s as AppState, ev.id)]) if (live(p)) out.set(p.id, p)
  return [...out.values()]
}
/** The members the chat goes to from my device: connected, not left. */
const reachable = (s: Rec, ev: TwEvent): Person[] => { const t = threadOf(s, ev.id); return atEvent(s, ev).filter((p) => p.peerId && !isLeft(t, p.id)) }

/** The members by name as my device knows them: the hosts, then the people at the event who did not leave, then me. */
export function memberNames(s: Rec, ev: TwEvent): string[] {
  const t = threadOf(s, ev.id)
  const hosts = hostedBy(ev)
  const key = (n: string): string => n.trim().toLowerCase()
  const names = [...hosts]
  for (const p of atEvent(s, ev)) if (!isLeft(t, p.id) && !names.some((n) => key(n) === key(p.name))) names.push(p.name)
  const me = s.me.displayName
  if (me && !isLeft(t, 'me') && !names.some((n) => key(n) === key(me))) names.push(me)
  return names
}

export interface GroupChatHost<P extends { id: string }> {
  state(): AppState
  save(): void
  now(): number
  newId(): string
  peers(): P[]
  send(peer: P, env: EventEnvelope): Promise<void>
  /** The thread of this event changed: redraw what shows it. */
  changed(eventId: string): void
}

export function createEventGroupChat<P extends { id: string }>(h: GroupChatHost<P>) {
  const held = (id: string): TwEvent | undefined => h.state().events?.find((e) => e.id === id)
  /** review-45: an item for a merged event's old id lands on the kept event (AppState.eventMerged, as event_merge.ts resolveEvent). */
  const resolved = (id: string): string => { let x = id; for (let n = 0; n < 16 && !held(x) && h.state().eventMerged?.[x]; n++) x = h.state().eventMerged?.[x] as string; return x }
  const myName = (): string => cleanName(h.state().me.displayName) || 'TrustWeb'
  const personOf = (peerId: string): Person | undefined => h.state().people.find((p) => p.peerId === peerId && live(p))
  const env = (id: string, i: GcItem): EventEnvelope => ({ v: 1, t: 'event', gc: { id, m: i.m, k: i.k, by: i.by, ts: i.ts, ...(i.text ? { text: i.text } : {}) } })
  const store = (id: string, t: EventThread): void => { putThread(h.state(), id, t); h.save(); h.changed(id) }

  async function sendTo(peerIds: readonly string[], e: EventEnvelope): Promise<number> {
    let n = 0
    for (const id of peerIds) {
      const peer = h.peers().find((x) => x.id === id)
      if (peer) await h.send(peer, e).then(() => { n++ }, () => undefined)
    }
    return n
  }
  const broadcast = (ev: TwEvent, i: GcItem, except: readonly string[]): Promise<number> =>
    sendTo(reachable(h.state(), ev).map((p) => p.peerId as string).filter((id) => !except.includes(id)), env(ev.id, i))

  const markSent = (id: string, m: string): void => {
    const t = threadOf(h.state(), id)
    store(id, { ...t, items: t.items.map((i) => (i.m === m ? { ...i, state: 'sent' as const } : i)) })
  }

  /** The host: someone joined or left; announced to the members, a joiner also gets the latest messages. False when not a host or nothing changed. */
  async function announce(eventId: string, personId: string, k: 'join' | 'leave'): Promise<boolean> {
    const s = h.state()
    const ev = held(eventId)
    const who = s.people.find((p) => p.id === personId && live(p))
    if (!ev || !who || !iHost(s, ev)) return false
    if (!atEvent(s, ev).some((p) => p.id === who.id)) return false // review-45: a yes from someone not at the event never opens the chat
    const t = threadOf(s, ev.id)
    if (t.mem?.[who.id]?.on === (k === 'join')) return false
    const now = h.now()
    const item: GcItem = { m: h.newId(), k, by: cleanName(who.name) || 'TrustWeb', ts: now, at: now }
    store(ev.id, withItem(withMem(t, who.id, k === 'join', now), item))
    await broadcast(ev, item, [])
    if (k === 'join' && who.peerId) for (const old of t.items.filter((i) => i.k === 'msg').slice(-EVENT_CHAT_HISTORY)) await sendTo([who.peerId], env(ev.id, old))
    return true
  }

  return {
    announce,
    /** My message into the event's thread; null when not taking part, left, or the text is empty / too long. */
    async send(eventId: string, raw: string): Promise<GcItem | null> {
      const s = h.state()
      const ev = held(eventId)
      const text = cleanGcText(raw)
      if (!ev || !text || !iTakePart(s, ev) || isLeft(threadOf(s, ev.id), 'me')) return null
      const now = h.now()
      const item: GcItem = { m: h.newId(), k: 'msg', by: myName(), ts: now, at: now, text, mine: true, state: 'pending' }
      store(ev.id, withItem(threadOf(s, ev.id), item))
      if ((await broadcast(ev, item, [])) > 0) markSent(ev.id, item.m)
      return threadOf(h.state(), ev.id).items.find((i) => i.m === item.m) ?? null
    },
    /** My messages still pending go out again; how many went. */
    async retry(eventId: string): Promise<number> {
      const ev = held(eventId)
      if (!ev) return 0
      let n = 0
      for (const i of threadOf(h.state(), ev.id).items.filter((x) => x.mine && x.state === 'pending')) if ((await broadcast(ev, i, [])) > 0) { markSent(ev.id, i.m); n++ }
      return n
    },
    /** I leave the chat (`leaving`) or come back; the others are told. False when I do not take part. */
    async leave(eventId: string, leaving: boolean): Promise<boolean> {
      const s = h.state()
      const ev = held(eventId)
      if (!ev || !iTakePart(s, ev)) return false
      const now = h.now()
      const item: GcItem = { m: h.newId(), k: leaving ? 'leave' : 'join', by: myName(), ts: now, at: now, mine: true, state: 'pending' }
      store(ev.id, withItem(withMem(threadOf(s, ev.id), 'me', !leaving, now), item))
      if ((await broadcast(ev, item, [])) > 0) markSent(ev.id, item.m)
      return true
    },
    /** A sealed gc item from a connected peer. True when it was new and kept (a host then passes it on). */
    async onEnvelope(peer: { id: string }, gc: NonNullable<EventEnvelope['gc']>): Promise<boolean> {
      const s = h.state()
      const ev = held(resolved(gc.id))
      const who = personOf(peer.id)
      if (!ev || !who || !iTakePart(s, ev)) return false
      const t = threadOf(s, ev.id)
      if (isLeft(t, 'me') || t.items.some((i) => i.m === gc.m)) return false
      const fromHost = namedHost(ev, who.name, s.people)
      if (!fromHost && (!atEvent(s, ev).some((p) => p.id === who.id) || (isLeft(t, who.id) && gc.k !== 'join'))) return false
      const text = gc.k === 'msg' ? cleanGcText(gc.text) : null
      if (gc.k === 'msg' && !text) return false
      const now = h.now()
      const item: GcItem = { m: gc.m, k: gc.k, by: (fromHost && cleanName(gc.by)) || cleanName(who.name) || 'TrustWeb', ts: Math.min(gc.ts, now + SKEW_MS), at: now, ...(text ? { text } : {}) }
      // review-45: a join / leave the host passes on names its subject by name; my device marks that person (never me: 'me' is my own Leave)
      const subject = gc.k === 'msg' ? undefined : fromHost ? atEvent(s, ev).find((p) => sameName(p.name, item.by)) : who
      store(ev.id, withItem(subject ? withMem(t, subject.id, gc.k === 'join', now) : t, item))
      if (iHost(s, ev)) await broadcast(ev, item, [peer.id])
      return true
    },
    /** After an event envelope was handled (event_envelope.ts): an accepted invitation or a yes is a join, a no is a leave (the host announces). */
    async afterEnvelope(peer: { id: string }, e: EventEnvelope, outcome: string): Promise<void> {
      const who = personOf(peer.id)
      if (!who) return
      if (e.joined && outcome === 'filled') await announce(e.joined.id, who.id, 'join')
      else if (e.rsvp) await announce(e.rsvp.id, who.id, e.rsvp.yes ? 'join' : 'leave')
    },
    markRead(eventId: string): void {
      const t = threadOf(h.state(), eventId)
      if (t.unread) { putThread(h.state(), eventId, { ...t, unread: 0 }); h.save() }
    },
  }
}
export type EventGroupChat = ReturnType<typeof createEventGroupChat>
