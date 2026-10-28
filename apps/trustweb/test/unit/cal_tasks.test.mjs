// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar tasks (wave 24, cal3): pure rules, sync between own devices, never in an ask, the reminder kind. */
import { dueReminders, fromInput, newTask, toInput, sortTasks, subtasks, tasksOn, toggleDone } from '../../src/ext/calendar/tasks.ts'
import { dayCounts } from '../../src/ext/calendar/calendar.ts'
import { bundleOf, countsOf, mergeBundle, parseBundle, refreshStamps } from '../../src/sync_core.ts'
import { askSources } from '../../src/cascade.ts'
import { ALL_KINDS_ON, NOTIFY_KINDS, kindOfWire, kindsOf, wantsKind, workerLines } from '../../src/notify_kinds.ts'

const t = (id, extra = {}) => ({ id, title: id, stamp: 1, ...extra })
const state = (over = {}) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const local = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime()

describe('newTask', () => {
  it('trims the title, keeps a valid due, stamps now', () => {
    expect(newTask({ title: '  Call Ada ', due: '2026-11-02T09:30', tags: ['a', ' ', 'b'] }, 'x', 5)).toEqual({ id: 'x', title: 'Call Ada', due: '2026-11-02T09:30', tags: ['a', 'b'], stamp: 5 })
  })
  it('refuses an empty title or a malformed due', () => {
    expect(newTask({ title: ' ' }, 'x', 1)).toBe('title')
    expect(newTask({ title: 'a', due: '2026-13-01' }, 'x', 1)).toBe('due')
    expect(newTask({ title: 'a', due: '02.11.2026' }, 'x', 1)).toBe('due')
    expect(newTask({ title: 'a', due: '2026-02-30' }, 'x', 1)).toBe('due')
  })
})

describe('datetime-local value', () => {
  it('round-trips local time; empty or date-only is NaN', () => {
    const ms = local(2026, 11, 2, 8, 30)
    expect(toInput(ms)).toBe('2026-11-02T08:30')
    expect(fromInput('2026-11-02T08:30')).toBe(ms)
    expect(fromInput('')).toBeNaN()
    expect(fromInput('2026-11-02')).toBeNaN()
  })
})

describe('sortTasks', () => {
  it('open by due (overdue first, no due last), done separately latest first', () => {
    const r = sortTasks([t('nodue'), t('later', { due: '2026-11-09' }), t('late', { due: '2026-10-01' }), t('d1', { done: 5 }), t('d2', { done: 9 })], '2026-10-28')
    expect(r.open.map((x) => x.id)).toEqual(['late', 'later', 'nodue'])
    expect(r.done.map((x) => x.id)).toEqual(['d2', 'd1'])
  })
})

describe('subtasks, tasksOn, dayCounts', () => {
  it('subtasks of a parent only', () => {
    expect(subtasks([t('a'), t('b', { parentId: 'a' }), t('c', { parentId: 'z' })], 'a').map((x) => x.id)).toEqual(['b'])
  })
  it('tasksOn matches the date part of due; dayCounts adds open tasks', () => {
    const ts = [t('a', { due: '2026-11-02' }), t('b', { due: '2026-11-02T08:00' }), t('c', { due: '2026-11-03', done: 1 }), t('d')]
    expect(tasksOn(ts, '2026-11-02').map((x) => x.id)).toEqual(['a', 'b'])
    expect(dayCounts([], ['2026-11-02', '2026-11-03'], ts)).toEqual({ '2026-11-02': 2 })
  })
})

