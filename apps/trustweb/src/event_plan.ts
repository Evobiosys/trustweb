// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-event (F03, P04): an event made inside a community. The documents it needs (description, date/place, sign-up sheet, roles,
 * resource list, follow-up note), the sign-up sheet and named roles, resource asks ("I bring it": open/covered) and the gate on the New Year
 * celebration. Pure and DOM-free; no runtime import, so the MCP server (apps/mcp) loads it as it is. Volunteers inside a community event chose
 * to be visible (I4); asks outside an event keep I2 (support_ask.ts).
 */
import type { SupportAsk } from './support_ask'
import type { TwEvent } from './model'

export const EVENT_TEMPLATE = ['description', 'dateplace', 'signup', 'roles', 'resources', 'followup'] as const
/** The two documents that are free text; the others are the event's own fields and lists. */
export const EVENT_DOCS = ['description', 'followup'] as const
export type EventDoc = (typeof EVENT_DOCS)[number]

/** The assistant's first message for "New event": one change card per document, approved one by one. */
export function templatePrompt(community: string): string {
  return [
    `Help me assemble a new event in the community "${community}". Ask me for the name, the date and the place first.`,
    'Then propose ONE change card per document, in this order, each as its own action:',
    '1. event-create (name, from, where) - the date and place;',
    '2. event-doc description - what the event is, in two or three sentences;',
    '3. the sign-up sheet exists with the event (members join with one tap), no card needed;',
    '4. the roles list: event-role for each named role (a slot a member can take);',
    '5. the resource list: event-resource for each resource the event needs (the loudspeaker, tables, a car);',
    '6. event-doc followup - a short follow-up note for after the event.',
  ].join('\n')
}

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/
const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export interface EventFields { name: string; from: string; to?: string; where?: string; community?: string }

/** A new empty event sheet; throws a plain message on a missing name or a date that is not YYYY-MM-DD. */
export function buildEvent(f: EventFields, id: string, now: number): TwEvent {
  const name = f.name.trim()
  if (!name) throw new Error('an event needs a name')
  if (!DATE.test(f.from.trim())) throw new Error('the date must be YYYY-MM-DD')
  const to = f.to?.trim()
  if (to && (!DATE.test(to) || to < f.from.trim())) throw new Error('the end date must be YYYY-MM-DD, not before the start')
  return {
    id, name, from: f.from.trim(), where: (f.where ?? '').trim(), createdAt: now, attended: true, signup: [], roles: [], resources: [],
    ...(to ? { to } : {}), ...(f.community ? { community: f.community } : {}),
  }
}

export function setDoc(ev: TwEvent, kind: string, text: string): void {
  if (!(EVENT_DOCS as readonly string[]).includes(kind)) throw new Error(`unknown document "${kind}": use ${EVENT_DOCS.join(' or ')}`)
  ev.docs = { ...ev.docs, [kind]: text.trim() }
}

/** One tap joins the sign-up sheet; true when this changed anything. */
export function signUp(ev: TwEvent, who: string): boolean {
  if (ev.signup?.includes(who)) return false
  ev.signup = [...(ev.signup ?? []), who]
  return true
}

export function leaveSignup(ev: TwEvent, who: string): boolean {
  if (!ev.signup?.includes(who)) return false
  ev.signup = ev.signup.filter((x) => x !== who)
  return true
}

/** A named slot; false when a role of that name exists. */
export function addRole(ev: TwEvent, name: string): boolean {
  const n = name.trim()
  if (!n) throw new Error('a role needs a name')
  if (ev.roles?.some((r) => same(r.name, n))) return false
  ev.roles = [...(ev.roles ?? []), { name: n }]
  return true
}

/** The slot goes to the first person who takes it; false when it is taken. */
export function takeRole(ev: TwEvent, name: string, who: string): boolean {
  const r = ev.roles?.find((x) => same(x.name, name))
  if (!r) throw new Error(`no role "${name}" in this event`)
  if (r.who) return false
  r.who = who
  return true
}

export function askResource(ev: TwEvent, text: string, id: string): NonNullable<TwEvent['resources']>[number] {
  const t = text.trim()
  if (!t) throw new Error('a resource needs a text')
  const r = { id, text: t }
  ev.resources = [...(ev.resources ?? []), r]
  return r
}

/** "I bring it": the first volunteer covers the resource and stays visible (I4); false when it is covered. */
export function coverResource(ev: TwEvent, id: string, who: string): boolean {
  const r = ev.resources?.find((x) => x.id === id)
  if (!r) throw new Error(`no resource "${id}" in this event`)
  if (r.by) return false
  r.by = who
  return true
}

export const resourceSummary = (ev: Pick<TwEvent, 'resources'>): { open: number; covered: number } => {
  const all = ev.resources ?? []
  const covered = all.filter((r) => r.by).length
  return { open: all.length - covered, covered }
}

interface Reach { id: string; ring: string; peerId?: string; fields?: Record<string, unknown>; deleted_at?: string }
const FRIENDS = ['closest', 'close', 'friend']

/** Peer ids of the community's members who are Friends or closer, and the Closest few; connected people only (same rule as the support ask). */
export function eventAudience(people: readonly Reach[], tag: string): string[] {
  return people
    .filter((p) => p.peerId && p.deleted_at === undefined && (p.ring === 'closest' || (FRIENDS.includes(p.ring) && String(p.fields?.[tag]) === 'true')))
    .map((p) => p.peerId as string)
}

const NOTE_MAX = 200
const DAY = 86_400_000

/** Delivery to the event's community: one queued support ask (support_flush.ts sends it); returns it. Throws when nobody is connected. */
export function queueResourceAsk(rec: { people: readonly Reach[]; supportAsks?: SupportAsk[] }, ev: TwEvent, res: { text: string }, now: number, id: string): SupportAsk {
  const to = ev.community ? eventAudience(rec.people, ev.community) : []
  if (!to.length) throw new Error('nobody to ask: no connected person in this community')
  const ask: SupportAsk = { id, chips: [], note: `${ev.name}: can you bring ${res.text}?`.slice(0, NOTE_MAX), until: now + 7 * DAY, to, here: [], queued: true }
  rec.supportAsks = [ask, ...(rec.supportAsks ?? [])]
  return ask
}

/** P04: the invitee list (identities); the celebration is on from then. Blanks and doubles are dropped. */
export function setInvitees(ev: TwEvent, dids: readonly string[]): void {
  ev.invitees = [...new Set(dids.map((d) => d.trim()).filter(Boolean))]
  ev.celebration = true
}

/** P04: the celebration shows only to the event's own device and to people on its invitee list; nobody else sees it, not even a hint. */
export function celebrationVisible(ev: Pick<TwEvent, 'celebration' | 'invitees' | 'fromLink'> | undefined, meDid: string | undefined): boolean {
  if (!ev?.celebration) return false
  if (!ev.fromLink) return true
  return !!meDid && !!ev.invitees?.includes(meDid)
}
