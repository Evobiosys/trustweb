// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 event-roles: the ROLES section of the event page. Collapsed: one line "Organized by A, B" and a V expander. A press on the
 * line expands (P1); a long press or right click expands and focuses the first editor. Expanded: Organizers, Hosts and Technical support,
 * each a chip list with the shared "Identify a person" picker (event_person_picker.ts).
 */
import { el } from '../../demo/src/ui/dom'
import { contextPress } from './context_press'
import { eventOrganizers, roleLabels, rolesSummary, setRoles } from './event_roles'
import type { RoleKey, Roles } from './event_roles'
import { eventPersonPicker } from './event_person_picker'
import type { PickerHooks } from './event_person_picker'
import type { Person, TwEvent } from './model'
import { S } from './strings'

export interface RolesHooks extends PickerHooks {
  redraw: () => void
  curatorPerson: (personId: string) => void
}

/** Which event's roles stand open; one at a time, kept across redraws. */
let openFor: string | undefined
/** The next draw puts the cursor in the first editor (set by a long press). */
let focusNext = false

const ROWS: readonly { key: RoleKey; label: string }[] = [
  { key: 'organizers', label: S.eventsRoleOrganizers },
  { key: 'hosts', label: S.eventsRoleHosts },
  { key: 'techSupport', label: S.eventsRoleTech },
]

function current(ev: TwEvent, key: RoleKey): string[] {
  return key === 'organizers' ? eventOrganizers(ev) : ev[key] ?? []
}

function roleRow(h: RolesHooks, ev: TwEvent, key: RoleKey, label: string): HTMLElement {
  const refs = current(ev, key)
  const change = (next: string[]): void => { setRoles(h.state(), ev, { [key]: next } as Roles); h.save(); h.redraw() }
  const chips = refs.map((ref, i) => {
    const person: Person | undefined = h.state().people.find((p) => p.id === ref)
    const name = roleLabels(h.state(), [ref])[0]
    return el('span', { class: 'chip', 'data-role-chip': ref }, [
      el('button', { class: 'lnk', type: 'button', onclick: () => { if (person) h.curatorPerson(person.id) } }, [name]),
      ' ',
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-label': S.eventsRoleRemove(name), onclick: () => change(refs.filter((_, j) => j !== i)) }, ['×']),
    ])
  })
  const picker = eventPersonPicker(h, ev.id, {
    exclude: refs, ariaLabel: label, placeholder: S.eventsTagSearch, inputAttr: 'data-role-search', personAttr: 'data-role-pick',
    onPick: (id) => change([...refs, id]),
  })
  return el('div', { class: 'role-row', 'data-role': key }, [
    el('label', { class: 'meta' }, [label]),
    chips.length ? el('div', { class: 'role-chips' }, chips) : null,
    picker,
    key === 'techSupport' ? el('p', { class: 'meta', 'data-role-tech-hint': '' }, [S.eventsRoleTechHint]) : null,
  ])
}

export function rolesSection(h: RolesHooks, ev: TwEvent): HTMLElement {
  const open = openFor === ev.id
  const set = (on: boolean, focus = false): void => { openFor = on ? ev.id : undefined; focusNext = on && focus; h.redraw() }
  const text = rolesSummary(h.state(), ev)
  const summary = el('button', { class: 'roles-summary' + (text ? '' : ' empty'), type: 'button', 'data-event-roles-line': '', 'aria-expanded': String(open), onclick: () => set(!open) }, [text ? S.eventsOrganizedBy(text) : S.eventsOrganizerPlaceholder])
  contextPress(summary, () => set(true, true))
  const toggle = el('button', { class: 'tw-expander', type: 'button', 'data-event-roles-toggle': '', 'aria-expanded': String(open), 'aria-label': S.eventsRolesToggle, onclick: () => set(!open) }, [open ? '▴' : '▾'])
  const box = el('div', { class: 'roles', 'data-event-roles': '' }, [el('div', { class: 'roles-line' }, [summary, toggle])])
  if (open) {
    box.append(el('div', { class: 'roles-list' }, ROWS.map((r) => roleRow(h, ev, r.key, r.label))))
    if (focusNext) { focusNext = false; setTimeout(() => box.querySelector<HTMLInputElement>('[data-role-search]')?.focus()) }
  }
  return box
}
