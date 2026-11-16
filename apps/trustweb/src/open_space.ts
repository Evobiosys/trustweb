// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-open-space: an "online open space" event. The host sets a day and a time window (the event's own from..to on one day);
 * participants PROPOSE activities (title, slot, short description) into one shared schedule and tap "I join" per activity. Pure, no DOM, type-only
 * imports, so the MCP server loads it under plain node.
 * Joining stores a token, not a name (tokenOf: a hash of event and name, the same on every device), with the time of the last change
 * (positive = joined, negative = left; the later change wins a merge, so leaving survives); names show only for people the attendee list may
 * show (event_visibility.ts), everyone else is counted. Nothing but the schedule leaves the phone (event_envelope.ts, sealed per peer).
 */
import type { OsActivity, TwEvent } from './model.ts'

export const OS_MAX_ACTS = 60
const TITLE_MAX = 80
const DESC_MAX = 200
const JOINED_MAX = 200
const SLOT = /^([01]\d|2[0-3]):[0-5]\d$/
const SAFE = /^[\w-]{1,24}$/

/** The day and the time window of an open space: the event's from..to; no end, or an end on another day, lasts until 23:59. */
export function windowOf(ev: Pick<TwEvent, 'from' | 'to'>): { day: string; start: string; end: string } {
  const day = ev.from.slice(0, 10)
  const start = ev.from.length > 10 ? ev.from.slice(11, 16) : '00:00'
  const end = ev.to && ev.to.length > 10 && ev.to.slice(0, 10) === day ? ev.to.slice(11, 16) : '23:59'
  return { day, start, end }
}

/** 53-bit cyrb53 hash in base 36 of event id and normalised name: what a join stores in place of the name. */
export function tokenOf(eventId: string, name: string): string {
  const s = `${eventId}|${name.trim().toLowerCase()}`
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677) }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `t${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`
}

export const sortedActivities = (ev: Pick<TwEvent, 'openSpace'>): OsActivity[] =>
  [...(ev.openSpace?.acts ?? [])].sort((a, b) => a.slot.localeCompare(b.slot) || a.title.localeCompare(b.title))

const inWindow = (ev: Pick<TwEvent, 'from' | 'to'>, slot: string): boolean => { const w = windowOf(ev); return slot >= w.start && slot <= w.end }

/** A proposal as the activity it makes, or null when it breaks a rule (the same rules for my proposal and for one that arrives). */
function clean(ev: Pick<TwEvent, 'from' | 'to'>, raw: unknown): OsActivity | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const id = typeof r.id === 'string' && SAFE.test(r.id) ? r.id : ''
  const title = text(r.title, TITLE_MAX)
  const slot = typeof r.slot === 'string' ? r.slot : ''
  const by = text(r.by, 60)
  if (!id || !title || !SLOT.test(slot) || !inWindow(ev, slot) || !by) return null
  const description = text(r.description, DESC_MAX)
  const joins: Record<string, number> = {}
  if (typeof r.joins === 'object' && r.joins !== null) {
    for (const [t, at] of Object.entries(r.joins).slice(0, JOINED_MAX)) if (SAFE.test(t) && typeof at === 'number' && Number.isFinite(at) && at !== 0) joins[t] = at
  }
  return { id, title, slot, by, joins, ...(description ? { description } : {}) }
}

/** My proposal: the proposer joins it. Throws a plain message on a missing title, a slot that is no HH:MM or lies outside the window, or a full schedule. */
export function proposeActivity(ev: TwEvent, p: { title: string; slot: string; description?: string }, by: string, id: string, now: number): OsActivity {
  if (!ev.openSpace) throw new Error('this event is no open space')
  const title = p.title.trim()
  if (!title || title.length > TITLE_MAX) throw new Error(`the title needs 1 to ${TITLE_MAX} characters`)
  if (!SLOT.test(p.slot)) throw new Error('the slot must be HH:MM')
  if (!inWindow(ev, p.slot)) { const w = windowOf(ev); throw new Error(`the slot must lie inside the window ${w.start}-${w.end}`) }
  if (ev.openSpace.acts.length >= OS_MAX_ACTS) throw new Error(`the schedule holds at most ${OS_MAX_ACTS} activities`)
  const act = clean(ev, { id, title, slot: p.slot, by, description: p.description, joins: { [tokenOf(ev.id, by)]: now } })
  if (!act) throw new Error('the activity is not valid')
  ev.openSpace.acts.push(act)
  return act
}

const actOf = (ev: TwEvent, id: string): OsActivity => {
  const a = ev.openSpace?.acts.find((x) => x.id === id)
  if (!a) throw new Error(`no activity "${id}" in this event`)
  return a
}

/** The tokens that have joined an activity. */
export const joinedOf = (a: Pick<OsActivity, 'joins'>): string[] => Object.entries(a.joins).filter(([, at]) => at > 0).map(([t]) => t)

/** "I join" (positive time) or "I leave" (negative time): true when this changed anything. */
function setJoin(ev: TwEvent, id: string, token: string, on: boolean, now: number): boolean {
  const a = actOf(ev, id)
  if ((a.joins[token] ?? 0) > 0 === on) return false
  a.joins[token] = on ? now : -now
  return true
}
export const joinActivity = (ev: TwEvent, id: string, token: string, now: number): boolean => setJoin(ev, id, token, true, now)
export const leaveActivity = (ev: TwEvent, id: string, token: string, now: number): boolean => setJoin(ev, id, token, false, now)

/** What another device sent: new valid activities are added, joins are united; an activity I hold keeps its own title, slot and proposer. True when anything changed. */
export function mergeActivities(ev: TwEvent, incoming: unknown): boolean {
  if (!ev.openSpace || !Array.isArray(incoming)) return false
  let changed = false
  for (const raw of incoming) {
    const a = clean(ev, raw)
    if (!a) continue
    const mine = ev.openSpace.acts.find((x) => x.id === a.id)
    if (!mine) {
      if (ev.openSpace.acts.length >= OS_MAX_ACTS) continue
      ev.openSpace.acts.push(a); changed = true
      continue
    }
    for (const [t, at] of Object.entries(a.joins)) {
      if (Math.abs(at) > Math.abs(mine.joins[t] ?? 0) && (mine.joins[t] !== undefined || Object.keys(mine.joins).length < JOINED_MAX)) { mine.joins[t] = at; changed = true }
    }
  }
  return changed
}
