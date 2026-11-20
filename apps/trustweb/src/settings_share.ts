// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 settings-suggest: "Suggest these settings to <person>" and "Follow <name>'s settings", per settings group (privacy, feed,
 * notifications, events), over the record (Rec) so the app and the MCP tools (apps/mcp/src/settings_share_tools.ts) take the same steps.
 *   - suggest: the group's values go to one person as a sealed relay payload (`k: 'settings-share'`, notes_relay.ts postPayload, sealed for
 *     that person's key like the co-notes chat); the receiver sees the diff and taps Accept or Decline. Nothing is applied before Accept.
 *   - follow: who follows whom per group is a liquid delegation (packages/liquid-delegation; resolved to depth 1 now). Following sends a
 *     follow request; the followed person taps Allow (I9: nothing goes out unasked), then gets their group sent at once and again whenever it
 *     changes (dueFollowerUpdates). The follower takes an update directly when its per-follow "auto-apply" is on, else it waits in the inbox.
 * Everything leaves through `outbox` (the open app seals and posts it, then drops it), so a step taken over MCP goes out when the app is next open.
 * Values are only ever written through the settings registry (writeSetting): an id outside the group or a bad value is dropped, never applied.
 * Pure: no DOM, no clock, no ids of its own (passed in).
 */
import { cleanDelegations, delegate, delegateOf, followersOf, revoke, setAuto, type Delegation } from '../../../packages/liquid-delegation/src/index.ts'
import { readSetting, writeSetting, type Rec, type SettingValue } from './settings_registry.ts'
import { ZONES } from './audience_zones.ts'

export const SHARE_GROUPS = ['privacy', 'feed', 'notifications', 'events'] as const
export type ShareGroup = (typeof SHARE_GROUPS)[number]

/** The settings each group carries (registry ids). The system notification permission (general.notificationsOn) is device-bound, so it is not shared. */
export const GROUP_SETTINGS: Readonly<Record<ShareGroup, readonly string[]>> = {
  privacy: ['profile.discoverable', 'profile.openToConnect', 'general.profileAuto', 'trust.only', 'hosting.friends', 'web.askDirectOnly', 'general.qrProfileOption', 'inventory.notesMatch'],
  feed: ['feed.on', 'feed.remote', 'feed.images'],
  notifications: ['notices.on', 'notify.connect', 'notify.ask', 'notify.chat'],
  events: ['features.events', 'birthdays.reminders', 'events.alertCommunity'],
}

/** Me in the delegation book: "me -> ben on privacy" = I follow Ben's privacy settings; "ben -> me" = Ben follows mine. */
export const ME = 'me'
export const INBOX_MAX = 50
export const OUTBOX_MAX = 50
export const WIRE_KIND = 'settings-share'

export type Values = Record<string, SettingValue>
export type Wire =
  | { k: typeof WIRE_KIND; v: 1; id: string; t: 'suggest'; group: ShareGroup; values: Values; at: number; follow?: true }
  | { k: typeof WIRE_KIND; v: 1; id: string; t: 'follow'; group: ShareGroup; on: boolean; at: number }

/** Something that came in: a suggestion (an update from someone I follow carries `follow`) or a request to follow my group. */
export interface Incoming { id: string; t: 'suggest' | 'follow'; from: string; group: ShareGroup; values?: Values; at: number; follow?: true }
export interface Outgoing { id: string; to: string; msg: Wire }

export interface SettingsShare {
  inbox: Incoming[]
  book: Delegation[]
  /** Per group, the fingerprint of the values last sent to my followers. */
  sent: Partial<Record<ShareGroup, string>>
  outbox: Outgoing[]
  /** `<person>/<group>`: I asked to follow; no update has come yet. */
  waiting: string[]
}

export const isGroup = (g: unknown): g is ShareGroup => typeof g === 'string' && (SHARE_GROUPS as readonly string[]).includes(g)
const needGroup = (g: unknown): ShareGroup => { if (!isGroup(g)) throw new Error(`group must be one of ${SHARE_GROUPS.join(', ')}`); return g }
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function needPerson(r: Rec, id: unknown): string {
  const people = Array.isArray(r.people) ? (r.people as { id?: unknown; deleted_at?: unknown }[]) : []
  if (typeof id !== 'string' || !people.some((p) => p && p.id === id && p.deleted_at === undefined)) throw new Error(`no person "${String(id)}"`)
  return id
}

