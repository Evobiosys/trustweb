// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar module (wave 24, cal1): date maths by hand in local time, no DOM. Days are "YYYY-MM-DD". */
import { todayIso } from '../../events'
import type { TwEvent, TwTask } from '../../model'
import { tasksOn } from './tasks'

const WEEK = 7

/** Local noon of a day, so a DST shift never moves it across midnight. */
const at = (year: number, month0: number, day: number): Date => new Date(year, month0, day, 12)

/** Weeks of the month, Monday first, with the neighbour months' days that fill the first and last week. */
export function monthGrid(year: number, month0: number): string[][] {
  const lead = (at(year, month0, 1).getDay() + 6) % WEEK
  const rows = Math.ceil((lead + at(year, month0 + 1, 0).getDate()) / WEEK)
  return Array.from({ length: rows }, (_, r) => Array.from({ length: WEEK }, (_, c) => todayIso(at(year, month0, 1 - lead + r * WEEK + c))))
}

export function addMonths(year: number, month0: number, n: number): { year: number; month0: number } {
  const d = at(year, month0 + n, 1)
  return { year: d.getFullYear(), month0: d.getMonth() }
}

/** Events whose span (date part of from to to) covers the day, earliest first. */
export function eventsOn(events: TwEvent[], day: string): TwEvent[] {
  return events
    .filter((e) => e.from.slice(0, 10) <= day && day <= (e.to ?? e.from).slice(0, 10))
    .sort((a, b) => a.from.localeCompare(b.from))
}

/** How many events (and open tasks with a due) fall on each of the days; days without any are left out. */
export function dayCounts(events: TwEvent[], days: string[], tasks: TwTask[] = []): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of days) {
    const n = eventsOn(events, d).length + tasksOn(tasks, d).filter((t) => !t.done).length
    if (n) out[d] = n
  }
  return out
}
