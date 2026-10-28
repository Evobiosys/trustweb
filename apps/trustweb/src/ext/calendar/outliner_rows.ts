// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar events and tasks as outliner nodes with fields (cal8), like the Manage outliner row (outliner_fields.ts). Pure. */
import { attendees, isPast, todayIso, whenLabel } from '../../events'
import type { AppState } from '../../model'
import { invitees } from './invitees'
import { isOverdue } from './tasks'

/** Stable field ids a later outliner (Curator, Tana export) maps. */
export const CAL_FIELDS = { when: 'cal-when', where: 'cal-where', people: 'cal-people', status: 'cal-status' } as const

export type CalStatus = 'upcoming' | 'past' | 'open' | 'overdue' | 'done'
export interface OutlinerRow {
  id: string
  kind: 'event' | 'task'
  title: string
  fields: { when: string; where?: string; people: string[]; status: CalStatus }
}

/** Upcoming events and open tasks by date first, then past events and done tasks (latest first). */
export function calendarRows(s: AppState | Pick<AppState, 'people' | 'events' | 'tasks'>, now: number): OutlinerRow[] {
  const today = todayIso(new Date(now))
  const state = s as AppState
  const rows: (OutlinerRow & { key: string; live: boolean })[] = [
    ...(s.events ?? []).map((ev) => {
      const past = isPast(ev, now)
      const names = [...new Set([...invitees(s, ev), ...attendees(state, ev.id)].map((p) => p.name))]
      return { id: ev.id, kind: 'event' as const, title: ev.name, key: ev.from, live: !past,
        fields: { when: whenLabel(ev), ...(ev.where ? { where: ev.where } : {}), people: names, status: past ? 'past' as const : 'upcoming' as const } }
    }),
    ...(s.tasks ?? []).map((t) => ({ id: t.id, kind: 'task' as const, title: t.title, key: t.due ?? '9', live: !t.done,
      fields: { when: t.due?.replace('T', ' ') ?? '', people: (t.people ?? []).flatMap((id) => s.people.find((p) => p.id === id)?.name ?? []),
        status: t.done ? 'done' as const : isOverdue(t, today) ? 'overdue' as const : 'open' as const } })),
  ]
  const by = (live: boolean, sign: number) => rows.filter((r) => r.live === live).sort((a, b) => sign * a.key.localeCompare(b.key))
  return [...by(true, 1), ...by(false, -1)].map(({ key: _k, live: _l, ...row }) => row)
}