/** True when the registry takes `v` for `id` (checked on a scratch record, so nothing real is touched). */
function valid(id: string, v: unknown): v is SettingValue {
  try { writeSetting({}, id, v); return true } catch { return false }
}

/** The values of `group` that belong to it and are valid; everything else dropped. */
function cleanValues(group: ShareGroup, raw: unknown): Values {
  const o = obj(raw)
  const out: Values = {}
  for (const id of GROUP_SETTINGS[group]) if (Object.prototype.hasOwnProperty.call(o, id) && valid(id, o[id])) out[id] = o[id] as SettingValue
  return out
}

const fingerprint = (v: Values): string => JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]]))
const waitKey = (person: string, g: ShareGroup): string => `${person}/${g}`

/** The record's settings-share state, read safely (junk reads as empty). */
export function shareOf(r: Rec): SettingsShare {
  const s = obj(r.settingsShare)
  const inbox = (Array.isArray(s.inbox) ? s.inbox : []).flatMap((x): Incoming[] => {
    const i = obj(x)
    if (typeof i.id !== 'string' || typeof i.from !== 'string' || !isGroup(i.group) || (i.t !== 'suggest' && i.t !== 'follow') || typeof i.at !== 'number') return []
    return [{ id: i.id, t: i.t, from: i.from, group: i.group, at: i.at, ...(i.t === 'suggest' ? { values: cleanValues(i.group, i.values) } : {}), ...(i.follow === true ? { follow: true as const } : {}) }]
  })
  const outbox = (Array.isArray(s.outbox) ? s.outbox : []).flatMap((x): Outgoing[] => {
    const o = obj(x)
    const msg = parseWire(o.msg)
    return typeof o.id === 'string' && typeof o.to === 'string' && msg ? [{ id: o.id, to: o.to, msg }] : []
  })
  const sent: SettingsShare['sent'] = {}
  for (const g of SHARE_GROUPS) if (typeof obj(s.sent)[g] === 'string') sent[g] = obj(s.sent)[g] as string
  return { inbox, book: cleanDelegations(s.book), sent, outbox, waiting: Array.isArray(s.waiting) ? s.waiting.filter((w): w is string => typeof w === 'string') : [] }
}

const put = (r: Rec, s: SettingsShare): void => {
  r.settingsShare = { ...s, inbox: s.inbox.slice(-INBOX_MAX), outbox: s.outbox.slice(-OUTBOX_MAX) }
}

/** The group's current values. */
export const groupValues = (r: Rec, group: ShareGroup): Values => Object.fromEntries(GROUP_SETTINGS[group].map((id) => [id, readSetting(r, id)]))

/** What would change if `values` were applied: only ids of the group, only valid values, only real changes. */
export function diffOf(r: Rec, group: ShareGroup, values: unknown): { id: string; from: SettingValue; to: SettingValue }[] {
  return Object.entries(cleanValues(group, values)).flatMap(([id, to]) => { const from = readSetting(r, id); return from === to ? [] : [{ id, from, to }] })
}

/** Applies the valid, changed values of the group; the ids changed. */
export function applyValues(r: Rec, group: ShareGroup, values: unknown): string[] {
  const d = diffOf(r, group, values)
  for (const { id, to } of d) writeSetting(r, id, to)
  return d.map((x) => x.id)
}

/** A relay payload of this kind, cleaned; null for anything else (another payload kind stays for its own reader). */
export function parseWire(raw: unknown): Wire | null {
  const o = obj(raw)
  if (o.k !== WIRE_KIND || o.v !== 1 || typeof o.id !== 'string' || !o.id || !isGroup(o.group) || typeof o.at !== 'number' || !Number.isFinite(o.at)) return null
  const id = o.id.slice(0, 64)
  if (o.t === 'suggest') return { k: WIRE_KIND, v: 1, id, t: 'suggest', group: o.group, values: cleanValues(o.group, o.values), at: o.at, ...(o.follow === true ? { follow: true as const } : {}) }
  if (o.t === 'follow' && typeof o.on === 'boolean') return { k: WIRE_KIND, v: 1, id, t: 'follow', group: o.group, on: o.on, at: o.at }
  return null
}

