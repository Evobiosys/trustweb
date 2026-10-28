// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar "I'm here now" view (cal4): the button on the event sheet, the frame on every screen with its latch panel, the bell, the draft chip. */
import { el } from '../../../../demo/src/ui/dom'
import { S } from '../../strings'
import type { TwEvent } from '../../model'
import type { ExtHooks } from '../registry'
import { arrive, hereNow, isOnNow, leave, newSince, setBell, type Here } from './at_event'

const clock = (ms: number): string => new Date(ms).toTimeString().slice(0, 5)
/** One drag step opens (down) or closes (up) the latch; less is a tap. */
const DRAG_PX = 40
const TAP_PX = 10

export function createAtEvent(h: ExtHooks): {
  eventSection: (ev: TwEvent) => Node[]
  frame: () => HTMLElement | null
  recordChip: (eventId: string, drop: () => void) => HTMLElement | null
  tick: () => void
} {
  let open = false
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

  function frame(): HTMLElement | null {
    const s = h.state()
    if (!s.atEvent) return null
    const { eventId, since } = s.atEvent
    const here = hereNow(s, Date.now())
    const name = s.events?.find((e) => e.id === eventId)?.name ?? S.cal.title
    const setOpen = (on: boolean): void => { open = on; box.classList.toggle('open', on); latch.setAttribute('aria-expanded', String(on)); if (on) fillPanel(hereNow(h.state(), Date.now())) }
    let y0 = 0
    const latch = el('button', {
      class: 'ae-latch', 'data-at-event-latch': '', 'aria-label': S.cal.hereLatch, 'aria-expanded': String(open),
    }, [el('span', {})])
    // Pointer: a tap toggles, a drag of more than DRAG_PX opens (down) or closes (up). Keyboard click (detail 0) toggles.
    latch.addEventListener('pointerdown', (e) => { y0 = e.clientY; latch.setPointerCapture?.(e.pointerId) })
    latch.addEventListener('pointerup', (e) => {
      const dy = e.clientY - y0
      if (Math.abs(dy) < TAP_PX) setOpen(!open); else if (dy > DRAG_PX) setOpen(true); else if (dy < -DRAG_PX) setOpen(false)
    })
    latch.addEventListener('click', (e) => { if (e.detail === 0) setOpen(!open) })
    panel = el('div', { class: 'ae-panel', 'data-at-event-panel': '' })
    const bell = el('button', {
      class: 'btn btn-ghost btn-sm', 'data-at-event-bell': '', 'aria-label': S.cal.hereBell, title: S.cal.hereBell, 'aria-pressed': String(s.atEvent.bell !== false),
      onclick: () => { const on = bell.getAttribute('aria-pressed') !== 'true'; setBell(h.state(), on); h.save(); bell.setAttribute('aria-pressed', String(on)) },
    }, ['🔔'])
    const box = el('div', { class: 'at-event-frame' + (open ? ' open' : ''), 'data-at-event-frame': '' }, [
      el('div', { class: 'ae-row' }, [
        el('button', { class: 'ae-name', 'data-at-event-name': '', onclick: () => h.openEvent(eventId) }, [el('b', {}, [name]), el('i', {}, [here ? S.cal.hereSince(clock(since)) : S.cal.hereOver])]),
        here ? bell : null,
        el('button', { class: 'btn btn-ghost btn-sm', 'data-at-event-leave': '', onclick: () => { leave(h.state()); changed() } }, [S.cal.hereLeave]),
      ]),
      here ? latch : null,
      panel,
    ])
    if (open) fillPanel(here)
    return box
  }

  /** The bell: announce who joined and what was shared since the last look; a notice the host could not show waits for the next tick. */
  function tick(): void {
    const s = h.state()
    const here = hereNow(s, Date.now())
    const d = newSince(prev, here)
    if (panel?.isConnected && open) fillPanel(here)
    if (!here) { prev = null; return }
    if (s.atEvent?.bell === false || (!d.people.length && !d.shared.length)) { prev = here; return }
    const title = d.people.length ? S.cal.hereJoined(here.event.name, d.people.map((p) => p.name).join(', ')) : S.cal.hereSharedNote(here.event.name, d.shared.length)
    if (h.notify('event', title, S.cal.reminderOpen, () => h.openEvent(here.event.id))) prev = here
  }

  function eventSection(ev: TwEvent): Node[] {
    const here = h.state().atEvent?.eventId === ev.id
    if (!here && !isOnNow(ev, Date.now())) return []
    return [here
      ? el('button', { class: 'btn btn-ghost wide', 'data-at-event-leave': '', onclick: () => { leave(h.state()); changed() } }, [S.cal.hereLeave])
      : el('button', { class: 'btn btn-electric wide', 'data-at-event-arrive': ev.id, onclick: () => { arrive(h.state(), ev.id, Date.now()); changed() } }, [S.cal.hereNow])]
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
