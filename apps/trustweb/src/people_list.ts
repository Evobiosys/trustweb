// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The people list page (wave 25): everyone grouped by trust zone in ladder order, newest contact first. Pure, DOM-free. */
import { Ring, RINGS } from './model'
import type { AppState, Person } from './model'
import { webSlot } from './rings_layout'
import { isPinned } from './membranes_five'
import { rank, threadStats } from './search_rank'

export interface ZoneGroup {
  ring: Ring
  people: Person[]
}

/** The newest sign of contact: a chat message, a timeline entry, a kept tie, else the day we met. */
export function lastContact(s: Pick<AppState, 'chats'>, p: Person): number {
  const chat = p.peerId ? s.chats?.[p.peerId]?.messages ?? [] : []
  return Math.max(p.metAt, p.engagementKept ?? 0, ...chat.map((m) => m.at), ...(p.timeline ?? []).map((e) => e.at))
}

type ListState = Pick<AppState, 'people'> & Partial<Pick<AppState, 'chats'>>

const ZONES: readonly Ring[] = [...RINGS, Ring.Unsorted]

/** Pinned people first, whatever their zone; newest contact first. `query` filters on name and context. */
export function pinnedPeople(s: ListState, query: string, now = Date.now()): Person[] {
  return listed(s, query, isPinned, now)
}

function listed(s: ListState, query: string, keep: (p: Person) => boolean, now: number): Person[] {
  const q = query.trim().toLowerCase()
  const last = new Map(s.people.map((p) => [p.id, lastContact(s, p)]))
  const hits = s.people
    .filter((p) => keep(p) && (!q || p.name.toLowerCase().includes(q) || p.context.toLowerCase().includes(q)))
    .sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0))
  if (!q) return hits
  // Wave 27 sovereign-switch: a typed search is ordered by search_rank.ts (zone, tags, recency, reciprocity, fuzzy text); newest contact breaks ties.
  const cands = hits.map((p) => ({
    person: p, ring: p.ring, fields: p.fields, text: `${p.name} ${p.context}`,
    ...threadStats(p.peerId ? s.chats?.[p.peerId] : undefined), lastContactAt: last.get(p.id),
  }))
  return rank(cands, { now, query }).map((r) => r.person.person)
}

/** Zones in ladder order (not placed yet last), empty ones left out; pinned people sit in `pinnedPeople`, not here. */
export function peopleByZone(s: ListState, query: string, now = Date.now()): ZoneGroup[] {
  return ZONES.map((ring) => ({ ring, people: listed(s, query, (p) => !isPinned(p) && webSlot(p) === ring, now) })).filter((g) => g.people.length > 0)
}
