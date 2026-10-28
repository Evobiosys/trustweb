// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar events and tasks as outliner rows (wave 24, cal8). */
import { CAL_FIELDS, calendarRows } from '../../src/ext/calendar/outliner_rows.ts'

const now = new Date(2026, 10, 10, 12).getTime()
const state = {
  people: [{ id: 'p1', name: 'Ana', events: ['e1'] }, { id: 'p2', name: 'Bo' }],
  events: [
    { id: 'e1', name: 'Fair', from: '2026-11-20', where: 'Graz', invitees: undefined, people: ['p2'], createdAt: 0, attended: true },
    { id: 'e0', name: 'Old', from: '2026-11-01', where: '', createdAt: 0, attended: true },
  ],
  tasks: [
    { id: 't1', title: 'Pack', due: '2026-11-15', people: ['p1'], stamp: 1 },
    { id: 't2', title: 'Late', due: '2026-11-05', stamp: 1 },
    { id: 't3', title: 'Done', due: '2026-11-02', done: 5, stamp: 1 },
  ],
}

describe('calendarRows', () => {
  const rows = calendarRows(state, now)
  it('has one row per event and task with every status', () => {
    expect(rows.map((r) => [r.id, r.kind, r.fields.status])).toEqual([
      ['t2', 'task', 'overdue'], ['t1', 'task', 'open'], ['e1', 'event', 'upcoming'], ['t3', 'task', 'done'], ['e0', 'event', 'past'],
    ])
  })
  it('fields: when, where, people (invitees and attendees, no duplicates)', () => {
    const e = rows.find((r) => r.id === 'e1')
    expect(e.title).toBe('Fair')
    expect(e.fields.where).toBe('Graz')
    expect(e.fields.when).toContain('2026')
    expect(e.fields.people.sort()).toEqual(['Ana', 'Bo'])
    expect(rows.find((r) => r.id === 't1').fields.people).toEqual(['Ana'])
    expect(rows.find((r) => r.id === 'e0').fields.where).toBeUndefined()
  })
  it('stable field ids', () => {
    expect(CAL_FIELDS).toEqual({ when: 'cal-when', where: 'cal-where', people: 'cal-people', status: 'cal-status' })
  })
  it('empty record gives no rows', () => { expect(calendarRows({ people: [] }, now)).toEqual([]) })
})
