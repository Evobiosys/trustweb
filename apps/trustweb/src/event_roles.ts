// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 event-roles: who organizes, hosts and sets up an event, and the logic behind "Identify a person". Pure and DOM-free
 * (the MCP tools use it too). A role entry is a person id, or a free name when no person card carries it.
 */
import type { AppState, Person, Ring, TwEvent } from './model'

// Type imports only: the MCP server loads this file under plain node, which resolves no extensionless runtime imports.

/** The ring a person made from an event page lands in ('unsorted' = Ring.Unsorted). One place to change it (Acquaintance, say). */
export const NEW_FROM_EVENT_RING = 'unsorted' as Ring

export interface Roles { organizers?: string[]; hosts?: string[]; techSupport?: string[] }
export type RoleKey = keyof Roles
export const ROLE_KEYS: readonly RoleKey[] = ['organizers', 'hosts', 'techSupport']

const clean = (list: readonly string[] | undefined): string[] => [...new Set((list ?? []).map((t) => t.trim()).filter(Boolean))]
const alive = (people: readonly Person[]): Person[] => people.filter((p) => p.deleted_at === undefined)

/** The legacy `organizer` text (also what an event link carries: "A, B") as names; comma-separated, like the edit form. */
const legacyOrganizers = (text: string | undefined): string[] => clean(text?.split(','))

/** Wave 43: `organizer` (one text) became `organizers`. Reads organizers, else the legacy text split on commas. */
export function eventOrganizers(ev: Pick<TwEvent, 'organizers' | 'organizer'>): string[] {
  return ev.organizers ?? legacyOrganizers(ev.organizer)
}

/** Once: a legacy `organizer` text becomes organizers (one per comma-separated name). The text stays (older callers and links read it). True when something changed. */
export function migrateEventRoles(s: Pick<AppState, 'events'>): boolean {
  let changed = false
  for (const ev of s.events ?? []) {
    if (ev.organizers === undefined && ev.organizer?.trim()) { ev.organizers = legacyOrganizers(ev.organizer); changed = true }
  }
  return changed
}

/** Person ids show as the person's name, free names as typed. */
export function roleLabels(s: Pick<AppState, 'people'>, refs: readonly string[]): string[] {
  return refs.map((r) => s.people.find((p) => p.id === r)?.name ?? r)
}

/** The edit form shows names; typed names go back to the person id they came from, else stay free names. */
export function refsForNames(s: Pick<AppState, 'people'>, names: readonly string[], current: readonly string[] = []): string[] {
  const label = (r: string): string => roleLabels(s, [r])[0]
  return names.map((n) => n.trim()).filter(Boolean).map((n) => current.find((r) => label(r) === n) ?? n)
}

/** "Anna, Ben": the collapsed Organized-by line; empty when nobody is named. */
export function rolesSummary(s: Pick<AppState, 'people'>, ev: Pick<TwEvent, 'organizers' | 'organizer'>): string {
  return roleLabels(s, eventOrganizers(ev)).join(', ')
}

/** Sets the lists given (empty = none, left out); keeps the legacy `organizer` text in step with the organizers' names. */
export function setRoles(s: Pick<AppState, 'people'>, ev: TwEvent, roles: Roles): void {
  for (const k of ROLE_KEYS) {
    if (roles[k] === undefined) continue
    const list = clean(roles[k])
    if (list.length) ev[k] = list; else delete ev[k]
  }
  if (roles.organizers === undefined) return
  const text = ev.organizers ? roleLabels(s, ev.organizers).join(', ') : ''
  if (text) ev.organizer = text; else delete ev.organizer
}

/** What an event link may carry: roles as names, never person ids; no tech support (it is my own setup help). */
export function eventForLink(s: Pick<AppState, 'people'>, ev: TwEvent): TwEvent {
  const { organizers: _o, techSupport: _t, organizer: _l, hosts: _h, ...rest } = ev
  const organizers = roleLabels(s, eventOrganizers(ev))
  const hosts = roleLabels(s, ev.hosts ?? [])
  return { ...rest, ...(organizers.length ? { organizer: organizers.join(', ') } : {}), ...(hosts.length ? { hosts } : {}) }
}

/** People tied to the event only through roles or invitations, not tagged; stable order. */
export function relatedOthers(s: Pick<AppState, 'people'>, ev: TwEvent): Person[] {
  const refs = new Set([...eventOrganizers(ev), ...(ev.hosts ?? []), ...(ev.techSupport ?? []), ...(ev.people ?? [])])
  return s.people.filter((p) => refs.has(p.id) && p.deleted_at === undefined && !p.events?.includes(ev.id))
}

/** Wave 43 answers (epsilon): a person added to an event that is part of a community joins that community (its colour tag). An isolated event changes nothing. */
export function joinEventCommunity(s: Pick<AppState, 'people' | 'events'>, personId: string, eventId: string): void {
  const tag = s.events?.find((e) => e.id === eventId)?.communityId
  const p = s.people.find((x) => x.id === personId)
  if (tag && p && String(p.fields?.[tag]) !== 'true') p.fields = { ...p.fields, [tag]: 'true' }
}

function addEventTag(s: Pick<AppState, 'people' | 'events'>, personId: string, eventId: string): void {
  const p = s.people.find((x) => x.id === personId)
  if (p && !p.events?.includes(eventId)) { p.events = [...(p.events ?? []), eventId]; joinEventCommunity(s, personId, eventId) }
}

export interface IdentifyOptions {
  id: string
  now: number
  /** Tag an existing person with the event too (the attendees picker); a new person is always tagged. */
  tag?: boolean
  /** How a person gets the event tag; default adds the id to Person.events (the UI passes events.ts tagPerson, which also counts the organizer hit). */
  tagWith?: (s: AppState, personId: string, eventId: string) => void
  /** Ring for a new person; default NEW_FROM_EVENT_RING. A caller may ask the user first (the pickRing hook of the picker). */
  ring?: Ring
}

/** The person called this (exact name, any case), or a new one in the event's ring tagged with the event. Empty name: undefined. */
export function identifyPerson(s: AppState, eventId: string, typed: string, o: IdentifyOptions): { personId: string; created: boolean } | undefined {
  const name = typed.trim()
  if (!name) return undefined
  const tag = o.tagWith ?? addEventTag
  const known = alive(s.people).find((p) => p.name.trim().toLowerCase() === name.toLowerCase())
  if (known) {
    if (o.tag) tag(s, known.id, eventId)
    return { personId: known.id, created: false }
  }
  s.people.push({ id: o.id, name: name.slice(0, 40), context: '', ring: o.ring ?? NEW_FROM_EVENT_RING, metAt: o.now, lines: [] })
  tag(s, o.id, eventId)
  return { personId: o.id, created: true }
}
