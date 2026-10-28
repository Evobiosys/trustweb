// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar module view (wave 24, cal1): month grid and the agenda of the chosen day. Selection lives in this closure, not in the record. */
import { el } from '../../../../demo/src/ui/dom'
import { todayIso } from '../../events'
import type { TwEvent } from '../../model'
import { S } from '../../strings'
import type { ExtHooks } from '../registry'
import { addMonths, dayCounts, eventsOn, monthGrid } from './calendar'

const timeOf = (ev: TwEvent): string => (ev.from.length > 10 ? ev.from.slice(11) : S.cal.allDay)

export function calendarScreen(h: ExtHooks): { body: () => Node[] } {
  const now = new Date()
  let sel = todayIso(now)
  let shown = { year: now.getFullYear(), month0: now.getMonth() }

  const go = (n: number): void => { shown = addMonths(shown.year, shown.month0, n); h.redraw() }

  function grid(events: TwEvent[]): HTMLElement {
    const weeks = monthGrid(shown.year, shown.month0)
    const counts = dayCounts(events, weeks.flat())
    const today = todayIso(new Date())
    const cell = (day: string): HTMLElement => el('button', {
      class: 'cal-day' + (day === today ? ' today' : '') + (day === sel ? ' sel' : '') + (Number(day.slice(5, 7)) - 1 === shown.month0 ? '' : ' other'),
      'data-day': day, 'aria-pressed': String(day === sel),
      onclick: () => { sel = day; h.redraw() },
    }, [String(Number(day.slice(8))), counts[day] ? el('i', { class: 'cal-dot' }, [String(counts[day])]) : null])
    return el('div', { class: 'cal-grid' }, [...S.cal.weekdays.map((w) => el('span', { class: 'cal-wd' }, [w])), ...weeks.flat().map(cell)])
  }

  function agenda(events: TwEvent[]): HTMLElement {
    const day = eventsOn(events, sel)
    return el('div', { class: 'cal-agenda' }, [
      day.length ? null : el('p', { class: 'empty' }, [S.cal.dayEmpty]),
      ...day.map((ev) => el('button', { class: 'prow', 'data-cal-event': ev.id, onclick: () => h.openEvent(ev.id) }, [
        el('span', { class: 'who' }, [el('b', {}, [ev.name]), el('i', {}, [[timeOf(ev), ev.where].filter(Boolean).join(' · ')])]),
      ])),
    ])
  }

  return {
    body: () => {
      const events = h.state().events ?? []
      return [h.header(S.cal.title, { back: h.leave }), el('div', { class: 'scroll cal' }, [
        el('div', { class: 'cal-nav' }, [
          el('button', { class: 'btn btn-ghost btn-sm', 'data-cal-prev': '', 'aria-label': S.cal.prev, onclick: () => go(-1) }, ['‹']),
          el('b', {}, [S.cal.monthTitle(shown.year, shown.month0)]),
          el('button', { class: 'btn btn-ghost btn-sm', 'data-cal-next': '', 'aria-label': S.cal.next, onclick: () => go(1) }, ['›']),
        ]),
        grid(events),
        agenda(events),
        el('button', { class: 'btn btn-electric wide', 'data-cal-add': '', onclick: () => h.addEvent(sel) }, [S.cal.add]),
        el('button', { class: 'btn btn-ghost wide', 'data-cal-all': '', onclick: h.showList }, [S.cal.allEvents]),
      ])]
    },
  }
}
