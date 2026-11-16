// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-open-space: the schedule of an online open space on the event page (events_view `plan` hook): the day and window, the activities by
 * slot with "I join" per activity, the shared notes of each, and "Propose an activity" behind an expander (P3). Joins show names only for the people
 * the attendee list may show (event_visibility.ts); everybody else is counted.
 */
import { el } from '../../demo/src/ui/dom'
import { attendees } from './events'
import { listedAttendees } from './event_visibility'
import { joinActivity, joinedOf, leaveActivity, proposeActivity, sortedActivities, tokenOf, windowOf } from './open_space'
import type { AppState, OsActivity, TwEvent } from './model'
import { S } from './strings'

export interface OpenSpaceHooks {
  state: () => AppState
  save: () => void
  redraw: () => void
  newId: () => string
  /** Sends my change to the people at the event (event_envelope.ts pushOpenSpace). */
  push: (ev: TwEvent) => void
  /** The opener of the shared notes of one activity (co-notes); null or absent while that module is off. */
  noteFor?: (ev: TwEvent, act: OsActivity) => (() => void) | null
}

const T = S.w44os
/** The proposal form stays open across redraws; the field values live here. */
const draft = { open: false, title: '', slot: '', description: '', error: '' }

export function openSpaceSection(ev: TwEvent, h: OpenSpaceHooks): Node[] {
  if (!ev.openSpace) return []
  const st = h.state()
  const me = tokenOf(ev.id, st.me.displayName)
  const w = windowOf(ev)
  const known = listedAttendees(attendees(st, ev.id), ev.id, ev.showAll === true)
  const change = (fn: () => unknown): void => { fn(); h.save(); h.push(ev); h.redraw() }

  const row = (a: OsActivity): HTMLElement => {
    const tokens = joinedOf(a)
    const on = tokens.includes(me)
    const names = known.filter((p) => tokens.includes(tokenOf(ev.id, p.name))).map((p) => p.name)
    const hidden = tokens.filter((t) => t !== me).length - names.length
    const who = [...(on ? [T.you] : []), ...names, ...(hidden > 0 ? [T.others(hidden)] : [])]
    const openNote = h.noteFor?.(ev, a)
    return el('div', { class: 'os-act', 'data-os-act': a.id }, [
      el('div', { class: 'os-head' }, [
        el('b', { class: 'os-slot' }, [a.slot]),
        el('span', { class: 'os-title', 'data-os-title': '' }, [a.title]),
        el('button', {
          class: 'chip' + (on ? ' on' : ' tw-off'), type: 'button', 'aria-pressed': String(on), 'data-os-join': a.id,
          onclick: () => change(() => (on ? leaveActivity : joinActivity)(ev, a.id, me, Date.now())),
        }, [on ? T.joined : T.join]),
      ]),
      a.description ? el('p', { class: 'meta' }, [a.description]) : null,
      el('p', { class: 'meta', 'data-os-who': a.id }, [`${T.by(a.by)} · ${T.count(tokens.length)}${who.length ? ` · ${who.join(', ')}` : ''}`]),
      openNote ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-os-notes': a.id, onclick: openNote }, [T.notes]) : null,
    ])
  }

  const input = (key: 'title' | 'description', attrs: Record<string, string>): HTMLInputElement => {
    const i = el('input', { class: 'field', value: draft[key], ...attrs }) as HTMLInputElement
    i.addEventListener('input', () => { draft[key] = i.value })
    return i
  }
  const slot = el('input', { class: 'field', type: 'time', value: draft.slot || w.start, min: w.start, max: w.end, 'aria-label': T.slot, 'data-os-slot': '' }) as HTMLInputElement
  slot.addEventListener('input', () => { draft.slot = slot.value })
  const propose = (): void => {
    try {
      proposeActivity(ev, { title: draft.title, slot: slot.value, description: draft.description }, st.me.displayName, h.newId(), Date.now())
      Object.assign(draft, { open: false, title: '', slot: '', description: '', error: '' })
      h.save(); h.push(ev); h.redraw()
    } catch (e) { draft.error = (e as Error).message; h.redraw() }
  }
  const form = draft.open ? el('div', { class: 'os-form', 'data-os-form': '' }, [
    input('title', { placeholder: T.titlePh, 'aria-label': T.titlePh, maxlength: '80', 'data-os-input-title': '' }),
    slot,
    (() => { const d = input('description', { placeholder: T.descPh, 'aria-label': T.descPh, maxlength: '200', 'data-os-input-desc': '' }); d.classList.add('opt-min'); return d })(),
    draft.error ? el('p', { class: 'warn', 'data-os-error': '' }, [draft.error]) : null,
    el('button', { class: 'btn btn-electric wide', type: 'button', 'data-os-add': '', onclick: propose }, [T.add]),
  ]) : null

  return [el('section', { class: 'os', 'data-open-space': ev.id }, [
    el('h3', {}, [T.title]),
    el('p', { class: 'meta', 'data-os-window': '' }, [T.window(w.day, w.start, w.end)]),
    ...sortedActivities(ev).map(row),
    ev.openSpace.acts.length ? null : el('p', { class: 'empty meta', 'data-os-empty': '' }, [T.empty]),
    el('button', { class: 'btn btn-ghost wide', type: 'button', 'aria-expanded': String(draft.open), 'data-os-propose': '', onclick: () => { draft.open = !draft.open; h.redraw() } }, [T.propose + (draft.open ? ' ▴' : ' ▾')]),
    form,
  ])]
}
