/**
 * Calendar-day helpers, all in the phone's local time. Built from the local
 * year/month/day fields (never toISOString, which is UTC) and from month
 * names in strings.ts (never toLocaleDateString, whose month abbreviations
 * differ between engines).
 */
import { S } from './strings'

const DAY_MS = 86_400_000

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function localMidnight(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** "6 Oct 2026"; empty for an invalid timestamp. */
export function fmtDate(at: number): string {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getDate()} ${S.monthShort[d.getMonth()]} ${d.getFullYear()}`
}

/** "2026-10-06": the local day, also the value format of <input type="date">. */
export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Whole calendar days from `now` to `at` (negative: in the past). DST-safe. */
export function daysUntil(at: number, now: number): number {
  return Math.round((localMidnight(at) - localMidnight(now)) / DAY_MS)
}

export function todayInputValue(now: number = Date.now()): string {
  return dayKey(now)
}

/** The date-input value `days` calendar days after `now`. */
export function dateInputIn(days: number, now: number = Date.now()): string {
  const d = new Date(now)
  d.setDate(d.getDate() + days)
  return dayKey(d.getTime())
}

/** Local midnight of a "YYYY-MM-DD" value; null when it is not a real date. */
export function parseDateInput(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const d = new Date(y, mo - 1, da)
  return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da ? d.getTime() : null
}

/** The last millisecond of the local day containing `at`. */
export function endOfDay(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - 1
}

/**
 * When a thing happened, from the date the person picked: today keeps the
 * current time (so same-day entries stay in order), another day is its
 * midnight, a bad value falls back to `now`.
 */
export function inputToAt(value: string, now: number): number {
  const picked = parseDateInput(value)
  if (picked === null) return now
  return dayKey(picked) === dayKey(now) ? now : picked
}
