// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar module view (wave 24, cal1): month grid and the agenda of the chosen day. Selection lives in this closure, not in the record. */
import { el } from '../../../../demo/src/ui/dom'
import { todayIso } from '../../events'
import { acceptPerson } from '../../drag_payload'
import { matchPeople } from '../../events'
import { ringColor, type Person, type TwEvent } from '../../model'
import { S } from '../../strings'
import type { ExtHooks } from '../registry'
import { addMonths, dayCounts, eventsOn, monthGrid } from './calendar'
import { addInvitee, inviteText, invitees, removeInvitee } from './invitees'

const timeOf = (ev: TwEvent): string => (ev.from.length > 10 ? ev.from.slice(11) : S.cal.allDay)

export function calendarScreen(h: ExtHooks): { body: () => Node[]; eventSection: (ev: TwEvent) => Node[] } {
  const now = new Date()
  let sel = todayIso(now)
  let shown = { year: now.getFullYear(), month0: now.getMonth() }

  let picking = false

  const invite = (ev: TwEvent, id: string): void => {
    if (!h.state().people.some((p) => p.id === id)) return
    addInvitee(ev, id); h.save(); h.redraw()
  }

  const badge = (p: Person): HTMLElement =>
    el('span', { class: 'pbadge', style: `border:1.5px solid ${ringColor(p)}` }, [h.avatar(p.name, p.id)])

  function inviteeRow(ev: TwEvent, p: Person): HTMLElement {
    const hint = el('i', { class: 'meta' }, [p.peerId ? S.cal.inviteHint : S.cal.notConnected])
    const send = p.peerId
      ? el('button', {
        class: 'btn btn-ghost btn-sm', 'data-cal-send': p.id,
        onclick: () => { void h.sendInvite(p.id, inviteText(h.eventLink(ev), ev.name)).then((ok) => { if (ok) hint.textContent = S.cal.inviteSent }) },
      }, [S.cal.sendInvite])
      : null
    return el('div', { class: 'prow', 'data-cal-invitee': p.id }, [
      badge(p), el('span', { class: 'who' }, [el('b', {}, [p.name]), hint]), send,
      el('button', { class: 'btn btn-ghost btn-sm', 'data-cal-uninvite': p.id, 'aria-label': S.cal.uninvite(p.name), onclick: () => { removeInvitee(ev, p.id); h.save(); h.redraw() } }, ['×']),
    ])
  }

  function picker(ev: TwEvent): HTMLElement {
    const input = el('input', { class: 'field', placeholder: S.eventsTagSearch, 'aria-label': S.cal.addPeople, 'data-cal-invite-search': '' })
    const results = el('div', { class: 'chips' })
    const draw = (): void => {
      const open = h.state().people.filter((p) => !ev.people?.includes(p.id))
      results.replaceChildren(...matchPeople(open, input.value).map((p) =>
        el('button', { class: 'chip', 'data-cal-pick': p.id, onclick: () => invite(ev, p.id) }, [badge(p), el('span', { class: 'pwho' }, [p.name])])))
    }
    input.addEventListener('input', draw)
    draw()
    return el('div', {}, [input, results])
  }

  function eventSection(ev: TwEvent): Node[] {
    const box = el('div', { class: 'cal-invitees', 'data-cal-invitees': '' }, [
      el('h3', {}, [S.cal.invitees]),
      ...invitees(h.state(), ev).map((p) => inviteeRow(ev, p)),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-cal-invite-add': '', onclick: () => { picking = !picking; h.redraw() } }, [S.cal.addPeople]),
      picking ? picker(ev) : null,
    ])
    acceptPerson(box, (ref) => invite(ev, ref.id))
    return [box]
  }

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
      ...day.map((ev) => {
        const row = el('button', { class: 'prow', 'data-cal-event': ev.id, onclick: () => h.openEvent(ev.id) }, [
          el('span', { class: 'who' }, [el('b', {}, [ev.name]), el('i', {}, [[timeOf(ev), ev.where].filter(Boolean).join(' · ')])]),
        ])
        acceptPerson(row, (ref) => invite(ev, ref.id))
        return row
      }),
    ])
  }

  return {
    eventSection,
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
