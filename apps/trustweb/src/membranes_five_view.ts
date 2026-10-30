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
  onOpen: () => void
  onFavourite: () => void
  /** A tag button: the Membranes then show only the people with it. */
  onTag: (id: string) => void
}

/** The star toggle, on the small card and on the full person page. */
export function favouriteButton(p: Pick<Person, 'name' | 'favourite'>, onToggle: () => void): HTMLElement {
  const on = p.favourite === true
  return el('button', { class: 'btn btn-ghost btn-sm' + (on ? ' on' : ''), 'data-favourite': '', 'aria-pressed': String(on), 'aria-label': S.cardFavouriteAria(on, p.name), onclick: onToggle }, [on ? '★' : '☆', ' ', S.cardFavourite])
}

/** A compact page: name, zone, tags as buttons, what we share, Open. */
export function smallCard(d: SmallCardDeps): HTMLElement {
  const { person: p } = d
  return el('div', { class: 'small-card', 'data-small-card': p.id }, [
    el('h3', {}, [p.name]),
    el('p', { class: 'meta', 'data-card-zone': '' }, [d.zone]),
    el('div', { class: 'chips', 'data-card-tags': '' }, d.tags.length
      ? d.tags.map((t) => el('button', { class: 'chip', 'data-card-tag': t.id, onclick: () => d.onTag(t.id) }, [t.label ?? t.id]))
      : [el('span', { class: 'meta' }, [S.cardTagsNone])]),
    el('p', { class: 'meta', 'data-card-shares': '' }, [S.cardShares(d.shared, d.zone)]),
    el('div', { class: 'card-actions' }, [
      favouriteButton(p, d.onFavourite),
      el('button', { class: 'btn btn-electric btn-sm', 'data-card-open': p.id, onclick: d.onOpen }, [S.membraneCardOpen]),
    ]),
  ])
}

/** The flat list of the people of one membrane beyond the shown ones. */
export function restList(rest: readonly Person[], onPick: (id: string) => void): HTMLElement {
  return el('div', { class: 'membrane-rest', 'data-membrane-rest': '' }, rest.length
    ? rest.map((p) => el('button', { class: 'conn-row btn btn-ghost', 'data-rest-person': p.id, onclick: () => onPick(p.id) }, [p.name]))
    : [el('p', { class: 'meta' }, [S.membraneRestNone])])
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
