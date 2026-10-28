// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar tasks view (wave 24, cal3): the Tasks list, the add/edit panel, agenda rows, reminders, "Remind me" on an item. Feature shape after tasks.org; no code taken. */
import { el } from '../../../../demo/src/ui/dom'
import { todayIso } from '../../events'
import type { InventoryItem, TwTask } from '../../model'
import { S } from '../../strings'
import type { ExtHooks } from '../registry'
import { dueReminders, fromInput, isOverdue, newTask, sortTasks, subtasks, toggleDone, toInput } from './tasks'

const FIRED_KEY = 'tw-cal-fired'
const FIRED_KEEP = 500

const firedIds = (): string[] => {
  try { return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[] } catch { return [] }
}

export function createTasks(h: ExtHooks, showTasks: () => void): {
  list: () => Node[]
  row: (t: TwTask) => HTMLElement
  itemSection: (item: InventoryItem) => Node[]
  start: () => void
} {
  /** The task in the panel ({} = a new one; parentId set for a new subtask), or null while the list shows. */
  let editing: { task?: TwTask; parentId?: string } | null = null
  const tasks = (): TwTask[] => h.state().tasks ?? []
  const add = (t: TwTask): void => { const s = h.state(); s.tasks = [...(s.tasks ?? []), t] }
  const done = (): void => { editing = null; h.save(); h.redraw() }

  function row(t: TwTask): HTMLElement {
    const subs = subtasks(tasks(), t.id).length
    const meta = [t.due?.replace('T', ' '), t.repeat ? S.cal.repeatGlyph : '', subs ? S.cal.subtaskCount(subs) : '', t.list].filter(Boolean).join(' · ')
    return el('div', { class: 'prow cal-task' + (t.done ? ' done' : '') + (isOverdue(t, todayIso(new Date())) ? ' overdue' : ''), 'data-cal-task': t.id }, [
      el('button', {
        class: 'cal-tick', 'data-task-done': t.id, 'aria-pressed': String(!!t.done), 'aria-label': S.cal.tick(t.title),
        onclick: () => { toggleDone(h.state(), t.id, Date.now()); h.save(); h.redraw() },
      }, [t.done ? '✓' : '']),
      el('button', { class: 'who cal-task-open', onclick: () => { editing = { task: t }; h.redraw() } }, [el('b', {}, [t.title]), meta ? el('i', {}, [meta]) : null]),
    ])
  }

  function panel(): HTMLElement {
    const { task, parentId } = editing ?? {}
    const parent = tasks().find((x) => x.id === (task?.parentId ?? parentId))
    const field = (label: string, input: HTMLElement): HTMLElement => el('label', { class: 'cal-field' }, [el('span', { class: 'meta' }, [label]), input])
    const title = el('input', { class: 'field', 'data-task-title': '', value: task?.title ?? '' }) as HTMLInputElement
    const date = el('input', { class: 'field', type: 'date', 'data-task-due': '', value: task?.due?.slice(0, 10) ?? '' }) as HTMLInputElement
    const time = el('input', { class: 'field', type: 'time', 'data-task-time': '', value: task?.due?.slice(11) ?? '' }) as HTMLInputElement
    const remind = el('input', { class: 'field', type: 'datetime-local', 'data-task-remind': '', value: task?.remindAt !== undefined ? toInput(task.remindAt) : '' }) as HTMLInputElement
    const repeat = el('select', { class: 'field', 'data-task-repeat': '' }, Object.entries(S.cal.repeatLabels).map(([v, l]) => el('option', { value: v }, [l]))) as HTMLSelectElement
    repeat.value = task?.repeat ?? ''
    const lists = [...new Set(tasks().flatMap((x) => x.list ?? []))]
    const list = el('input', { class: 'field', list: 'cal-lists', 'data-task-list': '', value: task?.list ?? '' }) as HTMLInputElement
    const tags = el('input', { class: 'field', 'data-task-tags': '', value: (task?.tags ?? []).join(', ') }) as HTMLInputElement
    const err = el('p', { class: 'meta cal-err', role: 'alert' })
    const save = (): void => {
      const remindAt = remind.value ? fromInput(remind.value) : undefined
      if (remindAt !== undefined && Number.isNaN(remindAt)) { err.textContent = S.cal.errRemind; return }
      const next = newTask({
        title: title.value, due: date.value ? date.value + (time.value ? 'T' + time.value : '') : undefined, remindAt,
        repeat: (repeat.value || undefined) as TwTask['repeat'], list: list.value, tags: tags.value.split(','),
        parentId: task?.parentId ?? parentId, people: task?.people, resourceId: task?.resourceId, resourceWhy: task?.resourceWhy,
      }, task?.id ?? h.newId(), Date.now())
      if (typeof next === 'string') { err.textContent = next === 'title' ? S.cal.errTitle : S.cal.errDue; return }
      if (task) {
        if (task.done) next.done = task.done
        h.state().tasks = tasks().map((x) => (x.id === task.id ? next : x))
      } else add(next)
      done()
    }
    const remove = (): void => {
      if (!task) return
      const gone = tasks().filter((x) => x.id === task.id || x.parentId === task.id)
      h.state().tasks = tasks().filter((x) => !gone.includes(x))
      editing = null; h.save(); h.redraw()
      h.undo(S.cal.taskDeleted(task.title), () => { h.state().tasks = [...tasks(), ...gone]; h.save(); h.redraw() })
    }
    return el('div', { class: 'cal-task-panel', 'data-task-panel': '' }, [
      el('h3', {}, [task ? S.cal.editTask : S.cal.addTask]),
      parent ? el('p', { class: 'meta' }, [S.cal.taskParent(parent.title)]) : null,
      field(S.cal.taskTitle, title), field(S.cal.taskDue, date), field(S.cal.taskDueTime, time),
      field(S.cal.taskRemind, remind), el('p', { class: 'meta' }, [S.cal.remindHint]),
      field(S.cal.taskRepeat, repeat), field(S.cal.taskList, list), el('datalist', { id: 'cal-lists' }, lists.map((l) => el('option', { value: l }))),
      field(S.cal.taskTags, tags), err,
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-electric', 'data-task-save': '', onclick: save }, [S.cal.save]),
        el('button', { class: 'btn btn-ghost', onclick: () => { editing = null; h.redraw() } }, [S.cal.cancel]),
        task ? el('button', { class: 'btn btn-ghost', 'data-task-delete': '', onclick: remove }, [S.cal.deleteTask]) : null,
      ]),
      task && !task.parentId ? el('div', {}, [
        el('h4', { class: 'eyebrow' }, [S.cal.subtasks]),
        ...subtasks(tasks(), task.id).map(row),
        el('button', { class: 'btn btn-ghost btn-sm', 'data-task-add-sub': '', onclick: () => { editing = { parentId: task.id }; h.redraw() } }, [S.cal.addSubtask]),
      ]) : null,
    ])
  }

  function list(): Node[] {
    if (editing) return [panel()]
    const top = tasks().filter((t) => !t.parentId)
    const { open, done: finished } = sortTasks(top, todayIso(new Date()))
    return [
      top.length ? null : el('p', { class: 'empty' }, [S.cal.tasksEmpty]),
      ...open.map(row),
      finished.length ? el('details', { class: 'cal-done', 'data-task-folded': '' }, [el('summary', {}, [S.cal.doneFold(finished.length)]), ...finished.map(row)]) : null,
      el('button', { class: 'btn btn-electric wide', 'data-task-add': '', onclick: () => { editing = {}; h.redraw() } }, [S.cal.addTask]),
    ].filter((n): n is HTMLElement => n !== null)
  }

  /** Fires each due reminder once (ids kept in localStorage, not in the record) and tells the host. */
  function tick(): void {
    const fired = firedIds()
    const due = dueReminders(tasks(), Date.now(), fired)
    if (!due.length) return
    try { localStorage.setItem(FIRED_KEY, JSON.stringify([...fired, ...due.map((t) => t.id)].slice(-FIRED_KEEP))) } catch { /* fired again next start */ }
    for (const t of due) h.notify(t.title, S.cal.reminderOpen, () => (t.resourceId ? h.openItem(t.resourceId) : (showTasks(), h.openCalendar())))
  }

  function itemSection(item: InventoryItem): Node[] {
    const box = el('div', { class: 'cal-remind', 'data-item-remind-box': '' })
    const form = (): void => {
      const at = el('input', { class: 'field', type: 'datetime-local', 'data-remind-at': '', 'aria-label': S.cal.taskRemind }) as HTMLInputElement
      const why = el('select', { class: 'field', 'data-remind-why': '' }, [el('option', { value: 'share' }, [S.cal.remindShareLbl]), el('option', { value: 'ask' }, [S.cal.remindAskLbl])]) as HTMLSelectElement
      const err = el('p', { class: 'meta cal-err', role: 'alert' })
      box.replaceChildren(at, why, el('p', { class: 'meta' }, [S.cal.remindHint]), err, el('button', {
        class: 'btn btn-electric btn-sm', 'data-remind-save': '',
        onclick: () => {
          const remindAt = fromInput(at.value)
          if (Number.isNaN(remindAt)) { err.textContent = S.cal.errRemind; return }
          const kind = why.value as 'share' | 'ask'
          const t = newTask({ title: kind === 'share' ? S.cal.remindShare(item.text) : S.cal.remindAsk(item.text), remindAt, due: toInput(remindAt), resourceId: item.id, resourceWhy: kind }, h.newId(), Date.now())
          if (typeof t === 'string') return
          add(t); h.save()
          box.replaceChildren(el('p', { class: 'meta' }, [S.cal.reminderSet]))
        },
      }, [S.cal.save]))
    }
    box.append(el('button', { class: 'btn btn-ghost btn-sm', 'data-item-remind': item.id, onclick: form }, [S.cal.remindMe]))
    return [box]
  }

  return {
    list, row, itemSection,
    start: () => { tick(); setInterval(tick, 60_000) },
  }
}