const queue = (s: SettingsShare, to: string, msg: Wire): Outgoing => { const out = { id: msg.id, to, msg }; s.outbox.push(out); return out }
const suggestMsg = (r: Rec, group: ShareGroup, at: number, id: string, follow?: true): Wire => ({ k: WIRE_KIND, v: 1, id, t: 'suggest', group, values: groupValues(r, group), at, ...(follow ? { follow } : {}) })

/** Queues my `group` values for that person (Suggest these settings to <person>). */
export function suggest(r: Rec, person: string, group: ShareGroup, now: number, newId: () => string): Outgoing {
  const g = needGroup(group)
  const to = needPerson(r, person)
  const s = shareOf(r)
  const out = queue(s, to, suggestMsg(r, g, now, newId()))
  put(r, s)
  return out
}

/** I follow that person's `group` (replacing whom I followed there before, who is told I stopped); a follow request goes out. */
export function follow(r: Rec, person: string, group: ShareGroup, auto: boolean, now: number, newId: () => string): Outgoing {
  const g = needGroup(group)
  const to = needPerson(r, person)
  const s = shareOf(r)
  const prev = delegateOf(s.book, ME, g)
  if (prev && prev.to !== to) {
    queue(s, prev.to, { k: WIRE_KIND, v: 1, id: newId(), t: 'follow', group: g, on: false, at: now })
    s.waiting = s.waiting.filter((w) => w !== waitKey(prev.to, g))
  }
  s.book = delegate(s.book, { from: ME, to, topic: g, auto: auto === true, since: now })
  if (!s.waiting.includes(waitKey(to, g))) s.waiting.push(waitKey(to, g))
  const out = queue(s, to, { k: WIRE_KIND, v: 1, id: newId(), t: 'follow', group: g, on: true, at: now })
  put(r, s)
  return out
}

/** I stop following whoever I follow on `group`; they are told. Null when I follow nobody there. */
export function unfollow(r: Rec, group: ShareGroup, now = 0, newId: () => string = () => `u${now}`): Outgoing | null {
  const g = needGroup(group)
  const s = shareOf(r)
  const prev = delegateOf(s.book, ME, g)
  if (!prev) return null
  s.book = revoke(s.book, ME, g)
  s.waiting = s.waiting.filter((w) => w !== waitKey(prev.to, g))
  const out = queue(s, prev.to, { k: WIRE_KIND, v: 1, id: newId(), t: 'follow', group: g, on: false, at: now })
  put(r, s)
  return out
}

/** The auto-apply switch of my follow on `group`; false when I follow nobody there. */
export function setFollowAuto(r: Rec, group: ShareGroup, auto: boolean): boolean {
  const g = needGroup(group)
  const s = shareOf(r)
  if (!delegateOf(s.book, ME, g)) return false
  s.book = setAuto(s.book, ME, g, auto === true)
  put(r, s)
  return true
}

/**
 * A payload from a known person (the caller maps the relay sender to a person id and drops strangers).
 * 'applied' = an update from the person I follow on that group, auto-apply on; 'inbox' = waits for my tap; 'unfollowed'; 'ignored'.
 */
export function receive(r: Rec, from: string, msg: Wire | null, now: number): 'applied' | 'inbox' | 'unfollowed' | 'ignored' {
  if (!msg) return 'ignored'
  const s = shareOf(r)
  const g = msg.group
  const others = (t: Incoming['t']): Incoming[] => s.inbox.filter((i) => !(i.from === from && i.group === g && i.t === t))
  let outcome: ReturnType<typeof receive>
  if (msg.t === 'follow') {
    if (!msg.on) {
      s.book = s.book.filter((d) => !(d.from === from && d.to === ME && d.topic === g))
      s.inbox = others('follow')
      outcome = 'unfollowed'
    } else if (delegateOf(s.book, from, g)?.to === ME) {
      outcome = 'ignored'
    } else {
      s.inbox = [...others('follow'), { id: `${from}:${msg.id}`, t: 'follow', from, group: g, at: now }]
      outcome = 'inbox'
    }
  } else {
    const mine = delegateOf(s.book, ME, g)
    const followed = msg.follow === true && mine?.to === from
    if (followed) s.waiting = s.waiting.filter((w) => w !== waitKey(from, g))
    if (!diffOf(r, g, msg.values).length) {
      outcome = 'ignored'
    } else if (followed && mine?.auto) {
      s.inbox = others('suggest')
      put(r, s)
      applyValues(r, g, msg.values)
      return 'applied'
    } else {
      s.inbox = [...others('suggest'), { id: `${from}:${msg.id}`, t: 'suggest', from, group: g, values: msg.values, at: now, ...(followed ? { follow: true as const } : {}) }]
      outcome = 'inbox'
    }
  }
  put(r, s)
  return outcome
}

