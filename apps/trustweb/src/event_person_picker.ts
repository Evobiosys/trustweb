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
import { S } from './strings'

export type IdentifyRow = Person | { create: string }

/** Matches by name first; the LAST row offers to add the typed name as a new person unless a person already carries exactly that name. People in `exclude` are not offered but still count as an exact match (no second card made). Deleted people are not offered. */
export function identifyRows(people: readonly Person[], query: string, exclude: readonly string[] = []): IdentifyRow[] {
  const live = people.filter((p) => p.deleted_at === undefined)
  const q = query.trim()
  const hits: IdentifyRow[] = matchPeople(live.filter((p) => !exclude.includes(p.id)), q)
  if (!q || live.some((p) => p.name.trim().toLowerCase() === q.toLowerCase())) return hits
  return [...hits, { create: q }]
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
  placeholder?: string
  ariaLabel?: string
  /** Data attribute names, so each caller keeps its own selectors. */
  inputAttr?: string
  personAttr?: string
}

/** The search box with its rows below. The caller redraws after onPick. */
export function eventPersonPicker(h: PickerHooks, eventId: string, o: PickerOptions): HTMLElement {
  const input = el('input', { class: 'field', placeholder: o.placeholder ?? S.eventsTagSearch, 'aria-label': o.ariaLabel ?? S.eventsIdentify, [o.inputAttr ?? 'data-person-search']: '' })
  const rows = el('div', { class: 'chips' })
  const make = async (name: string): Promise<void> => {
    const ring = await o.pickRing?.()
    const done = identifyPerson(h.state(), eventId, name, { id: h.newId(), now: Date.now(), tagWith: tagPerson, ...(o.tag ? { tag: true } : {}), ...(ring ? { ring } : {}) })
    if (!done) return
    h.save()
    o.onPick(done.personId, done.created)
  }
  const draw = (): void => {
    rows.replaceChildren(...identifyRows(h.state().people, input.value, o.exclude).map((r) => {
      if ('create' in r) {
        return el('button', { class: 'chip picker-create', 'data-person-create': r.create, onclick: () => { void make(r.create) } }, [S.eventsAddNew(r.create)])
      }
      const chip = el('button', { class: 'chip', [o.personAttr ?? 'data-person-pick']: r.id, onclick: () => o.onPick(r.id, false) }, [o.renderPerson ? o.renderPerson(r) : r.name])
      o.decorate?.(chip, r)
      return chip
    }))
  }
  input.addEventListener('input', draw)
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()) { e.preventDefault(); void make(input.value) } })
  draw()
  return el('div', {}, [input, rows])
}
