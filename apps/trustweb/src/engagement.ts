// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 24b (Jakob 2026-10-28): close ties expire. Close and Friend people with no contact for `engagementDays` (off by default; the Settings switch
 * sets 30, a moon cycle) move one ring outward by themselves; 48 h before that a reminder says so. Contact = the newest of chat messages in or
 * out, timeline entries, meetings, events together, and when we met. Everything local: nothing here travels. Pure, no DOM.
 */
import { ChatDirection } from './chat'
import { Ring } from './model'
import type { AppState, Person, ReleasedTie } from './model'

export const DAY_MS = 86_400_000
export const ENGAGEMENT_DEFAULT_DAYS = 30
export const ENGAGEMENT_MAX_DAYS = 365
/** The reminder goes out this long before the window ends. */
export const WARN_MS = 2 * DAY_MS
/** A release stays undoable (summary card, then the Undo link on the ring row) this long. */
export const UNDO_DAYS = 7
/** The reminder names this many people; the rest is a count. */
export const SOON_NAMES_MAX = 3

/** First run of the feature: from now on counts as contact for everybody, so nothing is released before the window has passed. */
export function ensureBaseline(s: Pick<AppState, 'engagementSince'>, now: number): void {
  s.engagementSince ??= now
}

/** Only people with an engagement channel are subject: connected on TrustWeb, a channel value, a chat thread or a meeting. Notes-only cards never. */
export function inScope(s: State, p: Person): boolean {
  return !!p.peerId || Object.values(p.channels ?? {}).some(Boolean) || !!s.chats?.[p.peerId ?? '']
    || (s.meetings ?? []).some((m) => m.personId === p.id)
}

type State = Pick<AppState, 'people'> & Partial<Pick<AppState, 'engagementDays' | 'engagementSince' | 'chats' | 'meetings' | 'events' | 'releasedTies' | 'engagementNoticeDay'>>

/** Days of silence a close tie survives; absent, junk or 0 = off (wave 25). ENGAGEMENT_DEFAULT_DAYS is what the Settings switch stores. */
export function engagementDays(s: Pick<AppState, 'engagementDays'>): number {
  const d = s.engagementDays
  return typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : 0
}

/** The settings field: null = leave as it was (empty or not a number); else whole days, 0..365. */
export function parseDays(raw: string): number | null {
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? Math.min(ENGAGEMENT_MAX_DAYS, Math.max(0, Math.round(n))) : null
}

/** The newest sign of contact with `p` (ms; 0 = none on record). Events later than `now` do not count yet. */
export function lastContact(s: State, p: Person, now: number): number {
  const eventAt = (from: string): number => { const t = new Date(from).getTime(); return t <= now ? t : 0 }
  const together = (s.events ?? []).filter((e) => e.people?.includes(p.id) || p.events?.includes(e.id)).map((e) => eventAt(e.from))
  return Math.max(
    0, s.engagementSince ?? 0, p.metAt, p.engagementKept ?? 0,
    ...(s.chats?.[p.peerId ?? '']?.messages ?? []).filter((m) => m.dir === ChatDirection.In || m.dir === ChatDirection.Out).map((m) => m.at),
    ...(p.timeline ?? []).map((t) => t.at),
    ...(s.meetings ?? []).filter((m) => m.personId === p.id).map((m) => m.endedAt || m.startedAt),
    ...together.filter(Number.isFinite),
  )
}

const OUTWARD: Partial<Record<Ring, Ring>> = { [Ring.Close]: Ring.Friend, [Ring.Friend]: Ring.Acquaintance }

/** When the tie of `p` runs out (ms), or null: not an inner ring, expiry off, or no contact on record to count from. */
function endsAt(s: State, p: Person, now: number): number | null {
  const days = engagementDays(s)
  const last = lastContact(s, p, now)
  return days === 0 || !OUTWARD[p.ring] || last === 0 || !inScope(s, p) ? null : last + days * DAY_MS
}

/** People whose window ends in the next 48 h (not yet over). */
export function expiringSoon(s: State, now: number): Person[] {
  return s.people.filter((p) => { const end = endsAt(s, p, now); return end !== null && end > now && end - now <= WARN_MS })
}

/** Moves everyone past the window one ring outward and records them in s.releasedTies (newest last; a person's older record is replaced, records past the undo time go). Returns the new ones. */
export function releaseTies(s: State, now: number): ReleasedTie[] {
  const out: ReleasedTie[] = []
  for (const p of s.people) {
    const end = endsAt(s, p, now)
    const to = OUTWARD[p.ring]
    if (end === null || end > now || !to) continue
    out.push({ personId: p.id, name: p.name, from: p.ring, to, at: now })
    p.ring = to
  }
  const fresh = new Set(out.map((r) => r.personId))
  s.releasedTies = [...(s.releasedTies ?? []).filter((r) => !fresh.has(r.personId) && now - r.at < UNDO_DAYS * DAY_MS), ...out]
  return out
}

/** The releases the summary card still shows: not dismissed, still undoable. */
export function openReleases(s: Pick<AppState, 'releasedTies'>, now: number): ReleasedTie[] {
  return (s.releasedTies ?? []).filter((r) => !r.seen && now - r.at < UNDO_DAYS * DAY_MS)
}

/** Whether the ring row of `personId` offers "Undo release". */
export function undoOffered(s: Pick<AppState, 'releasedTies'>, personId: string, now: number): boolean {
  return (s.releasedTies ?? []).some((r) => r.personId === personId && now - r.at < UNDO_DAYS * DAY_MS)
}

/** Dismiss the summary card; the per-person Undo stays for its 7 days. */
export function dismissReleases(s: Pick<AppState, 'releasedTies'>): void {
  for (const r of s.releasedTies ?? []) r.seen = true
}

/** Undo: the ring comes back, the tie counts as kept from now (else the next check would release it again), the record goes. */
export function undoRelease(s: State, personId: string, now: number): void {
  const card = s.releasedTies?.find((r) => r.personId === personId)
  const p = s.people.find((x) => x.id === personId)
  if (card && p) { p.ring = card.from; p.engagementKept = now }
  s.releasedTies = (s.releasedTies ?? []).filter((r) => r.personId !== personId)
}

export function undoAllReleases(s: State, now: number): void {
  for (const r of openReleases(s, now)) undoRelease(s, r.personId, now)
}

/** The 48 h reminder is one notice naming up to 3 people. */
export function soonNames(people: readonly Pick<Person, 'name'>[]): { names: string[]; more: number } {
  return { names: people.slice(0, SOON_NAMES_MAX).map((p) => p.name), more: Math.max(0, people.length - SOON_NAMES_MAX) }
}

/** Local calendar day, "YYYY-MM-DD". */
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The 48-hour reminder goes out once a day, at the first check from 12:00 local. */
export function noticeDue(s: Pick<AppState, 'engagementNoticeDay'>, now: Date): boolean {
  return now.getHours() >= 12 && s.engagementNoticeDay !== localDay(now)
}
