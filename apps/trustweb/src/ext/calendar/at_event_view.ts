// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar "I'm here now" view (cal4): the button on the event sheet, the thin pill on every screen (wave 43: the name only; Leave, the bell and who is here sit on the event page), the draft chip. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import { contextPress } from '../../context_press'
import { eventTagLabel } from '../../event_tag'
import type { TwEvent } from '../../model'
import type { ExtHooks } from '../registry'
import { arrive, hereNow, isOnNow, leave, newSince, setBell, type Here } from './at_event'

const clock = (ms: number): string => new Date(ms).toTimeString().slice(0, 5)

export function createAtEvent(h: ExtHooks): {
  eventSection: (ev: TwEvent) => Node[]
  frame: () => HTMLElement | null
  recordChip: (eventId: string, drop: () => void) => HTMLElement | null
  tick: () => void
} {
  let panel: HTMLElement | null = null
  /** What the bell compared against last time; null until the first look. */
  let prev: Here | null = null

  const changed = (): void => { prev = hereNow(h.state(), Date.now()); h.atEventChanged(); h.save(); h.redraw() }

  function fillPanel(here: Here | null): void {
    if (!panel) return
    panel.replaceChildren(...(here ? [
      el('h4', { class: 'eyebrow' }, [S.cal.herePeople]),
      ...(here.people.length ? here.people.map(({ person, isNew }) => el('div', { class: 'prow', 'data-at-event-person': person.id }, [
        h.avatar(person.name, person.id), el('span', { class: 'who' }, [el('b', {}, [person.name])]), isNew ? el('i', { class: 'ae-new' }, [S.cal.hereNew]) : null,
      ])) : [el('p', { class: 'empty' }, [S.cal.herePeopleEmpty])]),
      el('h4', { class: 'eyebrow' }, [S.cal.hereShared]),
      ...(here.shared.length ? here.shared.map((x) => el('div', { class: 'prow', 'data-at-event-shared': x.kind }, [
        el('span', { class: 'who' }, [el('b', {}, [h.state().people.find((p) => p.id === x.personId)?.name ?? h.state().me.displayName ?? '']), el('i', {}, [x.text])]),
        el('i', { class: 'meta' }, [clock(x.at)]),
      ])) : [el('p', { class: 'empty' }, [S.cal.hereSharedEmpty])]),
    ] : [el('p', { class: 'empty' }, [S.cal.hereOver])]))
  }

  /** Wave 43: one thin line, the event name behind a tag glyph; a press opens the event, a long press or right click its edit form (P1). */
  function frame(): HTMLElement | null {
    const s = h.state()
    if (!s.atEvent) return null
    const { eventId } = s.atEvent
    const name = s.events?.find((e) => e.id === eventId)?.name ?? S.cal.title
    const btn = el('button', { class: 'ae-name', 'data-at-event-name': '', title: name, onclick: () => h.openEvent(eventId) }, [el('b', {}, [eventTagLabel(name)])])
    contextPress(btn, () => h.openEvent(eventId, undefined, true))
    return el('div', { class: 'at-event-frame', 'data-at-event-frame': '' }, [btn])
  }

  /** The bell: announce who joined and what was shared since the last look; a notice the host could not show waits for the next tick. */
  function tick(): void {
    const s = h.state()
    const here = hereNow(s, Date.now())
    const d = newSince(prev, here)
    if (panel?.isConnected) fillPanel(here)
    if (!here) { prev = null; return }
    if (s.atEvent?.bell === false || (!d.people.length && !d.shared.length)) { prev = here; return }
    const title = d.people.length ? S.cal.hereJoined(here.event.name, d.people.map((p) => p.name).join(', ')) : S.cal.hereSharedNote(here.event.name, d.shared.length)
    if (h.notify('event', title, S.cal.reminderOpen, () => h.openEvent(here.event.id))) prev = here
  }

  /** The event page: "I'm here now" while it is on, else Leave, the bell and who is here with what was shared (wave 43: moved off the top line). */
  function eventSection(ev: TwEvent): Node[] {
    const s = h.state()
    const here = s.atEvent?.eventId === ev.id
    if (!here && !isOnNow(ev, Date.now())) return []
    if (!here) return [el('button', { class: 'btn btn-electric wide', 'data-at-event-arrive': ev.id, onclick: () => { arrive(h.state(), ev.id, Date.now()); changed() } }, [S.cal.hereNow])]
    const bell = el('button', {
      class: 'btn btn-ghost btn-sm' + (s.atEvent?.bell === false ? ' tw-off' : ''), 'data-at-event-bell': '', 'aria-label': S.cal.hereBell, title: S.cal.hereBell, 'aria-pressed': String(s.atEvent?.bell !== false),
      onclick: () => { const on = bell.getAttribute('aria-pressed') !== 'true'; setBell(h.state(), on); h.save(); bell.setAttribute('aria-pressed', String(on)); bell.classList.toggle('tw-off', !on) },
    }, ['🔔'])
    panel = el('div', { class: 'ae-panel', 'data-at-event-panel': '' })
    fillPanel(hereNow(s, Date.now()))
    return [
      el('div', { class: 'ae-row' }, [
        bell,
        el('button', { class: 'btn btn-ghost wide', 'data-at-event-leave': '', onclick: () => { leave(h.state()); changed() } }, [S.cal.hereLeave]),
      ]),
      panel,
    ]
  }

  function recordChip(eventId: string, drop: () => void): HTMLElement | null {
    const ev = h.state().events?.find((e) => e.id === eventId)
    return ev ? el('div', { class: 'chip ae-chip', 'data-rec-event': eventId }, [
      S.cal.recChip(ev.name),
      el('button', { class: 'ae-chip-x', 'data-rec-event-drop': '', 'aria-label': S.cal.recChipDrop, onclick: drop }, ['×']),
    ]) : null
  }

  return { eventSection, frame, recordChip, tick }
}
