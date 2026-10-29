// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The people list page (wave 25): everyone grouped by trust zone in ladder order, newest contact first. Pure, DOM-free. */
import { Ring, RINGS } from './model'
import type { AppState, Person } from './model'
import { webSlot } from './rings_layout'

export interface ZoneGroup {
  ring: Ring
  people: Person[]
}

/** The newest sign of contact: a chat message, a timeline entry, a kept tie, else the day we met. */
export function lastContact(s: Pick<AppState, 'chats'>, p: Person): number {
  const chat = p.peerId ? s.chats?.[p.peerId]?.messages ?? [] : []
  return Math.max(p.metAt, p.engagementKept ?? 0, ...chat.map((m) => m.at), ...(p.timeline ?? []).map((e) => e.at))
}

const ZONES: readonly Ring[] = [...RINGS, Ring.Unsorted]

/** Zones in ladder order (not placed yet last), empty ones left out; `query` filters on name and context. */
export function peopleByZone(s: Pick<AppState, 'people'> & Partial<Pick<AppState, 'chats'>>, query: string): ZoneGroup[] {
  const q = query.trim().toLowerCase()
  const hit = (p: Person): boolean => !q || p.name.toLowerCase().includes(q) || p.context.toLowerCase().includes(q)
  const last = new Map(s.people.map((p) => [p.id, lastContact(s, p)]))
  return ZONES.map((ring) => ({
    ring,
    people: s.people.filter((p) => webSlot(p) === ring && hit(p)).sort((a, b) => (last.get(b.id) ?? 0) - (last.get(a.id) ?? 0)),
  })).filter((g) => g.people.length > 0)
}
