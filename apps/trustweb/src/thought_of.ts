// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37 people-fields: "Thought of you today". The days the owner wrote to or about a person (Person.thoughtOf, one local day each, newest last),
 * the count for the card, and what may be told: 'passive' (default) = only the monthly count, only when that person asks; 'active' = one small chat line
 * per day; 'off' = never. Local until shared (I1). Pure, DOM-free.
 */
import type { Person } from './model'
import { localDay } from './engagement'
import { S } from './strings'

export type ThoughtShare = 'passive' | 'active' | 'off'
const KEEP_DAYS = 366

export const shareModeOf = (p: Pick<Person, 'thoughtShare'>): ThoughtShare => p.thoughtShare ?? 'passive'

/** Notes today's local day; false when it was there already. */
export function recordThought(p: Pick<Person, 'thoughtOf'>, now: Date): boolean {
  const day = localDay(now)
  const days = p.thoughtOf ?? []
  if (days.includes(day)) return false
  p.thoughtOf = [...days, day].sort().slice(-KEEP_DAYS)
  return true
}

export const thoughtsThisMonth = (p: Pick<Person, 'thoughtOf'>, now: Date): number => {
  const month = localDay(now).slice(0, 7)
  return (p.thoughtOf ?? []).filter((d) => d.startsWith(month)).length
}

/** What a "did you think of me?" gets back: the count of this month, or null when sharing is off. */
export function thoughtAnswer(p: Pick<Person, 'thoughtOf' | 'thoughtShare'>, now: Date): { month: string; count: number } | null {
  return shareModeOf(p) === 'off' ? null : { month: localDay(now).slice(0, 7), count: thoughtsThisMonth(p, now) }
}

/** Active mode: one line per day, right after a thought was recorded. */
export const activeLineDue = (p: Pick<Person, 'thoughtShare' | 'thoughtSentDay'>, now: Date, justRecorded: boolean): boolean =>
  justRecorded && shareModeOf(p) === 'active' && p.thoughtSentDay !== localDay(now)

export const cardText = (name: string, count: number): string => (count === 0 ? '' : count === 1 ? S.thoughtOnce(name) : S.thoughtMany(name, count))
