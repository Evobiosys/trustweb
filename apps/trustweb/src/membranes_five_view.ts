// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25 (membranes_five.ts): the pages and bits the Membranes screen opens: the small card, the "everyone beyond the five" list, the tag filter chip. */
import { el } from '../../demo/src/ui/dom'
import type { ColourTag } from './colour_tags'
import type { Person } from './model'
import { S } from './strings'

export interface SmallCardDeps {
  person: Person
  zone: string
  tags: readonly ColourTag[]
  shared: number
  /** Extended: expands this card in place (aria-expanded), a second press collapses it. */
  onOpen: () => void
  expanded?: boolean
  /** The name heading to show (editable); default a plain one. */
  heading?: HTMLElement
  /** The rest of the person's card, drawn under the small card while it is expanded. */
  more?: readonly (Node | null)[]
  onPin: () => void
  /** The primary Chat button of the full card. */
  chat: HTMLElement
  /** A tag button: the Membranes then show only the people with it. */
  onTag: (id: string) => void
}

/** The pin toggle, on the small card and on the full person page. */
export function pinButton(p: Pick<Person, 'name' | 'pinned'>, onToggle: () => void): HTMLElement {
  const on = p.pinned === true
  return el('button', { class: 'btn btn-ghost btn-sm' + (on ? ' on' : ''), 'data-pin': '', 'aria-pressed': String(on), 'aria-label': S.cardPinAria(on, p.name), onclick: onToggle }, [on ? '📌' : '📍', ' ', S.cardPin])
}

/** A compact page: name with the pin at the right edge, the chat row, zone, tags as buttons, what we share, Extended; expanded: the rest of the card below. */
export function smallCard(d: SmallCardDeps): HTMLElement {
  const { person: p } = d
  return el('div', { class: 'small-card', 'data-small-card': p.id }, [
    el('div', { class: 'card-name-row' }, [d.heading ?? el('h3', {}, [p.name]), pinButton(p, d.onPin)]),
    el('div', { 'data-chat-row': '' }, [d.chat]),
    el('p', { class: 'meta', 'data-card-zone': '' }, [d.zone]),
    el('div', { class: 'chips', 'data-card-tags': '' }, d.tags.length
      ? d.tags.map((t) => el('button', { class: 'chip', 'data-card-tag': t.id, onclick: () => d.onTag(t.id) }, [t.label ?? t.id]))
      : [el('span', { class: 'meta' }, [S.cardTagsNone])]),
    el('p', { class: 'meta', 'data-card-shares': '' }, [S.cardShares(d.shared, d.zone)]),
    el('div', { class: 'card-actions' }, [
      el('button', { class: 'btn btn-electric btn-sm', 'data-card-open': p.id, 'aria-expanded': String(d.expanded === true), onclick: d.onOpen }, [d.expanded ? S.membraneCardClose : S.membraneCardOpen]),
    ]),
    ...(d.expanded ? [el('div', { class: 'card-more', 'data-card-more': p.id }, d.more?.filter((n): n is Node => n !== null) ?? [])] : []),
  ])
}

/** The flat list of the whole zone; a dashed last row, and a press on the empty space below it, adds someone to the zone. */
export function restList(people: readonly Person[], zone: string, onPick: (id: string) => void, onAdd: () => void): HTMLElement {
  const box = el('div', {
    class: 'membrane-rest', 'data-membrane-rest': '',
    onclick: (e: Event) => { if (e.target === box) onAdd() },
  }, [
    ...(people.length ? people.map((p) => el('button', { class: 'conn-row btn btn-ghost', 'data-rest-person': p.id, onclick: () => onPick(p.id) }, [p.name])) : [el('p', { class: 'meta' }, [S.membraneRestNone])]),
    el('button', { class: 'conn-row btn btn-ghost rest-add', 'data-rest-add': '', onclick: onAdd }, [S.membraneAddTo(zone)]),
  ])
  return box
}

/** The strip at the top of the Membranes while a tag filter is on; the X clears it. */
export function tagFilterChip(label: string, onClear: () => void): HTMLElement {
  return el('div', { class: 'chips tag-filter', 'data-tag-filter': '' }, [
    el('span', { class: 'chip' }, [S.tagFilterOn(label), el('button', { class: 'btn btn-ghost btn-sm', 'data-tag-filter-clear': '', 'aria-label': S.tagFilterClear, onclick: onClear }, ['×'])]),
  ])
}

/** The names of everyone in one membrane, shown while hovering or holding its diamond. */
export function membraneAll(zone: string, people: readonly Person[]): HTMLElement {
  return el('div', { class: 'membrane-all', 'data-membrane-all': '', role: 'status' }, [
    el('b', {}, [S.membraneAllTitle(zone)]),
    el('span', {}, [people.map((p) => p.name).join(', ')]),
  ])
}
