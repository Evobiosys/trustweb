// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar "I'm here now" (cal4): pure state on AppState.atEvent, who is here, what was shared, the bell diff. Nothing here sends anything. */
import { ChatDirection } from '../../chat'
import type { AppState, Person, TwEvent } from '../../model'

const HOUR = 3_600_000
const KEEP_ENDED = 6 * HOUR
const SHARED_MAX = 30

export interface Shared { kind: 'line' | 'item' | 'chat'; personId?: string; text: string; at: number }
export interface Here { event: TwEvent; people: { person: Person; isNew: boolean }[]; shared: Shared[] }

/** Local ms of "YYYY-MM-DD[THH:MM]"; a date alone counts from its start (end=false) or the start of the next day (end=true). */
function at(iso: string, end: boolean): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (iso.length > 10) return new Date(y, m - 1, d, Number(iso.slice(11, 13)), Number(iso.slice(14, 16))).getTime()
  return new Date(y, m - 1, d + (end ? 1 : 0)).getTime()
}

const endOf = (ev: TwEvent): number => at(ev.to ?? ev.from, true)

/** The event day (or a day in its range) is today: the "I'm here now" button shows. */
export const isOnNow = (ev: TwEvent, now: number): boolean => at(ev.from, false) <= now && now < at(ev.to ?? ev.from, true)

export function arrive(s: AppState, eventId: string, now: number): void {
  if (s.events?.some((e) => e.id === eventId)) s.atEvent = { eventId, since: now }
}

export function leave(s: AppState): void { delete s.atEvent }

/** Absent bell = on, so only an off bell is stored. */
export function setBell(s: AppState, on: boolean): void {
  if (!s.atEvent) return
  if (on) delete s.atEvent.bell; else s.atEvent.bell = false
}

/** null: not at an event, the event is gone, or it ended more than 6 h ago (the frame then offers Leave only). */
export function hereNow(s: AppState, now: number): Here | null {
  const ev = s.atEvent && s.events?.find((e) => e.id === s.atEvent?.eventId)
  if (!s.atEvent || !ev || endOf(ev) + KEEP_ENDED < now) return null
  const { eventId, since } = s.atEvent
  const people = s.people
    .filter((p) => ev.people?.includes(p.id) || p.events?.includes(eventId))
    // Person.metAt is the only stamp: someone tagged here who was already in my web has no arrival time, so not "new".
    .map((person) => ({ person, isNew: person.metAt >= since }))
  const line = (p: Person): Shared[] => (p.lines ?? []).filter((l) => l.eventId === eventId && l.notedAt >= since).map((l) => ({ kind: 'line', personId: p.id, text: l.text, at: l.notedAt }))
  const chat = (p: Person): Shared[] => (p.peerId ? s.chats?.[p.peerId]?.messages ?? [] : []).filter((m) => m.dir === ChatDirection.In && m.at >= since).map((m) => ({ kind: 'chat', personId: p.id, text: m.text, at: m.at }))
  const shared: Shared[] = [
    ...s.people.flatMap(line),
    ...people.flatMap(({ person }) => chat(person)),
    ...s.inventory.filter((i) => i.eventId === eventId && i.createdAt >= since).map((i): Shared => ({ kind: 'item', text: i.text, at: i.createdAt })),
  ].sort((a, b) => b.at - a.at).slice(0, SHARED_MAX)
  return { event: ev, people, shared }
}

const sharedKey = (x: Shared): string => `${x.kind}:${x.personId ?? ''}:${x.at}:${x.text}`

/** What the bell announces: people and shares in `next` that `prev` lacked. No previous state = nothing (the first look is the baseline). */
export function newSince(prev: Here | null, next: Here | null): { people: Person[]; shared: Shared[] } {
  if (!prev || !next) return { people: [], shared: [] }
  const had = new Set(prev.people.map((p) => p.person.id))
  const seen = new Set(prev.shared.map(sharedKey))
  return { people: next.people.filter((p) => !had.has(p.person.id)).map((p) => p.person), shared: next.shared.filter((x) => !seen.has(sharedKey(x))) }
}
