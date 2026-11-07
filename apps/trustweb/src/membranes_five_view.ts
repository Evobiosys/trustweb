// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25 (membranes_five.ts): the pages and bits the Membranes screen opens: the small card, the "everyone beyond the five" list, the tag filter chip. */
import { el } from '../../demo/src/ui/dom'
import type { ColourTag } from './colour_tags'
import { Ring } from './model'
import type { Person } from './model'
import { S } from './strings'
import { andSep, type VisibleCategory } from './zone_visibility'
import { editKey } from './tap_edit'
import { ROW_VIEW, rowStep, type RowEvent } from './ring_hover'
import { HELLO_NAME_MAX } from './hello'
import { RESOURCE_TITLE_MAX } from './resource_edit'

export interface SmallCardDeps {
  person: Person
  zone: string
  tags: readonly ColourTag[]
  /** The defined tags this person lacks; a "+ tag" button offers them (empty: it says none are defined). */
  addableTags?: readonly ColourTag[]
  onAddTag?: (id: string) => void
  /** What the person sees of my resources, by granting category (zone_visibility.ts visibleVia). */
  visible: { count: number; categories: readonly VisibleCategory[] }
  /** Kind label of one resource for the inline list ("typed", "recorded"). */
  kindOf: (item: VisibleCategory['items'][number]) => string
  /** Wave 30: a resource's title was edited on the card (saved by the caller, which redraws). */
  onRenameResource?: (id: string, next: string) => void
  /** Wave 30: a title typed in a category's "+ add" line (the caller adds it with that category's audience and redraws). */
  onAddResource?: (category: VisibleCategory, title: string) => void
  /** "Open in My Resources" under an expanded category. */
  onOpenResources: (category: VisibleCategory) => void
  /** Extended: expands this card in place (aria-expanded), a second press collapses it. */
  onOpen: () => void
  expanded?: boolean
  /** The name heading to show (editable); default a plain one. */
  heading?: HTMLElement
  /** The rest of the person's card, drawn under the small card while it is expanded. */
  more?: readonly (Node | null)[]
  onPin: () => void
  /** The picture slot (card_pages_view.ts cardFace): the button left of the name, its menu under the name row. Absent: none. */
  face?: { button: HTMLElement; menu: HTMLElement }
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

/** The category list open on a card, kept across the redraw an edit causes: [person id, category key]. */
let openShares: [string, string] | null = null

/** An inline one-line editor: Enter or the check saves, Esc or the cross cancels; `done(typed)` runs once, `typed` null on cancel. */
function inlineEdit(aria: string, value: string, attr: string, done: (typed: string | null) => void): HTMLElement {
  const input = el('input', { class: 'field tap-edit-input', 'aria-label': aria, maxlength: String(RESOURCE_TITLE_MAX), [attr]: '' })
  input.value = value
  let finished = false
  const finish = (how: 'save' | 'cancel'): void => { if (finished) return; finished = true; done(how === 'save' ? input.value : null) }
  input.addEventListener('keydown', (e) => { const a = editKey(e.key); if (a) { e.stopPropagation(); finish(a) } })
  const row = el('span', { class: 'card-res-edit' }, [input,
    el('button', { class: 'card-res-btn', 'aria-label': S.cardResourceSave, onclick: () => finish('save') }, ['✓']),
    el('button', { class: 'card-res-btn', 'aria-label': S.cardResourceCancel, onclick: () => finish('cancel') }, ['✕'])])
  queueMicrotask(() => { input.focus(); input.select() })
  return row
}

/** "N resources are visible to them based on X, Y, and Z": each category presses open its resources inline (title with a pencil, kind) with a "+ add" line and a link into My Resources. The line itself does nothing. */
function sharesLine(d: SmallCardDeps): HTMLElement {
  const { count, categories } = d.visible
  const list = el('div', { class: 'card-shares-list', 'data-card-shares-list': '', hidden: true })
  const draw = (): void => {
    const c = openShares?.[0] === d.person.id ? categories.find((x) => x.key === openShares?.[1]) : undefined
    box.querySelectorAll('[data-card-shares-cat]').forEach((b) => b.setAttribute('aria-expanded', String(b.getAttribute('data-card-shares-cat') === c?.key)))
    list.hidden = !c
    list.replaceChildren(...(!c ? [] : [
      ...c.items.map((i) => itemRow(i)),
      addRow(c),
      el('button', { class: 'btn btn-ghost btn-sm', 'data-card-shares-open': c.key, onclick: () => d.onOpenResources(c) }, [S.cardSharesOpen]),
    ]))
  }
  const itemRow = (i: VisibleCategory['items'][number]): HTMLElement => {
    const row = el('div', { class: 'meta card-res-row', 'data-card-shares-item': i.id })
    const show = (): void => row.replaceChildren(
      el('span', {}, [i.text, ' · ', d.kindOf(i)]),
      ...(d.onRenameResource ? [el('button', { class: 'card-res-btn', 'data-card-shares-edit': i.id, 'aria-label': S.cardResourceEdit, title: S.cardResourceEdit, onclick: edit }, ['✎'])] : []),
    )
    const edit = (): void => row.replaceChildren(inlineEdit(S.cardResourceEdit, i.text, 'data-card-shares-input', (typed) => {
      if (typed !== null) d.onRenameResource?.(i.id, typed)
      else show()
    }))
    show()
    return row
  }
  const addRow = (c: VisibleCategory): HTMLElement => {
    const row = el('div', { class: 'meta card-res-row', 'data-card-shares-add-row': c.key })
    const show = (): void => row.replaceChildren(el('button', { class: 'card-res-add', 'data-card-shares-add': c.key, onclick: edit }, [S.cardResourceAdd]))
    const edit = (): void => row.replaceChildren(inlineEdit(S.cardResourceAddAria, '', 'data-card-shares-add-input', (typed) => {
      if (typed !== null && typed.trim()) d.onAddResource?.(c, typed)
      else show()
    }))
    show()
    return row
  }
  const toggle = (c: VisibleCategory): void => {
    openShares = openShares?.[0] === d.person.id && openShares[1] === c.key ? null : [d.person.id, c.key]
    draw()
  }
  const names: (Node | string)[] = []
  categories.forEach((c, i) => {
    const btn = el('button', { class: 'card-shares-cat', 'data-card-shares-cat': c.key, 'aria-expanded': 'false', onclick: () => toggle(c) }, [c.label])
    names.push(andSep(i, categories.length), btn)
  })
  const box = el('div', { class: 'card-shares meta', 'data-card-shares': '' }, [
    d.person.ring === Ring.Unsorted ? S.cardSharesUnplaced : count === 0 ? S.cardShares(0, d.zone) : S.cardSharesVia(count, ''),
    ...(d.person.ring === Ring.Unsorted || count === 0 ? [] : names),
  ])
  draw()
  return el('div', {}, [box, list])
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
    el('div', { class: 'card-name-row' }, [d.face?.button, d.heading ?? el('h3', {}, [p.name]), pinButton(p, d.onPin),
      d.onQr ? el('button', { class: 'btn btn-ghost btn-sm', 'data-card-qr': p.id, 'aria-label': S.qrShowAria, title: S.qrShowAria, onclick: d.onQr }, [S.qrPageTitle]) : null]),
    d.face?.menu,
    el('div', { 'data-chat-row': '' }, [d.chat]),
    el('button', { class: 'card-zone', 'data-card-zone': '', 'aria-expanded': 'false', title: S.cardRingChange(d.zone), onclick: togglePicker }, [d.zone]),
    picker,
    sharesLine(d),
    el('div', { class: 'chips', 'data-card-tags': '' }, [
      ...(d.tags.length
        ? d.tags.map((t) => el('button', { class: 'chip', 'data-card-tag': t.id, onclick: () => d.onTag(t.id) }, [t.label ?? t.id]))
        : [el('span', { class: 'meta' }, [S.cardTagsNone])]),
      el('button', { class: 'chip', 'data-tag-add': p.id, 'aria-label': S.cardTagAddAria, onclick: () => { tagPicker.hidden = !tagPicker.hidden } }, [S.cardTagAdd]),
    ]),
    tagPicker,
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

/** The tags of one zone: chips with an x, then "+ tag" turning into an input that suggests the defined tags (Enter adds, a new name defines one). */
export function zoneTagsRow(zone: string, tags: readonly ColourTag[], suggest: (text: string) => readonly ColourTag[], onAdd: (name: string) => void, onRemove: (id: string) => void): HTMLElement {
  const name = (t: ColourTag): string => t.label ?? t.id
  const list = el('datalist', { id: 'zone-tag-options-' + zone })
  const input = el('input', { type: 'text', class: 'input', hidden: true, 'data-zone-tag-input': zone, list: list.id, placeholder: S.zoneTagInputPlaceholder, 'aria-label': S.zoneTagInputAria, autocomplete: 'off' }) as HTMLInputElement
  const fill = (): void => { list.replaceChildren(...suggest(input.value).map((t) => el('option', { value: name(t) }))) }
  input.addEventListener('input', fill)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); onAdd(input.value) } })
  return el('div', { class: 'chips', 'data-zone-tags': zone }, [
    ...(tags.length
      ? tags.map((t) => el('span', { class: 'chip', 'data-zone-tag': t.id }, [name(t), el('button', { class: 'btn btn-ghost btn-sm', 'data-zone-tag-remove': t.id, 'aria-label': S.zoneTagRemoveAria(name(t)), onclick: () => onRemove(t.id) }, ['×'])]))
      : [el('span', { class: 'meta' }, [S.cardTagsNone])]),
    el('button', { class: 'chip', 'data-zone-tag-add': zone, 'aria-label': S.cardTagAddAria, onclick: () => { input.hidden = false; fill(); input.focus() } }, [S.cardTagAdd]),
    input, list,
  ])
}