/** Accept (Allow) or Decline an inbox item. Accepting a suggestion applies it; allowing a follow records the follower and sends my group. */
export function answer(r: Rec, id: string, accept: boolean, now: number, newId: () => string): { applied: string[] } {
  const s = shareOf(r)
  const item = s.inbox.find((i) => i.id === id)
  if (!item) throw new Error(`no suggestion "${id}"`)
  s.inbox = s.inbox.filter((i) => i !== item)
  if (accept && item.t === 'follow') {
    s.book = delegate(s.book, { from: item.from, to: ME, topic: item.group, auto: false, since: now })
    s.sent[item.group] = fingerprint(groupValues(r, item.group))
    queue(s, item.from, suggestMsg(r, item.group, now, newId(), true))
  }
  put(r, s)
  return { applied: accept && item.t === 'suggest' ? applyValues(r, item.group, item.values) : [] }
}

/** For each group someone follows: when it changed since it was last sent, queue it for every follower. How many messages were queued. */
export function dueFollowerUpdates(r: Rec, now: number, newId: () => string): number {
  const s = shareOf(r)
  let n = 0
  for (const g of SHARE_GROUPS) {
    const followers = followersOf(s.book, ME, g)
    if (!followers.length) continue
    const fp = fingerprint(groupValues(r, g))
    if (s.sent[g] === fp) continue
    s.sent[g] = fp
    for (const f of followers) { queue(s, f.from, suggestMsg(r, g, now, newId(), true)); n++ }
  }
  if (n) put(r, s)
  return n
}

/** Inbox items waiting for my tap. */
export const pendingCount = (r: Rec): number => shareOf(r).inbox.length
/** What is waiting to go out, oldest first. */
export const takeOutgoing = (r: Rec): Outgoing[] => shareOf(r).outbox
/** Drops a sent item from the outbox. */
export function dropOutgoing(r: Rec, id: string): void {
  const s = shareOf(r)
  s.outbox = s.outbox.filter((o) => o.id !== id)
  put(r, s)
}
/** Whom I follow per group (with auto-apply and whether their first update is still awaited), and who follows me. */
export function follows(r: Rec): { group: ShareGroup; person: string; auto: boolean; waiting: boolean }[] {
  const s = shareOf(r)
  return SHARE_GROUPS.flatMap((g) => { const d = delegateOf(s.book, ME, g); return d ? [{ group: g, person: d.to, auto: d.auto, waiting: s.waiting.includes(waitKey(d.to, g)) }] : [] })
}
export const followers = (r: Rec): { group: ShareGroup; person: string }[] => SHARE_GROUPS.flatMap((g) => followersOf(shareOf(r).book, ME, g).map((d) => ({ group: g, person: d.from })))

/** Whom I can suggest to or follow: `direct` = my own connections, the trust zones (closest, close, friend; audience_zones.ts ZONES) first;
 *  `fof` = people I see through a friend (Person.via) whose key I hold. Only people the sealed relay reaches (a DID), never deleted, archived or nameless. */
export type Reach = 'direct' | 'fof'
type Pickable = { id: string; ring?: unknown; via?: string; deleted_at?: unknown; anonymous?: boolean }
export function reachable<P extends Pickable>(people: readonly P[], reach: Reach, didOf: (id: string) => string | undefined): P[] {
  const rank = (p: P): number => { const i = (ZONES as readonly unknown[]).indexOf(p.ring); return i < 0 ? ZONES.length : i }
  return people
    .filter((p) => p.deleted_at === undefined && !p.anonymous && p.ring !== 'none' && (reach === 'fof') === Boolean(p.via) && Boolean(didOf(p.id)))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
    .map(({ p }) => p)
}
