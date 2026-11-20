// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b filters-communities: the DOM side of event mode and saved filter states. (1) The bar above the filter row of Web, Chat, Resources and
 * Ask: the event-mode pill `#event:<name>` with an X to leave, and the pinned saved states. (2) The "Event mode" toggle of an event page,
 * struck through when off. (3) The Advanced "Saved filters" section of the filter sheet. Logic: event_filter_mode.ts, saved_filters.ts.
 */
import { el } from '../../demo/src/ui/dom'
import type { AppState } from './model'
import { eventFilterOf, eventModePill, setEventFilter } from './event_filter_mode'
import { applySavedFilter, pinSavedFilter, pinnedFilters, saveFilterState } from './saved_filters'
import { setEveryone } from './event_bubble'
import { S } from './strings'

export interface FilterBarIo { state: () => AppState; save: () => void; redraw: () => void; /** Wave 45 event-bubble: the Web screen, where the chip "Everyone" shows. */ web?: boolean }

/** The bar element, or null when there is nothing to show. */
export function filterBar(io: FilterBarIo): HTMLElement | null {
  const s = io.state()
  const pill = eventModePill(s)
  const pinned = pinnedFilters(s)
  if (!pill && !pinned.length) return null
  return el('div', { class: 'filter-bar chips', 'data-filter-bar': '' }, [
    pill ? el('span', { class: 'chip on event-mode-pill', 'data-event-mode-pill': '' }, [
      pill,
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-event-mode-leave': '', 'aria-label': S.w44fc.leaveEventMode, onclick: () => { setEventFilter(s, null); io.save(); io.redraw() } }, ['×']),
    ]) : null,
    pill && io.web && !s.eventBubbleOff ? everyoneChip(io) : null,   // wave45 event-bubble
    ...pinned.map((f) => el('button', { type: 'button', class: 'chip on', 'data-pinned-filter': f.id, onclick: () => { applySavedFilter(s, f.id); io.save(); io.redraw() } }, [f.name])),
  ])
}

/** Wave 45 event-bubble: "Everyone" lifts the Web's narrowing to the event's people (pressed = lifted; the other screens stay narrowed). */
function everyoneChip(io: FilterBarIo): HTMLElement {
  const lifted = io.state().uiRings?.eventEveryone === true
  return el('button', { type: 'button', class: 'chip' + (lifted ? ' on' : ' tw-off'), 'aria-pressed': String(lifted), 'data-event-everyone': '',
    onclick: () => { setEveryone(io.state(), !lifted); io.save(); io.redraw() } }, [S.w45eb.everyone])
}

/** Inserts the bar before the screen's `.scroll`, on the screens that carry a filter row (the caller decides which). */
export function mountFilterBar(host: HTMLElement, io: FilterBarIo): void {
  host.querySelector('[data-filter-bar]')?.remove()
  const bar = filterBar(io)
  let at = host.querySelector('.scroll')
  while (at && at.parentElement !== host) at = at.parentElement   // the screen's direct child that holds the scroller (the Web nests it beside its sidebar)
  if (bar && at) at.before(bar)
}

/** The event page's toggle: on = this event's people only on Web, Chat, Resources and Ask. Struck through when off (P2). */
export function eventModeToggle(io: FilterBarIo, eventId: string): HTMLElement {
  const on = eventFilterOf(io.state()) === eventId
  return el('button', { type: 'button', class: 'chip' + (on ? ' on' : ' tw-off'), role: 'switch', 'aria-checked': String(on), 'aria-pressed': String(on), 'data-event-mode-toggle': '',
    onclick: () => { setEventFilter(io.state(), on ? null : eventId); io.save(); io.redraw() } }, [S.w44fc.eventMode])
}

/** Filter sheet > Advanced: save the current in/out chips under a name; every saved state lists its chips, Apply and Pin. */
export function savedFiltersSection(io: FilterBarIo, label: (chip: string) => string): HTMLElement {
  const s = io.state()
  const name = el('input', { class: 'field', type: 'text', maxlength: '40', placeholder: S.w44fc.saveName, 'aria-label': S.w44fc.saveName, 'data-saved-filter-name': '' }) as HTMLInputElement
  const save = (): void => { if (saveFilterState(s, name.value)) { io.save(); io.redraw() } else name.focus() }
  name.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') save() })
  return el('details', { class: 'saved-filters', 'data-saved-filters': '', ...(s.savedFilters?.length ? { open: '' } : {}) }, [
    el('summary', {}, [S.w44fc.savedTitle]),
    ...(s.savedFilters ?? []).map((f) => el('div', { class: 'saved-filter', 'data-saved-filter': f.id }, [
      el('b', {}, [f.name]),
      el('span', { class: 'meta' }, [[...f.show.map((c) => S.tagFilterOn(label(c))), ...f.hide.map((c) => S.filterHidden(label(c)))].join(', ')]),
      el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-saved-filter-apply': f.id, onclick: () => { applySavedFilter(s, f.id); io.save(); io.redraw() } }, [S.w44fc.apply]),
      el('button', { type: 'button', class: 'chip' + (f.pinned ? ' on' : ' tw-off'), 'aria-pressed': String(f.pinned === true), 'data-saved-filter-pin': f.id, onclick: () => { pinSavedFilter(s, f.id, !f.pinned); io.save(); io.redraw() } }, [S.w44fc.pin]),
    ])),
    el('div', { class: 'row' }, [name, el('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'data-saved-filter-save': '', onclick: save }, [S.w44fc.save])]),
  ])
}
