// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 group-chat-list (Jakob 2026-11-19): a group = a chat with members, independent of events, plus its lists (shopping and errands,
 * "Besorgungen"; several lists, one active). This file is the pure store: shapes, bounds, sanitize, the own-device merge, and the
 * last-writer-wins rules a list or an item op follows. The engine that sends and receives ops is group_chat.ts.
 *   members  `mem`: key -> {name, on, at}; key = 'me', a person id on this device, or 'n:<lower name>' for a member I only know by name.
 *   chat     `items`: msg | join | leave | check (the quiet line a checked list item posts); deduped by id, ordered by the author's time.
 *   lists    `lists` {id, name, u}, `active` {id, u}, `li` the items {id, l, text, o (order), u, by (who added), done?, arc? (archived)}:
 *            a list / item op wins when its time is newer than what is held (equal or older: no change, so a flood stops).
 * No runtime imports: apps/mcp loads this under plain node (group_tools.ts group_create).
 */
import type { AppState } from './model'

/** Same values as apps/demo types.ts GROUP_NAME_MAX / GROUP_ITEM_TEXT_MAX (the wire bounds). */
export const GROUP_NAME_MAX = 60
export const GROUP_ITEM_TEXT_MAX = 200
/** Chat items kept per group (the oldest go first). */
export const GROUP_KEEP = 300
/** Groups kept (the quietest go first). */
export const GROUP_MAX = 50
export const GROUP_LISTS_MAX = 20
/** List items kept per group (archived ones go first, the oldest first). */
export const GROUP_LIST_ITEMS_MAX = 300
export const GROUP_MEMBERS_MAX = 100
/** The invite tag of a group: an invite link (invite_policy.ts) whose tag starts with this lets in to just this group. */
export const GROUP_TAG_PREFIX = 'grp:'
const MSG_MAX = 2000
const NAME_MAX = 40
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
// eslint-disable-next-line no-control-regex
const HIDDEN_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g

export type GKind = 'msg' | 'join' | 'leave' | 'check'
export interface GItem { m: string; k: GKind; by: string; ts: number; at: number; text?: string; mine?: true; state?: 'pending' | 'sent' }
/** wave46 answers-45b (review-45 Q7): `adm` = the member key who admitted this member on my device ('me' = I did; a person id = the one whose
 *  join told me of them); absent = nobody (myself, my inviter, older data): then only they themselves change their membership. */
export interface GMember { name: string; on: boolean; at: number; adm?: string }
export interface GList { id: string; name: string; u: number }
export interface LItem { id: string; l: string; text: string; o: number; u: number; by: string; done?: { by: string; at: number }; arc?: true }
export interface ChatGroup {
  id: string
  name: string
  at: number
  items: GItem[]
  unread: number
  mem: Record<string, GMember>
  lists: GList[]
  li: LItem[]
  active?: { id: string; u: number }
  /** A list change of mine reached nobody: sent again on retry. */
  dirty?: true
}
export type ChatGroups = Record<string, ChatGroup>
/** A list or item op as it travels (apps/demo types.ts GroupOp list / it). */
export interface ListOp { id: string; name: string; act?: true }
export interface ItemOp { id: string; l: string; text: string; o: number; done?: { by: string; at: number }; arc?: true }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const idOk = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v)

