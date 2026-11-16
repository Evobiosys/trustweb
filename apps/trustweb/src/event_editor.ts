// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 event-editor: the logic behind the calendar-style editor (event_editor_view.ts). Row order follows Jakob's item 12 and the
 * structure of open-source calendar editors (Nextcloud Calendar's "new event" sidebar, Thunderbird's event dialog: title, when, attendees,
 * location / conference, description, calendar, then the rest folded). Own code; no source copied.
 */
import { memberIds } from './colour_tags'
import type { ColourTag } from './colour_tags'
import { suggest } from './audience_filter'
import { applyEventDetails, emptyFields, inviteGuests } from './event_draft'
import type { EditorFields } from './event_draft'
import { eventOrganizers, sameName, setRoles } from './event_roles'
import { applyEventSettings, newEvent, splitThemes } from './events'
import type { EventError } from './events'
import { FAMILY_FIELD } from './rings_layout'
import type { AppState, Person, TwEvent } from './model'

export const EDITOR_ROWS = ['name', 'time', 'guests', 'location', 'description', 'calendar', 'more'] as const

export type EditorError = EventError | 'link'

/** What the editor owns on an event: cleared in the editor = cleared on the event. Everything else (sign-up, settings, links) is kept. */
const OWNED = ['to', 'core', 'conditions', 'themes', 'organizer', 'organizers', 'hosts', 'techSupport', 'tagName', 'tagLocked', 'repeat', 'conference', 'attachment', 'calendar', 'people', 'communityId', 'techTakeover'] as const

/** An event read back into the editor. The creator (me) is not listed among the co-hosts: meRole says what I am. */
export function fieldsOf(s: Pick<AppState, 'me' | 'people'>, ev: TwEvent): EditorFields {
  const me = s.me.displayName
  const hosts = ev.hosts ?? []
  const tech = ev.techSupport ?? []
  const isMe = (ref: string): boolean => sameName(s.people.find((p) => p.id === ref)?.name ?? ref, me)
  const meTech = tech.some(isMe) && !hosts.some(isMe)
  return {
    ...emptyFields(ev.from, me),
    name: ev.name, from: ev.from, to: ev.to ?? '', repeat: ev.repeat ?? 'none',
    guests: [...(ev.people ?? [])], cohosts: meTech ? hosts.filter((r) => !isMe(r)) : [...hosts], meRole: meTech ? 'tech' : 'cohost',
    where: ev.where, conference: (ev.conference ?? []).map((c) => ({ ...c })), description: ev.docs?.description ?? '', attachment: ev.attachment ?? '', calendar: ev.calendar ?? 'mine',
    tagName: ev.tagName ?? '', coreFrom: ev.core?.from ?? '', coreTo: ev.core?.to ?? '', conditions: ev.conditions ?? '', themes: ev.themes?.join(', ') ?? '',
    organizers: eventOrganizers(ev), techSupport: tech.filter((r) => !isMe(r)), communityId: ev.communityId ?? '', techTakeover: ev.techTakeover === true,
  }
}

/** The event the fields make, or the first field that fails (form order; a bad conference or attachment link = 'link'). */
export function eventFromFields(s: Pick<AppState, 'me' | 'people'>, f: EditorFields, o: { id: string; now: number; existing?: TwEvent }): TwEvent | EditorError {
  const made = newEvent({
    name: f.name, from: f.from, to: f.to, where: f.where, conditions: f.conditions, themes: splitThemes(f.themes), core: { from: f.coreFrom, to: f.coreTo },
    ...(o.existing ? { attended: o.existing.attended } : {}),
  }, o.id, o.existing?.createdAt ?? o.now)
  if (typeof made === 'string') return made
  const kept: Partial<TwEvent> = { ...o.existing }
  for (const k of OWNED) delete kept[k]
  const ev: TwEvent = { ...kept, ...made }
  const me = s.me.displayName.trim()
  const others = f.cohosts.filter((r) => !sameName(r, me))
  try {
    applyEventDetails(ev, { repeat: f.repeat, conference: f.conference.filter((c) => c.url.trim()), attachment: f.attachment, description: f.description, calendar: f.calendar })
  } catch { return 'link' }
  setRoles(s, ev, {
    organizers: f.organizers,
    hosts: f.meRole === 'cohost' && me ? [me, ...others] : others,
    techSupport: f.meRole === 'tech' && me ? [...f.techSupport, me] : f.techSupport,
  })
  inviteGuests(ev, f.guests)
  applyEventSettings(ev, { communityId: f.communityId, techTakeover: f.techTakeover })
  const tag = f.tagName.trim()
  if (tag && tag !== made.name) { ev.tagName = tag; ev.tagLocked = true }
  return ev
}

export type GuestRow = { kind: 'person'; id: string; label: string } | { kind: 'tag'; id: string; label: string; ids: string[] } | { kind: 'create'; label: string }

/** Item 11: the same controls as the other person boxes (audience_filter.ts suggest): "@x" people, "#x" tags (a tag adds all its people), plain text both; the last row adds a new person when nobody carries exactly that name. Nothing typed: nothing offered. */
export function guestRows(q: string, people: readonly Person[], tags: readonly ColourTag[], chosen: readonly string[]): GuestRow[] {
  const raw = q.trim().replace(/^[@#]/, '').trim()
  if (!raw) return []
  const live = people.filter((p) => p.deleted_at === undefined)
  const rows: GuestRow[] = suggest(q.trim(), live, tags, chosen.map((id) => `person:${id}`)).flatMap((r): GuestRow[] => {
    if (r.kind === 'person' && r.id) return [{ kind: 'person', id: r.id, label: r.label }]
    if (r.kind !== 'tag' || !r.id) return []
    const ids = memberIds(live, tags, r.id).filter((id) => !chosen.includes(id))
    return ids.length ? [{ kind: 'tag', id: r.id, label: r.label, ids }] : []
  })
  const exact = live.some((p) => sameName(p.name, raw))
  return q.trim().startsWith('#') || exact ? rows : [...rows, { kind: 'create', label: raw }]
}

/** Item 11: Family is not a community but one of the other groups. */
export function groupRows<T extends { id: string; name: string }>(rows: readonly T[]): { communities: T[]; others: T[] } {
  const other = (r: T): boolean => r.id === FAMILY_FIELD || r.name.trim().toLowerCase() === 'family'
  return { communities: rows.filter((r) => !other(r)), others: rows.filter(other) }
}
