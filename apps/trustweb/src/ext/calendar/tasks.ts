// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Calendar tasks (wave 24, cal3): pure rules, no DOM. The FEATURE SHAPE is inspired by tasks.org (GPLv3, Android/Kotlin); no code, text or
 * assets were taken from it (it cannot be imported into TypeScript, and GPL is not this project's dual licence).
 */
import { todayIso } from '../../events'
import type { AppState, TwTask } from '../../model'

const p2 = (n: number): string => String(n).padStart(2, '0')
const DUE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/
const REPEATS: readonly string[] = ['daily', 'weekly', 'monthly', 'yearly']

/** "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" naming a real day and time, as a local Date (date-only: noon); null otherwise. */
function parseDue(due: string): Date | null {
  const m = DUE.exec(due)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(y, mo - 1, d, m[4] ? Number(m[4]) : 12, m[5] ? Number(m[5]) : 0)
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d && (!m[4] || (Number(m[4]) < 24 && Number(m[5]) < 60)) ? date : null
}

/** Validates and builds a task; the error code ('title' | 'due') names the field to fix. */
export function newTask(f: Partial<Omit<TwTask, 'id' | 'stamp'>>, id: string, now: number): TwTask | 'title' | 'due' {
  const title = (f.title ?? '').trim().slice(0, 200)
  if (!title) return 'title'
  if (f.due && !parseDue(f.due)) return 'due'
  const task: TwTask = { id, title, stamp: now }
  if (f.due) task.due = f.due
  if (f.remindAt !== undefined && Number.isFinite(f.remindAt)) task.remindAt = f.remindAt
  if (f.repeat && REPEATS.includes(f.repeat)) task.repeat = f.repeat
  const tags = (f.tags ?? []).map((x) => x.trim()).filter(Boolean)
  if (tags.length) task.tags = tags
  for (const k of ['list', 'parentId', 'resourceId'] as const) if (f[k]?.trim()) task[k] = f[k]?.trim()
  if (f.people?.length) task.people = f.people
  if (f.resourceWhy) task.resourceWhy = f.resourceWhy
  return task
}

const dayOf = (t: TwTask): string | undefined => t.due?.slice(0, 10)

/** Open tasks: by due (overdue falls first by itself; no due last); done ones apart, latest first. */
export function sortTasks(tasks: TwTask[], _today: string): { open: TwTask[]; done: TwTask[] } {
  const open = tasks.filter((t) => !t.done).sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9') || a.stamp - b.stamp)
  const done = tasks.filter((t) => t.done).sort((a, b) => (b.done ?? 0) - (a.done ?? 0))
  return { open, done }
}

export const isOverdue = (t: TwTask, today: string): boolean => !t.done && !!t.due && t.due.slice(0, 10) < today

export const subtasks = (tasks: TwTask[], parentId: string): TwTask[] => tasks.filter((t) => t.parentId === parentId)

/** Tasks with a due on that day (done ones too, shown ticked), earliest first. */
export const tasksOn = (tasks: TwTask[], day: string): TwTask[] => tasks.filter((t) => dayOf(t) === day).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? ''))

/** One step on in local time; month and year steps clamp to the month's last day (Jan 31 + 1 month = Feb 28/29). */
function advance(d: Date, repeat: NonNullable<TwTask['repeat']>): Date {
  const [y, m, day, h, mi] = [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]
  if (repeat === 'daily' || repeat === 'weekly') return new Date(y, m, day + (repeat === 'daily' ? 1 : 7), h, mi)
  const [ny, nm] = repeat === 'monthly' ? [y, m + 1] : [y + 1, m]
  return new Date(ny, nm, Math.min(day, new Date(ny, nm + 1, 0).getDate()), h, mi)
}

/**
 * Ticks (or unticks) a task. Ticking a repeating task also adds its next occurrence (due and remindAt moved on alike); unticking never adds one.
 * No-op for an unknown id.
 */
export function toggleDone(s: Pick<AppState, 'tasks'>, id: string, now: number): void {
  const t = s.tasks?.find((x) => x.id === id)
  if (!t || !s.tasks) return
  t.stamp = now
  if (t.done) { delete t.done; return }
  t.done = now
  const due = t.due ? parseDue(t.due) : null
  if (!t.repeat || (!due && t.remindAt === undefined)) return
  const next: TwTask = { ...t, id: `${t.id}-${now.toString(36)}`, stamp: now }
  delete next.done
  if (due && t.due) {
    const n = advance(due, t.repeat)
    next.due = t.due.length > 10 ? `${todayIso(n)}T${p2(n.getHours())}:${p2(n.getMinutes())}` : todayIso(n)
  }
  if (t.remindAt !== undefined) next.remindAt = advance(new Date(t.remindAt), t.repeat).getTime()
  s.tasks.push(next)
}

/** What marks a reminder as fired: the task and its time, so a reminder moved to a new time fires again. */
export const fireKey = (t: TwTask): string => `${t.id}@${t.remindAt ?? ''}`

/** Open tasks whose reminder time has come and that have not fired yet. */
export const dueReminders = (tasks: TwTask[], now: number, fired: readonly string[]): TwTask[] =>
  tasks.filter((t) => !t.done && t.remindAt !== undefined && t.remindAt <= now && !fired.includes(fireKey(t)))

/** ms <-> the value of a datetime-local input ("YYYY-MM-DDTHH:MM", local time); NaN for an empty or malformed value. */
export const toInput = (ms: number): string => { const d = new Date(ms); return `${todayIso(d)}T${p2(d.getHours())}:${p2(d.getMinutes())}` }
export const fromInput = (v: string): number => parseDue(v.length > 10 ? v : '')?.getTime() ?? NaN
