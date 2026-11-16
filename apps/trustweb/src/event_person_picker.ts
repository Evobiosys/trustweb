// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 event-roles: "Identify a person" on an event page. Type a name: matches from my web first, and as the LAST row
 * "Add '<typed>' as a new person" when nobody carries exactly that name. One picker for the roles rows and the attendees section
 * (other event views import it too). The logic sits in event_roles.ts (identifyRows, identifyPerson).
 */
import { el } from '../../demo/src/ui/dom'
import { matchPeople, tagPerson } from './events'
import { identifyPerson } from './event_roles'
export { NEW_FROM_EVENT_RING, identifyPerson } from './event_roles'
import type { AppState, Person, Ring } from './model'
import type { ColourTag } from './colour_tags'
import { guestRows } from './event_editor'
import { S } from './strings'

export type IdentifyRow = Person | { create: string }

/** Matches by name first; the LAST row offers to add the typed name as a new person unless a person already carries exactly that name. People in `exclude` are not offered but still count as an exact match (no second card made). Deleted people are not offered. */
export function identifyRows(people: readonly Person[], query: string, exclude: readonly string[] = []): IdentifyRow[] {
  const live = people.filter((p) => p.deleted_at === undefined)
  if (query.trim().startsWith('#')) return []   // wave 44: "#" names a group (tag rows, guestRows), never a person
  const q = query.trim().replace(/^@/, '').trim()   // wave 44 (item 11): "@" = people only, as in the other person boxes
  const hits: IdentifyRow[] = matchPeople(live.filter((p) => !exclude.includes(p.id)), q)
  if (!q || live.some((p) => p.name.trim().toLowerCase() === q.toLowerCase())) return hits
  return [...hits, { create: q }]
}

/** What Enter does: the first row (the best match, else the add-new row), so a partial name never makes a second card. Undefined: nothing typed. */
export function pickOnEnter(people: readonly Person[], query: string, exclude: readonly string[] = []): { id: string } | { create: string } | undefined {
  const first = query.trim() ? identifyRows(people, query, exclude)[0] : undefined
  if (!first) return undefined
  return 'create' in first ? { create: first.create } : { id: first.id }
}

export interface PickerHooks {
  state: () => AppState
  save: () => void
  newId: () => string
}

export interface PickerOptions {
  /** Person ids not offered (already in this list). */
  exclude: readonly string[]
  /** A person was chosen or made. `created` = a new person card was made. */
  onPick: (personId: string, created: boolean) => void
  /** The text inside a person's chip (default: the name). */
  renderPerson?: (p: Person) => HTMLElement
  /** Called on every drawn person chip (press semantics, drag). */
  decorate?: (chip: HTMLElement, p: Person) => void
  /** Tag a typed existing person with the event too (the attendees picker). */
  tag?: boolean
  /** Open hook: ask which ring a new person gets. Unused by default (NEW_FROM_EVENT_RING). */
  pickRing?: () => Promise<Ring>
  /** No rows until something is typed (the three role rows; P3: a simple surface). */
  quietWhenEmpty?: boolean
  placeholder?: string
  ariaLabel?: string
  /** Data attribute names, so each caller keeps its own selectors. */
  inputAttr?: string
  personAttr?: string
  /** Wave 44 (item 11): "#group" (or plain text) also offers the tags; a tag row adds all its people at once. */
  tags?: () => readonly ColourTag[]
  onPickMany?: (personIds: string[]) => void
  /** Wave 44: what the add-new row does instead of identifyPerson (a free name, or a card that is not tagged with an unsaved event). */
  onCreate?: (name: string) => void
}

/** The search box with its rows below. The caller redraws after onPick. */
export function eventPersonPicker(h: PickerHooks, eventId: string, o: PickerOptions): HTMLElement {
  const input = el('input', { class: 'field', placeholder: o.placeholder ?? S.eventsTagSearch, 'aria-label': o.ariaLabel ?? S.eventsIdentify, [o.inputAttr ?? 'data-person-search']: '' })
  const rows = el('div', { class: 'chips' })
  const make = async (name: string): Promise<void> => {
    if (o.onCreate) { o.onCreate(name); return }
    const ring = await o.pickRing?.()
    const done = identifyPerson(h.state(), eventId, name, { id: h.newId(), now: Date.now(), tagWith: tagPerson, ...(o.tag ? { tag: true } : {}), ...(ring ? { ring } : {}) })
    if (!done) return
    h.save()
    o.onPick(done.personId, done.created)
  }
  const tagRows = (): HTMLElement[] => (o.tags && o.onPickMany && input.value.trim()
    ? guestRows(input.value, h.state().people, o.tags(), o.exclude).flatMap((r) => (r.kind === 'tag' ? [el('button', { class: 'chip picker-tag', type: 'button', 'data-person-tag': r.id, onclick: () => o.onPickMany?.(r.ids) }, [S.ev44.addTag(r.label, r.ids.length)])] : []))
    : [])
  const draw = (): void => {
    rows.replaceChildren(...tagRows(), ...(o.quietWhenEmpty && !input.value.trim() ? [] : identifyRows(h.state().people, input.value, o.exclude)).map((r) => {
      if ('create' in r) {
        return el('button', { class: 'chip picker-create', 'data-person-create': r.create, onclick: () => { void make(r.create) } }, [S.eventsAddNew(r.create)])
      }
      const chip = el('button', { class: 'chip', [o.personAttr ?? 'data-person-pick']: r.id, onclick: () => o.onPick(r.id, false) }, [o.renderPerson ? o.renderPerson(r) : r.name])
      o.decorate?.(chip, r)
      return chip
    }))
  }
  input.addEventListener('input', draw)
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    const first = pickOnEnter(h.state().people, input.value, o.exclude)
    if (!first) { const tag = rows.querySelector<HTMLButtonElement>('[data-person-tag]'); if (tag) { e.preventDefault(); tag.click() } return }
    e.preventDefault()
    if ('create' in first) void make(first.create); else o.onPick(first.id, false)
  })
  draw()
  return el('div', {}, [input, rows])
}
