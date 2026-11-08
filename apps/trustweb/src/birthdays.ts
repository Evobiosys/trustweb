// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 37 people-fields: the Birthday field of a person (fields.birthday, as the Google and service imports store it: YYYY-MM-DD, or --MM-DD
 * without a year), who has one coming up, and the once-a-day notice text. Owner-only, local. Pure, DOM-free.
 */
import type { AppState, Person } from './model'
import { isDeleted } from './deleted_people'
import { localDay } from './engagement'
import { S } from './strings'
import { isArchived } from './trustzones'

export interface Birthday { month: number; day: number; year?: number }
export interface Upcoming { person: Person; daysAway: number; isToday: boolean; age?: number }

const DAY_MS = 86_400_000
const SHOWN_NAMES = 3

const valid = (month: number, day: number): boolean => month >= 1 && month <= 12 && day >= 1 && day <= new Date(2000, month, 0).getDate()

/** Reads YYYY-MM-DD, --MM-DD, MM-DD, DD.MM.YYYY and DD.MM.; null for anything else or an impossible date. */
export function parseBirthday(raw: string | undefined): Birthday | null {
  const t = (raw ?? '').trim()
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t) ?? /^(?:--)?()(\d{1,2})-(\d{1,2})$/.exec(t)
  const g = m ? { year: m[1], month: m[2], day: m[3] } : (() => { const d = /^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/.exec(t); return d ? { year: d[3] ?? '', month: d[2], day: d[1] } : null })()
  if (!g) return null
  const month = Number(g.month)
  const day = Number(g.day)
  if (!valid(month, day)) return null
  return g.year ? { month, day, year: Number(g.year) } : { month, day }
}

export const birthdayOf = (p: Pick<Person, 'fields'>): Birthday | null => parseBirthday(p.fields?.birthday)

/** The stored form: YYYY-MM-DD, or --MM-DD without a year. */
export const birthdayText = (b: Birthday): string => {
  const md = `${String(b.month).padStart(2, '0')}-${String(b.day).padStart(2, '0')}`
  return b.year ? `${b.year}-${md}` : `--${md}`
}

/** The next time this birthday falls on or after `from` (29 February becomes 28 February in a year without one). */
function nextOn(b: Birthday, from: Date): Date {
  const at = (y: number): Date => new Date(y, b.month - 1, b.month === 2 && b.day === 29 && new Date(y, 1, 29).getDate() !== 29 ? 28 : b.day)
  const this_ = at(from.getFullYear())
  return this_ >= from ? this_ : at(from.getFullYear() + 1)
}

/** The age at the next birthday on or after today (today's birthday counts as today); undefined without a year. */
export const turnsAge = (b: Birthday, today: Date): number | undefined =>
  b.year ? nextOn(b, new Date(today.getFullYear(), today.getMonth(), today.getDate())).getFullYear() - b.year : undefined

/** People with a birthday from today up to `horizonDays` days ahead, today first, then by days away and name. */
export function upcoming(people: readonly Person[], today: Date, horizonDays: number): Upcoming[] {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const out: Upcoming[] = []
  for (const person of people) {
    if (isDeleted(person) || isArchived(person)) continue
    const b = birthdayOf(person)
    if (!b) continue
    const on = nextOn(b, from)
    const daysAway = Math.round((on.getTime() - from.getTime()) / DAY_MS)
    if (daysAway > horizonDays) continue
    out.push({ person, daysAway, isToday: daysAway === 0, ...(b.year ? { age: on.getFullYear() - b.year } : {}) })
  }
  return out.sort((a, b) => a.daysAway - b.daysAway || a.person.name.localeCompare(b.person.name))
}

const names = (list: readonly Upcoming[]): string => {
  const all = list.map((u) => u.person.name)
  return S.birthdayNames(all.slice(0, SHOWN_NAMES), Math.max(0, all.length - SHOWN_NAMES))
}

/** "Birthday today: Anna. This week: Ben, Cy and 1 more."; '' when the list is empty. */
export function noticeText(list: readonly Upcoming[]): string {
  const today = list.filter((u) => u.isToday)
  const week = list.filter((u) => !u.isToday)
  return [today.length ? S.birthdayToday(names(today)) : '', week.length ? S.birthdayWeek(names(week)) : ''].filter(Boolean).join(' ')
}

/** On unless switched off (an older record has no switch). */
export const birthdayRemindersOn = (s: Pick<AppState, 'birthdayReminders'>): boolean => s.birthdayReminders !== false

/** The notice goes out once per local day, at the first check. */
export const birthdayNoticeDue = (s: Pick<AppState, 'birthdayNoticeDay'>, now: Date): boolean => s.birthdayNoticeDay !== localDay(now)

/** The one hook the banner (and later a browser push) goes through: hands the notice text to `show`; false when there is nothing to tell. */
export function notifyBirthdays(list: readonly Upcoming[], show: (text: string) => void): boolean {
  const text = noticeText(list)
  if (!text) return false
  show(text)
  return true
}

/** "Never show again" on the banner: the Birthday reminders setting goes off (it can be switched on again in Settings). */
export function dismissAction(s: Pick<AppState, 'birthdayReminders'>): void {
  s.birthdayReminders = false
}
