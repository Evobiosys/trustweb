/** The #person fields as the CRM uses them: lookup, the mandatory default, and what counts as "set". */
import { PERSON_FIELDS } from './person_fields'
import type { PersonField } from './person_fields'
import { sourceOfLine, sourceOfPerson } from '../../trustweb/src/sources'
import type { Person } from '../../trustweb/src/model'

/** A Tana reference kept as label + node id (id absent once the person retyped it). */
export interface Ref {
  label: string
  tanaId?: string
}
export type FieldValue = string | boolean | Ref[]
/** Field key -> value: a schema field's id (= tanaAttributeId), or `adhoc:<label>` for a field the schema lacks. */
export type FieldValues = Record<string, FieldValue>

export const ADHOC = 'adhoc:'

export const FAMOUS_KEY = '6QzDHIfrlmSz'
/** The Tana checkbox "hide in trustweb". */
export const HIDE_KEY = '4J9bhDw1UdTj'
/** "Intending to connect (0-10)", "intending since" and "Notes from TrustWeb" (the old checkbox FcZJGS5EH2on is ignored). */
export const INTENDING_KEY = 'UAfC4PcYo2po'
export const SINCE_KEY = '6A0Y1jShWqIg'
export const NOTES_KEY = 'IVe9VSySDcS1'
/** The retired checkbox version of the desire; no editor offers it. */
export const OLD_INTENDING_KEY = 'FcZJGS5EH2on'
export const MAX_INTENDING = 10
export const DECEASED_KEY = '__XNQ42Dtiwx'
export const MET_THROUGH_KEY = 'X3aA3ndYjClT'
/** TrustWeb-only checkbox: does not answer; greyed in lists, skipped by asks. Lives in the host's person.fields. */
export const NONRESP_KEY = 'tw-non-responsive'
export const CONNECTION_KEY = 'ConGRasNilsz'

const BY_ID = new Map(PERSON_FIELDS.map((f) => [f.id, f]))

export function fieldById(key: string): PersonField | undefined {
  return BY_ID.get(key)
}

export function fieldLabelOf(key: string): string {
  return BY_ID.get(key)?.label ?? key.slice(ADHOC.length)
}

export function isSet(v: FieldValue | undefined): boolean {
  return v !== undefined && v !== '' && v !== false && !(Array.isArray(v) && v.length === 0)
}

/** Plain text of a value, for inputs, filters and cards. */
export function valueText(v: FieldValue | undefined): string {
  if (v === undefined || v === false) return ''
  if (v === true) return 'yes'
  return typeof v === 'string' ? v : v.map((r) => r.label).join(', ')
}

/** The record's values with the person's own edits laid over them. */
export function mergedFields(base: FieldValues | undefined, edits: FieldValues | undefined): FieldValues {
  return { ...base, ...edits }
}

/** The #person field values the record carries (the Tana converter writes them on the person). */
export function baseFields(person: object): FieldValues | undefined {
  return (person as { fields?: FieldValues }).fields
}

/** The desire to connect, 0 to 10; anything unreadable is 0. */
export function intendingOf(values: FieldValues): number {
  const n = Math.round(Number(valueText(values[INTENDING_KEY])))
  return n >= 1 ? Math.min(n, MAX_INTENDING) : 0
}

/** Whether a person (their merged values) passes the People filters. */
/** The one source a person came from, when nothing else knows them: their id's source and every line's (sources.ts); else null. */
export function onlyFrom(p: Pick<Person, 'id' | 'lines'>): string | null {
  const k = sourceOfPerson(p)
  if (!k) return null
  return p.lines.every((l) => sourceOfLine(l, p) === k) ? k : null
}

export function passesFilters(values: FieldValues, f: { hideDeceased: boolean; hideFamous: boolean; onlyConnection: boolean; rules: { key: string; text: string }[]; hideSources?: string[] }, person?: Pick<Person, 'id' | 'lines'>): boolean {
  if (person && f.hideSources?.length) { const k = onlyFrom(person); if (k && f.hideSources.includes(k)) return false }
  if (f.hideDeceased && values[DECEASED_KEY] === true) return false
  if (f.hideFamous && values[FAMOUS_KEY] === true && intendingOf(values) === 0) return false
  if (f.onlyConnection && values[CONNECTION_KEY] !== true) return false
  return f.rules.every((r) => valueText(values[r.key]).toLowerCase().includes(r.text.toLowerCase()))
}
