// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 33: "Invited to". Invitations I received, grouped by place; pure and DOM-free.
 * Local only: cascade.ts askSources strips AppState.invitations (I1); they travel between my own devices only (sync_core.ts).
 */
import type { AppState, Invitation, Person } from './model'

export type InvitationStatus = Invitation['status']
export const INVITATION_STATUSES: readonly InvitationStatus[] = ['open', 'accepted', 'declined', 'past']

/** What the form hands over; every field may be empty, but one of place, event and host must be set. */
export interface InvitationFields { event?: string; host?: string; place?: string; date?: string; link?: string; note?: string; status?: string }

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A validated invitation, or the first field that fails. Empty optional fields are left out. */
export function newInvitation(f: InvitationFields, id: string, source?: Invitation['source']): Invitation | 'empty' | 'date' | 'status' {
  const [event, place, link, note] = [f.event, f.place, f.link, f.note].map((v) => v?.trim() ?? '')
  const date = f.date?.trim() ?? ''
  const status = (f.status || 'open') as InvitationStatus
  if (!event && !place && !f.host) return 'empty'
  if (date && (!DATE.test(date) || Number.isNaN(new Date(`${date}T00:00`).getTime()))) return 'date'
  if (!INVITATION_STATUSES.includes(status)) return 'status'
  return {
    id, kind: 'invitation', status,
    ...(event ? { event } : {}), ...(f.host ? { host: f.host } : {}), ...(place ? { place } : {}),
    ...(date ? { date } : {}), ...(link ? { link } : {}), ...(note ? { note } : {}), ...(source ? { source } : {}),
  }
}

const dated = (a: Invitation, b: Invitation): number => (a.date && b.date ? a.date.localeCompare(b.date) : Number(!a.date) - Number(!b.date))

/** By place (case-insensitive, first spelling kept, in first-seen order), no place last; inside a group dated first by date. */
export function groupByPlace(list: readonly Invitation[]): { place: string; items: Invitation[] }[] {
  const groups = new Map<string, { place: string; items: Invitation[] }>()
  for (const i of list) {
    const key = (i.place ?? '').toLowerCase()
    const g = groups.get(key) ?? { place: i.place ?? '', items: [] }
    g.items.push(i)
    groups.set(key, g)
  }
  return [...groups.values()].map((g) => ({ ...g, items: [...g.items].sort(dated) })).sort((a, b) => Number(!a.place) - Number(!b.place))
}

export const invitationsOfHost = (s: Pick<AppState, 'invitations'>, personId: string): Invitation[] => (s.invitations ?? []).filter((i) => i.host === personId)

/** A pasted list, one place per line: "Place: Person, Person". A name that is a person I know becomes the host, any other name the event label. */
export function parseInvitationList(text: string, people: readonly Pick<Person, 'id' | 'name'>[], newId: () => string): Invitation[] {
  const out: Invitation[] = []
  for (const line of text.split('\n')) {
    const cut = line.indexOf(':')
    const place = (cut < 0 ? line : line.slice(0, cut)).trim()
    const names = cut < 0 ? [] : line.slice(cut + 1).split(',').map((n) => n.trim()).filter(Boolean)
    if (!place) continue
    if (!names.length) { out.push({ id: newId(), kind: 'invitation', place, status: 'open' }); continue }
    for (const n of names) {
      const known = people.find((p) => p.name.toLowerCase() === n.toLowerCase())
      out.push({ id: newId(), kind: 'invitation', place, status: 'open', ...(known ? { host: known.id } : { event: n }) })
    }
  }
  return out
}

/** An invitation shown among the events: same words as an event row, tagged 'invitation'. from is empty when it has no date. */
export interface InvitationRow { id: string; name: string; from: string; where: string; tag: 'invitation' }

/** Invitations (not declined) whose event, host name or place match the query like events do (eventMatches); dated first by date, undated last. */
export function invitationEventRows(s: Pick<AppState, 'invitations' | 'people'>, query: string): InvitationRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const nameOf = (i: Invitation): string => s.people.find((p) => p.id === i.host)?.name ?? ''
  return (s.invitations ?? []).filter((i) => i.status !== 'declined').filter((i) => {
    const hay = `${i.event ?? ''} ${nameOf(i)} ${i.place ?? ''}`.toLowerCase().split(/\s+/)
    return words.every((w) => hay.some((h) => h.startsWith(w)))
  }).sort(dated).map((i) => ({ id: i.id, name: i.event || nameOf(i) || i.place || '', from: i.date ?? '', where: i.place ?? '', tag: 'invitation' as const }))
}

/** Events first, then the invitation rows. */
export const mergeEventRows = <T extends { id: string }>(events: readonly T[], rows: readonly InvitationRow[]): (T | InvitationRow)[] => [...events, ...rows]