/** The names of everyone in one membrane, shown while hovering or holding its diamond. */
export function membraneAll(zone: string, people: readonly Person[]): HTMLElement {
  return el('div', { class: 'membrane-all', 'data-membrane-all': '', role: 'status' }, [
    el('b', {}, [S.membraneAllTitle(zone)]),
    el('span', {}, [people.map((p) => p.name).join(', ')]),
  ])
}

export interface RingCardDeps {
  /** A name was pressed: open that person. */
  onOpen: (id: string) => void
  /** A name was changed (already stored on `p` by the caller); the card stays open and shows it. */
  onRename: (p: Person, next: string) => void
  /** The archive box was pressed: the caller archives `p` (Settings > Archived people restores) and redraws. */
  onArchive: (p: Person) => void
}

const ARCHIVE_BOX = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/></svg>'

/** Wave 30: the interactive "Everyone in <ring>" card: each name opens its person; the pencil turns the name into an input with save, cancel and archive (Enter saves, Esc cancels, blur changes nothing). */
export function ringCard(zone: string, people: readonly Person[], d: RingCardDeps): HTMLElement {
  const row = (p: Person): HTMLElement => {
    const host = el('span', { class: 'ring-card-row', 'data-ring-card-row': p.id })
    let state = ROW_VIEW
    const show = (): void => host.replaceChildren(
      el('button', { class: 'ring-card-name', 'data-ring-card-open': p.id, onclick: () => d.onOpen(p.id) }, [p.name]),
      el('button', { class: 'ring-card-edit', 'data-ring-card-edit': p.id, 'aria-label': S.ringCardEditName, title: S.ringCardEditName, onclick: edit }, ['✎']),
    )
    const edit = (): void => {
      state = rowStep(state, { type: 'open' })
      const input = el('input', { class: 'field tap-edit-input', 'aria-label': S.zoneRename(p.name), maxlength: String(HELLO_NAME_MAX), 'data-ring-card-input': p.id })
      input.value = p.name
      const end = (e: RowEvent): void => {
        state = rowStep(state, e)
        if (state.editing) return
        const r = state.result
        if (r?.kind === 'commit') d.onRename(p, r.name)
        if (r?.kind === 'archive') { d.onArchive(p); return }
        show()
      }
      const accept = (): void => end({ type: 'accept', current: p.name, typed: input.value })
      input.addEventListener('keydown', (e) => { const a = editKey(e.key); if (a) { e.stopPropagation(); e.preventDefault(); if (a === 'save') accept(); else end({ type: 'cancel' }) } })
      const btn = (cls: string, attr: string, label: string, kids: (string | Node)[], on: () => void): HTMLElement =>
        el('button', { class: 'ring-card-btn ' + cls, [attr]: p.id, 'aria-label': label, title: label, onclick: on }, kids)
      const box = btn('ring-card-archive', 'data-ring-card-archive', S.ringCardArchive, [], () => end({ type: 'archive' }))
      box.innerHTML = ARCHIVE_BOX
      host.replaceChildren(
        input,
        btn('ring-card-ok', 'data-ring-card-accept', S.ringCardAccept, ['✓'], accept),
        btn('ring-card-no', 'data-ring-card-cancel', S.ringCardCancel, ['✕'], () => end({ type: 'cancel' })),
        box,
      )
      input.focus(); input.select()
    }
    show()
    return host
  }
  return el('div', { class: 'ring-card', 'data-ring-card': '', role: 'dialog', 'aria-label': S.membraneAllTitle(zone), onpointerdown: (e: Event) => { e.stopPropagation() }, onclick: (e: Event) => { e.stopPropagation() } }, [
    el('b', {}, [S.membraneAllTitle(zone)]),
    ...people.map(row),
  ])
}
