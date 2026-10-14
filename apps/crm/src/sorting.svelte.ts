/** Filing people under a ring: the edits go through saveField (CRM record first, Tana for the checkboxes that have a field there). */
import { baseFields, passesFilters } from './fields'
import type { FieldValue, FieldValues } from './fields'
import { effectivePerson, entityValues } from './person_view'
import { prefs } from './prefs.svelte'
import { UNSORTED, choiceEdits, ringOf } from './rings'
import type { Choice } from './rings'
import { store } from './state.svelte'
import { saveField } from './sync.svelte'

export function valuesOf(personId: string): FieldValues {
  const p = store.app.people.find((x) => x.id === personId)
  return p ? entityValues(p, baseFields(p), store.crm.personFields?.[personId]) : {}
}

/** Unsorted people the filters let through and whose name is no email or calendar id. */
export function unsortedIds(): string[] {
  return store.app.people
    .filter((p) => ringOf(effectivePerson(p, store.crm.personFields?.[p.id]).ring) === UNSORTED
      && !p.name.includes('@') && passesFilters(valuesOf(p.id), prefs.filters))
    .map((p) => p.id)
}

export type Undo = [string, FieldValue][]

/** Files the person under `choice`; returns what puts the touched fields back. */
export function fileUnder(personId: string, choice: Choice): Undo {
  const before = valuesOf(personId)
  const edits = choiceEdits(choice, before)
  for (const [key, value] of edits) saveField(personId, key, value)
  return edits.map(([key, value]) => [key, before[key] ?? (typeof value === 'boolean' ? false : '')])
}

export function restore(personId: string, undo: Undo): void {
  for (const [key, value] of undo) saveField(personId, key, value)
}
