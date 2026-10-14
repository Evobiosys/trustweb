/** Filing people under a ring: the edits go through saveField (CRM record first, Tana for the checkboxes that have a field there). */
import { Ring } from '../../trustweb/src/model'
import { dayKey } from './dates'
import { baseFields, passesFilters } from './fields'
import type { FieldValue, FieldValues } from './fields'
import { effectivePerson, entityValues } from './person_view'
import { prefs } from './prefs.svelte'
import { FAMILY_KEY, UNSORTED, choiceEdits, intendingEdits, ringOf } from './rings'
import type { Choice } from './rings'
import { store } from './state.svelte'
import type { Suggestion } from './suggestions'
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

function apply(personId: string, edits: [string, FieldValue][], before: FieldValues): Undo {
  for (const [key, value] of edits) saveField(personId, key, value)
  return edits.map(([key, value]) => [key, before[key] ?? (typeof value === 'boolean' ? false : '')])
}

/** Files the person under `choice`; returns what puts the touched fields back. */
export function fileUnder(personId: string, choice: Choice): Undo {
  const before = valuesOf(personId)
  return apply(personId, choiceEdits(choice, before), before)
}

/** Sets the desire to connect (0 to 10): the number, the date it changed, and the ring when no closer one holds. */
export function setIntending(personId: string, n: number): Undo {
  const before = valuesOf(personId)
  return apply(personId, intendingEdits(n, before, dayKey(Date.now())), before)
}

/** The family tag: a purple accent on top of any closeness. */
export function setFamily(personId: string, on: boolean): Undo {
  return apply(personId, [[FAMILY_KEY, on]], valuesOf(personId))
}

/** Files the whole suggestion (ring, family tag, desire); returns what puts it all back (last change first). */
export function applySuggestion(personId: string, s: Suggestion): Undo {
  const undo = [
    fileUnder(personId, s.ring === Ring.Intending ? UNSORTED : s.ring),
    setFamily(personId, s.family),
    ...(s.intending > 0 ? [setIntending(personId, s.intending)] : []),
  ]
  return undo.reverse().flat()
}

export function restore(personId: string, undo: Undo): void {
  for (const [key, value] of undo) saveField(personId, key, value)
}
