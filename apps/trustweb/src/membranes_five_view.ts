// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25 (membranes_five.ts): the pages and bits the Membranes screen opens: the small card, the "everyone beyond the five" list, the tag filter chip. */
import { el } from '../../demo/src/ui/dom'
import type { ColourTag } from './colour_tags'
import { Ring } from './model'
import type { Person } from './model'
import { S } from './strings'

export interface SmallCardDeps {
  person: Person
  zone: string
  tags: readonly ColourTag[]
  /** The defined tags this person lacks; a "+ tag" button offers them (empty: it says none are defined). */
  addableTags?: readonly ColourTag[]
  onAddTag?: (id: string) => void
  shared: number
  /** Extended: expands this card in place (aria-expanded), a second press collapses it. */
  onOpen: () => void
  expanded?: boolean
  /** The name heading to show (editable); default a plain one. */
  heading?: HTMLElement
  /** The rest of the person's card, drawn under the small card while it is expanded. */
  more?: readonly (Node | null)[]
  onPin: () => void
  /** The QR code of this person: top right, small and extended alike. */
  onQr?: () => void
  /** The zones the person can move to; the ring chip and the "visible to" line open them. */
  rings?: readonly { ring: Ring; label: string; current: boolean }[]
  onRing?: (ring: Ring) => void
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

/** A compact page: name with the pin and QR at the right edge, the chat row, zone (press to move), tags as buttons (+ tag), what we share, Extended; expanded: the rest of the card below. */
export function smallCard(d: SmallCardDeps): HTMLElement {
  const { person: p } = d
  const picker = el('div', { class: 'chips ring-pick', hidden: true, 'data-ring-pick': p.id, role: 'group', 'aria-label': S.cardRingPickTitle }, (d.rings ?? []).map((r) =>
    el('button', { class: 'chip', 'data-ring-choice': r.ring, 'aria-pressed': String(r.current), onclick: () => d.onRing?.(r.ring) }, [r.label])))
  const togglePicker = (): void => { picker.hidden = !picker.hidden }
  const tagPicker = el('div', { class: 'chips', hidden: true, 'data-tag-pick': p.id }, d.addableTags?.length
    ? d.addableTags.map((t) => el('button', { class: 'chip', 'data-tag-choice': t.id, onclick: () => d.onAddTag?.(t.id) }, [t.label ?? t.id]))
    : [el('span', { class: 'meta' }, [S.cardTagsUndefined])])
  return el('div', { class: 'small-card', 'data-small-card': p.id }, [
    el('div', { class: 'card-name-row' }, [d.heading ?? el('h3', {}, [p.name]), pinButton(p, d.onPin),
      d.onQr ? el('button', { class: 'btn btn-ghost btn-sm', 'data-card-qr': p.id, 'aria-label': S.qrShowAria, title: S.qrShowAria, onclick: d.onQr }, [S.qrPageTitle]) : null]),
    el('div', { 'data-chat-row': '' }, [d.chat]),
    el('button', { class: 'card-zone', 'data-card-zone': '', 'aria-expanded': 'false', title: S.cardRingChange(d.zone), onclick: togglePicker }, [d.zone]),
    picker,
    el('div', { class: 'chips', 'data-card-tags': '' }, [
      ...(d.tags.length
        ? d.tags.map((t) => el('button', { class: 'chip', 'data-card-tag': t.id, onclick: () => d.onTag(t.id) }, [t.label ?? t.id]))
        : [el('span', { class: 'meta' }, [S.cardTagsNone])]),
      el('button', { class: 'chip', 'data-tag-add': p.id, 'aria-label': S.cardTagAddAria, onclick: () => { tagPicker.hidden = !tagPicker.hidden } }, [S.cardTagAdd]),
    ]),
    tagPicker,
    el('button', { class: 'card-shares meta', 'data-card-shares': '', title: S.cardRingChange(d.zone), onclick: togglePicker }, [p.ring === Ring.Unsorted ? S.cardSharesUnplaced : S.cardShares(d.shared, d.zone)]),
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