/** One line of text fit to keep: hidden characters out, spaces tidied; null when empty or longer than `max`. */
export function cleanLine(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(HIDDEN_RE, '').replace(/\s+/g, ' ').trim()
  return t && t.length <= max ? t : null
}
/** A message: like cleanLine, line breaks kept (at most one empty line). */
export function cleanMsg(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.replace(/\r\n?/g, '\n').replace(HIDDEN_RE, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return t && t.length <= MSG_MAX ? t : null
}
export const cleanName = (raw: unknown): string => cleanLine(raw, 400)?.slice(0, NAME_MAX).trim() ?? ''

export const groupTag = (gid: string): string => GROUP_TAG_PREFIX + gid
export function groupOfTag(tag: string): string | null {
  if (!tag.startsWith(GROUP_TAG_PREFIX)) return null
  const id = tag.slice(GROUP_TAG_PREFIX.length)
  return ID_RE.test(id) ? id : null
}

const byOrder = (a: GItem, b: GItem): number => a.ts - b.ts || (a.m < b.m ? -1 : a.m > b.m ? 1 : 0)

function sanitizeItem(v: unknown): GItem | null {
  if (!isObj(v)) return null
  const k = v.k === 'msg' || v.k === 'join' || v.k === 'leave' || v.k === 'check' ? v.k : null
  const by = cleanName(v.by)
  if (!k || !idOk(v.m) || !by || !num(v.ts) || !num(v.at)) return null
  const text = k === 'msg' ? cleanMsg(v.text) : k === 'check' ? cleanLine(v.text, GROUP_ITEM_TEXT_MAX) : null
  if ((k === 'msg' || k === 'check') && !text) return null
  const mine = v.mine === true
  const state = mine && (v.state === 'pending' || v.state === 'sent') ? v.state : undefined
  return { m: v.m, k, by, ts: v.ts, at: v.at, ...(text ? { text } : {}), ...(mine ? { mine: true as const } : {}), ...(state ? { state } : {}) }
}
function sanitizeLItem(v: unknown): LItem | null {
  if (!isObj(v) || !idOk(v.id) || !idOk(v.l) || !fin(v.o) || !num(v.u)) return null
  const text = cleanLine(v.text, GROUP_ITEM_TEXT_MAX)
  if (!text) return null
  const d = isObj(v.done) && cleanName(v.done.by) && num(v.done.at) ? { by: cleanName(v.done.by), at: v.done.at } : undefined
  return { id: v.id, l: v.l, text, o: v.o, u: v.u, by: cleanName(v.by) || '?', ...(d ? { done: d } : {}), ...(v.arc === true ? { arc: true as const } : {}) }
}
/** Bounded list items: archived ones go first (the oldest change first), then the oldest. */
function boundLi(li: LItem[]): LItem[] {
  if (li.length <= GROUP_LIST_ITEMS_MAX) return li
  const drop = new Set([...li].sort((a, b) => Number(!a.arc) - Number(!b.arc) || a.u - b.u).slice(0, li.length - GROUP_LIST_ITEMS_MAX).map((i) => i.id))
  return li.filter((i) => !drop.has(i.id))
}

function sanitizeGroup(id: string, v: unknown): ChatGroup | null {
  if (!isObj(v) || !ID_RE.test(id)) return null
  const name = cleanLine(v.name, GROUP_NAME_MAX)
  if (!name || !num(v.at) || !Array.isArray(v.items) || !Array.isArray(v.lists) || !Array.isArray(v.li) || !isObj(v.mem)) return null
  const seen = new Set<string>()
  const items = v.items.map(sanitizeItem).filter((i): i is GItem => i !== null && !seen.has(i.m) && !!seen.add(i.m)).sort(byOrder).slice(-GROUP_KEEP)
  const mem = Object.fromEntries(Object.entries(v.mem).filter(([key, x]) => key.length <= 120 && isObj(x) && typeof x.on === 'boolean' && num(x.at))
    .slice(0, GROUP_MEMBERS_MAX).map(([key, x]) => { const adm = (x as GMember).adm; return [key, { name: key === 'me' ? '' : cleanName((x as GMember).name), on: (x as GMember).on, at: (x as GMember).at, ...(typeof adm === 'string' && adm && adm.length <= 120 ? { adm } : {}) }] }))
  const ls = new Set<string>()
  const lists = v.lists.filter((l): l is GList => isObj(l) && idOk(l.id) && !!cleanLine(l.name, GROUP_NAME_MAX) && num(l.u) && !ls.has(l.id) && !!ls.add(l.id))
    .slice(0, GROUP_LISTS_MAX).map((l) => ({ id: l.id, name: cleanLine(l.name, GROUP_NAME_MAX) as string, u: l.u }))
  const lis = new Set<string>()
  const li = boundLi(v.li.map(sanitizeLItem).filter((i): i is LItem => i !== null && ls.has(i.l) && !lis.has(i.id) && !!lis.add(i.id)))
  const active = isObj(v.active) && idOk(v.active.id) && num(v.active.u) ? { id: v.active.id, u: v.active.u } : undefined
  return { id, name, at: v.at, items, unread: num(v.unread) ? Math.min(Math.floor(v.unread), GROUP_KEEP) : 0, mem, lists, li, ...(active ? { active } : {}), ...(v.dirty === true ? { dirty: true as const } : {}) }
}

const lastAt = (g: ChatGroup): number => Math.max(g.at, g.items[g.items.length - 1]?.at ?? 0)
function bounded(c: ChatGroups): ChatGroups {
  const ids = Object.keys(c)
  if (ids.length <= GROUP_MAX) return c
  return Object.fromEntries(ids.sort((a, b) => lastAt(c[b]) - lastAt(c[a])).slice(0, GROUP_MAX).map((id) => [id, c[id]]))
}

/** A stored or synced value: what is valid, bounded; never throws. */
export function sanitizeGroups(raw: unknown): ChatGroups {
  if (!isObj(raw)) return {}
  const out: ChatGroups = {}
  for (const [id, g] of Object.entries(raw)) {
    const clean = sanitizeGroup(id, g)
    if (clean) out[id] = clean
  }
  return bounded(out)
}

/** A new group: me as member, one list (active). Null on an empty name or a bad id. */
export function newGroup(o: { id: string; name: string; now: number; listId: string; listName: string }): ChatGroup | null {
  const name = cleanLine(o.name, GROUP_NAME_MAX)
  const listName = cleanLine(o.listName, GROUP_NAME_MAX)
  if (!name || !listName || !ID_RE.test(o.id) || !ID_RE.test(o.listId)) return null
  return { id: o.id, name, at: o.now, items: [], unread: 0, mem: { me: { name: '', on: true, at: o.now } }, lists: [{ id: o.listId, name: listName, u: o.now }], li: [], active: { id: o.listId, u: o.now } }
}

/** The active list: the one marked, else the first. */
export function activeListId(g: ChatGroup): string | undefined {
  return g.lists.find((l) => l.id === g.active?.id)?.id ?? g.lists[0]?.id
}
/** The open items of a list, in order. */
export const liveItems = (g: ChatGroup, listId: string): LItem[] => g.li.filter((i) => i.l === listId && !i.arc).sort((a, b) => a.o - b.o || (a.id < b.id ? -1 : 1))
export const archivedOf = (g: ChatGroup, listId: string): LItem[] => g.li.filter((i) => i.l === listId && i.arc).sort((a, b) => b.u - a.u)
/** The members who did not leave, by name; me first, as my name. */
export function memberNames(g: ChatGroup, myName: string): string[] {
  return [...(g.mem.me?.on !== false ? [myName] : []), ...Object.entries(g.mem).filter(([key, m]) => key !== 'me' && m.on && m.name).map(([, m]) => m.name)]
}
export const lastLine = (g: ChatGroup): GItem | undefined => g.items[g.items.length - 1]

/** A member's state changed (joined: on, left: off), with the time of the change. */
export function setMember(g: ChatGroup, key: string, name: string, on: boolean, at: number, adm?: string): ChatGroup {
  const by = adm ?? g.mem[key]?.adm   // wave46 answers-45b: the admitter stays with the member
  const mem = { ...g.mem, [key]: { name: key === 'me' ? '' : cleanName(name), on, at, ...(by ? { adm: by } : {}) } }
  return { ...g, mem: Object.keys(mem).length > GROUP_MEMBERS_MAX ? g.mem : mem }
}

export function addChatItem(g: ChatGroup, item: GItem): { g: ChatGroup; changed: boolean } {
  if (g.items.some((i) => i.m === item.m)) return { g, changed: false }
  const items = [...g.items, item].sort(byOrder).slice(-GROUP_KEEP)
  return { g: { ...g, items, unread: Math.min(GROUP_KEEP, g.unread + (item.k === 'msg' && !item.mine ? 1 : 0)) }, changed: true }
}

/** A list op at time `ts`: creates or renames when newer; `act` makes it the active list when newer than the active mark. */
export function applyList(g: ChatGroup, op: ListOp, ts: number): { g: ChatGroup; changed: boolean } {
  const name = cleanLine(op.name, GROUP_NAME_MAX)
  if (!name || !ID_RE.test(op.id) || !num(ts)) return { g, changed: false }
  const have = g.lists.find((l) => l.id === op.id)
  let out = g
  let changed = false
  if (!have) {
    if (g.lists.length >= GROUP_LISTS_MAX) return { g, changed: false }
    out = { ...out, lists: [...out.lists, { id: op.id, name, u: ts }] }
    changed = true
  } else if (ts > have.u && have.name !== name) {
    out = { ...out, lists: out.lists.map((l) => (l.id === op.id ? { ...l, name, u: ts } : l)) }
    changed = true
  }
  if (op.act && ts > (out.active?.u ?? -1) && out.active?.id !== op.id) {
    out = { ...out, active: { id: op.id, u: ts } }
    changed = true
  }
  return { g: out, changed }
}

/** An item op at time `ts` by `by`: a new item (added by `by`) or a newer snapshot of one held (the adder stays). */
export function applyItem(g: ChatGroup, op: ItemOp, ts: number, by: string): { g: ChatGroup; changed: boolean } {
  const text = cleanLine(op.text, GROUP_ITEM_TEXT_MAX)
  if (!text || !ID_RE.test(op.id) || !fin(op.o) || !num(ts) || !g.lists.some((l) => l.id === op.l)) return { g, changed: false }
  const have = g.li.find((i) => i.id === op.id)
  if (have && ts <= have.u) return { g, changed: false }
  const done = op.done && cleanName(op.done.by) && num(op.done.at) ? { by: cleanName(op.done.by), at: op.done.at } : undefined
  const item: LItem = { id: op.id, l: op.l, text, o: op.o, u: ts, by: have?.by ?? (cleanName(by) || '?'), ...(done ? { done } : {}), ...(op.arc ? { arc: true as const } : {}) }
  return { g: { ...g, li: boundLi(have ? g.li.map((i) => (i.id === op.id ? item : i)) : [...g.li, item]) }, changed: true }
}
/** The op that carries an item as it is now. */
export const itemOp = (i: LItem): ItemOp => ({ id: i.id, l: i.l, text: i.text, o: i.o, ...(i.done ? { done: i.done } : {}), ...(i.arc ? { arc: true as const } : {}) })

/** Own-device merge (sync_core SETTING_MERGERS 'chatGroups'): chat items united (a sent copy beats a pending one), lists and items by the newer time, members by the newer change. */
export function mergeGroups(mine: unknown, theirs: unknown): ChatGroups {
  const a = sanitizeGroups(mine)
  const b = sanitizeGroups(theirs)
  const out: ChatGroups = { ...a }
  for (const [id, t] of Object.entries(b)) {
    const m = a[id]
    if (!m) { out[id] = t; continue }
    const byId = new Map(m.items.map((i) => [i.m, i]))
    for (const i of t.items) { const have = byId.get(i.m); if (!have || (have.state === 'pending' && i.state === 'sent')) byId.set(i.m, i) }
    const mem = { ...m.mem }
    for (const [key, x] of Object.entries(t.mem)) if (!mem[key] || x.at > mem[key].at) mem[key] = x
    const lists = new Map(m.lists.map((l) => [l.id, l]))
    for (const l of t.lists) if (!lists.has(l.id) || l.u > (lists.get(l.id) as GList).u) lists.set(l.id, l)
    const li = new Map(m.li.map((i) => [i.id, i]))
    for (const i of t.li) if (!li.has(i.id) || i.u > (li.get(i.id) as LItem).u) li.set(i.id, i)
    const active = (t.active?.u ?? -1) > (m.active?.u ?? -1) ? t.active : m.active
    out[id] = {
      ...m, items: [...byId.values()].sort(byOrder).slice(-GROUP_KEEP), unread: Math.max(m.unread, t.unread), mem,
      lists: [...lists.values()].slice(0, GROUP_LISTS_MAX), li: boundLi([...li.values()]), ...(active ? { active } : {}),
    }
  }
  return bounded(out)
}

/** The groups of a record (sanitized). */
export const groupsOf = (s: Pick<AppState, 'chatGroups'>): ChatGroups => sanitizeGroups(s.chatGroups)