describe('toggleDone', () => {
  it('ticks a plain task and unticks it again', () => {
    const s = state({ tasks: [t('a')] })
    toggleDone(s, 'a', 10)
    expect(s.tasks[0]).toMatchObject({ done: 10, stamp: 10 })
    toggleDone(s, 'a', 20)
    expect(s.tasks[0].done).toBeUndefined()
    expect(s.tasks[0].stamp).toBe(20)
  })
  it('a repeating task leaves the next occurrence, remindAt shifted alike', () => {
    const s = state({ tasks: [t('a', { due: '2026-11-02T09:00', repeat: 'weekly', remindAt: local(2026, 11, 2, 8, 30), tags: ['x'] })] })
    toggleDone(s, 'a', 10)
    expect(s.tasks).toHaveLength(2)
    expect(s.tasks[0].done).toBe(10)
    expect(s.tasks[1]).toMatchObject({ title: 'a', due: '2026-11-09T09:00', repeat: 'weekly', remindAt: local(2026, 11, 9, 8, 30), tags: ['x'], stamp: 10 })
    expect(s.tasks[1].done).toBeUndefined()
    expect(s.tasks[1].id).not.toBe('a')
  })
  it('month end clamps, year follows, day is plain', () => {
    const next = (due, repeat) => { const s = state({ tasks: [t('a', { due, repeat })] }); toggleDone(s, 'a', 1); return s.tasks[1].due }
    expect(next('2026-01-31', 'monthly')).toBe('2026-02-28')
    expect(next('2028-01-31', 'monthly')).toBe('2028-02-29')
    expect(next('2028-02-29', 'yearly')).toBe('2029-02-28')
    expect(next('2026-12-31', 'daily')).toBe('2027-01-01')
  })
  it('unticking never makes another occurrence', () => {
    const s = state({ tasks: [t('a', { due: '2026-11-02', repeat: 'daily' })] })
    toggleDone(s, 'a', 1); toggleDone(s, 'a', 2)
    expect(s.tasks).toHaveLength(2)
  })
})

describe('dueReminders', () => {
  it('due, open, not yet fired', () => {
    const ts = [t('a', { remindAt: 5 }), t('b', { remindAt: 50 }), t('c', { remindAt: 1, done: 2 }), t('d', { remindAt: 1 }), t('e')]
    expect(dueReminders(ts, 10, ['d']).map((x) => x.id)).toEqual(['a'])
  })
})

describe('sync between own devices', () => {
  const stamp = (s, at, d) => refreshStamps(s, {}, at, d)
  it('a task made on A arrives on B; a newer edit wins; no tasks field leaves mine untouched', () => {
    const a = state({ tasks: [t('a', { title: 'Phone' })] })
    const b = state({ tasks: [t('a', { title: 'Mac' }), t('only')] })
    mergeBundle(b, stamp(b, 100, 'Mac'), bundleOf(a, stamp(a, 200, 'Phone')), 0)
    expect(b.tasks.map((x) => x.title)).toEqual(['Phone', 'only'])
    const fresh = state()
    mergeBundle(fresh, {}, bundleOf(a, {}), 0)
    expect(fresh.tasks.map((x) => x.id)).toEqual(['a'])
    const before = structuredClone(b.tasks)
    mergeBundle(b, {}, bundleOf(state(), {}), 0)
    expect(b.tasks).toEqual(before)
  })
  it('parseBundle keeps tasks, refuses a malformed one; counts include them', () => {
    const a = state({ tasks: [t('a')] })
    const wire = JSON.parse(JSON.stringify(bundleOf(a, stamp(a, 1, 'P'))))
    expect(parseBundle(wire).tasks).toHaveLength(1)
    expect(parseBundle({ ...wire, tasks: [{ id: 'x' }] })).toBeNull()
    expect(countsOf(bundleOf(a, {})).tasks).toBe(1)
  })
  it('a record without tasks sends no tasks field', () => {
    expect(bundleOf(state(), {})).not.toHaveProperty('tasks')
  })
  it('refreshStamps stamps a task under t:', () => {
    expect(stamp(state({ tasks: [t('a')] }), 7, 'P')['t:a'].at).toBe(7)
  })
})

describe('tasks never leave to anyone else', () => {
  it('askSources copies the record without tasks', () => {
    const s = state({ tasks: [t('secret-task')] })
    const { threads } = askSources(s, 'friend', 0)
    expect(JSON.stringify(threads)).not.toContain('secret-task')
  })
})

describe('reminder notify kind', () => {
  it('is on by default, has a switch, can be turned off, is no wire kind, workerLines skip it', () => {
    expect(ALL_KINDS_ON.reminder).toBe(true)
    expect(NOTIFY_KINDS).toContain('reminder')
    expect(kindsOf({}).reminder).toBe(true)
    expect(kindsOf({ notifyKinds: { connect: true, ask: true, chat: true } }).reminder).toBe(true)
    expect(wantsKind({ notificationsOn: true, notifyKinds: { ...ALL_KINDS_ON, reminder: false } }, 'reminder')).toBe(false)
    for (const w of ['connect', 'query', 'chat', 'reminder', 'x']) expect(kindOfWire(w)).not.toBe('reminder')
    expect(workerLines([{ kind: 'reminder', name: null }], ALL_KINDS_ON)).toEqual([])
  })
})
