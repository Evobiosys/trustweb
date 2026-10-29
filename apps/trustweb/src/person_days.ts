// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: the "Days" section on a person's card: what happened with them, by day, newest first. Pure, no DOM. */
import { ChatDirection } from './chat'
import type { AppState, Person } from './model'
import { S } from './strings'
import { TlChannel, TlDirection, TlSource, byDay, timelineOf } from './timeline'
import type { TimelineEntry } from './timeline'

export const DAYS_PAGE = 30

/** Chats (one entry per day with the count, never the text), meetings and events together, on top of the timeline of the card. */
function extraEntries(s: AppState, p: Person): TimelineEntry[] {
  const mk = (at: number, channel: TlChannel, summary: string): TimelineEntry => ({ at, channel, direction: TlDirection.Both, summary, source: TlSource.TrustWeb })
  const perDay = new Map<number, number>()
  for (const m of s.chats?.[p.peerId ?? '']?.messages ?? []) {
    if (m.dir !== ChatDirection.In && m.dir !== ChatDirection.Out) continue
    const d = new Date(m.at)
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime()
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
  }
  return [
    ...[...perDay].map(([at, n]) => mk(at, TlChannel.TrustWeb, S.pdChat(n))),
    ...(s.meetings ?? []).filter((m) => m.personId === p.id).map((m) => mk(m.startedAt, TlChannel.InPerson, S.pdMeeting)),
    ...(s.events ?? []).filter((e) => e.people?.includes(p.id) || p.events?.includes(e.id)).map((e) => mk(new Date(e.from).getTime(), TlChannel.InPerson, S.pdEvent(e.name))),
  ].filter((e) => Number.isFinite(e.at) && e.at > 0)
}

/** The newest `limit` days; `more` = older days exist. */
export function personDays(s: AppState, p: Person, limit: number): { days: { day: number; entries: TimelineEntry[] }[]; more: boolean } {
  const all = byDay([...timelineOf(s, p), ...extraEntries(s, p)].sort((a, b) => b.at - a.at))
  return { days: all.slice(0, limit), more: all.length > limit }
}
