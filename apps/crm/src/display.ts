/** Small presentation helpers shared by the screens. */
import type { NoteLine, Person } from '../../trustweb/src/model'
import { Tag, ageLabel } from '../../trustweb/src/model'
import { dayKey, daysUntil, fmtDate } from './dates'
import type { FollowUp } from './model'
import { S } from './strings'
import type { TimelineEvent } from './timeline'

const AVATAR_HUES = 6

/** "Lena Hofbauer" -> "LH"; one word -> its first letter; empty -> "?". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = Array.from(parts[0])[0] ?? '?'
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? '') : ''
  return (first + last).toLocaleUpperCase()
}

/** A stable avatar colour slot (0..5) per person id. */
export function avatarHue(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h % AVATAR_HUES
}

/** The label on a line's chip: a custom tag shows its own name. */
export function tagText(line: Pick<NoteLine, 'tag' | 'customTag'>): string {
  return line.tag === Tag.Custom && line.customTag ? line.customTag : S.tagLabel[line.tag]
}

/** Person id -> name, for views that label many rows. */
export function nameMap(people: readonly Person[]): Map<string, string> {
  return new Map(people.map((p) => [p.id, p.name]))
}

export interface DayGroup {
  key: string
  at: number
  events: TimelineEvent[]
}

/** Consecutive events (already newest first) bucketed by local day. */
export function groupByDay(events: readonly TimelineEvent[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const e of events) {
    const key = dayKey(e.at)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.events.push(e)
    else groups.push({ key, at: e.at, events: [e] })
  }
  return groups
}

/** Per person, when something last happened up to `now` (events newest first). Dates ahead, such as a due follow-up, do not count. */
export function lastPastByPerson(events: readonly TimelineEvent[], now: number): Map<string, number> {
  const last = new Map<string, number>()
  for (const e of events) if (e.at <= now && !last.has(e.personId)) last.set(e.personId, e.at)
  return last
}

/** "Last: 3 days ago"; with nothing past, "Upcoming" when something lies ahead, else "Nothing yet". */
export function lastActivityText(past: number | undefined, hasUpcoming: boolean, now: number): string {
  if (past !== undefined) return S.lastActivity(ageLabel(past, now))
  return hasUpcoming ? S.upcoming : S.nothingYet
}

/** When a follow-up falls due, or when it was finished. */
export function dueText(f: FollowUp, now: number): string {
  if (f.doneAt) return S.doneOn(fmtDate(f.doneAt))
  if (f.dueAt <= now) return S.dueOn(fmtDate(f.dueAt))
  return S.dueBoth(S.dueIn(daysUntil(f.dueAt, now)), fmtDate(f.dueAt))
}
