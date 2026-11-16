// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-event-visibility (item 4): "Calendar" in the community menu: the community's events in the app's month grid
 * (ext/calendar/calendar.ts), hiding calendars switched off by tag (event_draft.ts calendarVisible). A tap on an event opens it.
 */
import { el } from '../../../../demo/src/ui/dom'
import { calendarVisible } from '../../event_draft'
import { communityEvents } from '../../event_visibility'
import { todayIso } from '../../events'
import type { AppState } from '../../model'
import type { S } from '../../strings'
import { addMonths, dayCounts, eventsOn, monthGrid } from '../calendar/calendar'

type Kids = (Node | string | null | undefined)[]

export function createCommunityCalendar(strings: typeof S, state: () => AppState, open: (eventId: string) => void, redraw: () => void): (tag: string | null) => Kids {
  const now = new Date()
  let sel = todayIso(now)
  let shown = { year: now.getFullYear(), month0: now.getMonth() }
  const go = (n: number): void => { shown = addMonths(shown.year, shown.month0, n); redraw() }
  return (tag) => {
    const s = state()
    const events = tag ? communityEvents(s.events ?? [], tag).filter((e) => calendarVisible(s, e)) : []
    const today = todayIso(now)
    const weeks = monthGrid(shown.year, shown.month0)
    const counts = dayCounts(events, weeks.flat())
    const cell = (day: string): HTMLElement => el('button', {
      class: 'cal-day' + (day === today ? ' today' : '') + (day === sel ? ' sel' : '') + (Number(day.slice(5, 7)) - 1 === shown.month0 ? '' : ' other'),
      type: 'button', 'data-day': day, 'aria-pressed': String(day === sel), onclick: () => { sel = day; redraw() },
    }, [String(Number(day.slice(8))), counts[day] ? el('i', { class: 'cal-dot' }, [String(counts[day])]) : null])
    const day = eventsOn(events, sel)
    return [el('div', { class: 'cal-community', 'data-community-calendar': '' }, [
      el('div', { class: 'cal-nav' }, [
        el('button', { class: 'lnk', type: 'button', 'data-cal-prev': '', 'aria-label': strings.cal.prev, onclick: () => go(-1) }, ['‹']),
        el('b', {}, [strings.cal.monthTitle(shown.year, shown.month0)]),
        el('button', { class: 'lnk', type: 'button', 'data-cal-next': '', 'aria-label': strings.cal.next, onclick: () => go(1) }, ['›']),
      ]),
      el('div', { class: 'cal-grid' }, [...strings.cal.weekdays.map((w) => el('span', { class: 'cal-wd' }, [w])), ...weeks.flat().map(cell)]),
      day.length ? null : el('p', { class: 'empty' }, [strings.w44vis.calendarEmpty]),
      ...day.map((ev) => el('button', { class: 'lnk', type: 'button', 'data-community-cal-event': ev.id, onclick: () => open(ev.id) }, [[ev.from.length > 10 ? ev.from.slice(11) : strings.cal.allDay, ev.name].join(' · ')])),
    ])]
  }
}
