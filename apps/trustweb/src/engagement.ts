// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 24b (Jakob 2026-10-28): close ties expire. Close and Friend people with no contact for `engagementDays` (default 30, a moon
 * cycle; 0 = off) move one ring outward by themselves; 48 h before that a reminder says so. Contact = the newest of chat messages in or
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

type State = Pick<AppState, 'people'> & Partial<Pick<AppState, 'engagementDays' | 'chats' | 'meetings' | 'events' | 'releasedTies' | 'engagementNoticeDay'>>

/** Days of silence a close tie survives; absent or junk = 30; 0 = off. */
export function engagementDays(s: Pick<AppState, 'engagementDays'>): number {
  const d = s.engagementDays
  return typeof d === 'number' && Number.isFinite(d) && d >= 0 ? d : ENGAGEMENT_DEFAULT_DAYS
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
    0, p.metAt, p.engagementKept ?? 0,
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
  return days === 0 || !OUTWARD[p.ring] || last === 0 ? null : last + days * DAY_MS
}

/** People whose window ends in the next 48 h (not yet over). */
export function expiringSoon(s: State, now: number): Person[] {
  return s.people.filter((p) => { const end = endsAt(s, p, now); return end !== null && end > now && end - now <= WARN_MS })
}

/** Moves everyone past the window one ring outward and records a card for each (s.releasedTies, newest last). Returns the new cards. */
export function releaseTies(s: State, now: number): ReleasedTie[] {
  const out: ReleasedTie[] = []
  for (const p of s.people) {
    const end = endsAt(s, p, now)
    const to = OUTWARD[p.ring]
    if (end === null || end > now || !to) continue
    out.push({ personId: p.id, name: p.name, from: p.ring, to, at: now })
    p.ring = to
  }
  if (out.length) s.releasedTies = [...(s.releasedTies ?? []), ...out]
  return out
}

/** Undo: the ring comes back, the tie counts as kept from now (else the next check would release it again), the card goes. */
export function undoRelease(s: State, personId: string, now: number): void {
  const card = s.releasedTies?.find((r) => r.personId === personId)
  const p = s.people.find((x) => x.id === personId)
  if (card && p) { p.ring = card.from; p.engagementKept = now }
  dropRelease(s, personId)
}

export function dropRelease(s: State, personId: string): void {
  s.releasedTies = (s.releasedTies ?? []).filter((r) => r.personId !== personId)
}

/** Local calendar day, "YYYY-MM-DD". */
export const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** The 48-hour reminder goes out once a day, at the first check from 12:00 local. */
export function noticeDue(s: Pick<AppState, 'engagementNoticeDay'>, now: Date): boolean {
  return now.getHours() >= 12 && s.engagementNoticeDay !== localDay(now)
}
