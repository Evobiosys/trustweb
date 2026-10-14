/** The #person fields as the CRM uses them: lookup, the mandatory default, and what counts as "set". */
import { PERSON_FIELDS } from './person_fields'
import type { PersonField } from './person_fields'

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
export const INTENDING_KEY = 'FcZJGS5EH2on'
export const DECEASED_KEY = '__XNQ42Dtiwx'
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

/** Whether a person (their merged values) passes the People filters. */
export function passesFilters(values: FieldValues, f: { hideDeceased: boolean; hideFamous: boolean; onlyConnection: boolean; rules: { key: string; text: string }[] }): boolean {
  if (f.hideDeceased && values[DECEASED_KEY] === true) return false
  if (f.hideFamous && values[FAMOUS_KEY] === true) return false
  if (f.onlyConnection && values[CONNECTION_KEY] !== true) return false
  return f.rules.every((r) => valueText(values[r.key]).toLowerCase().includes(r.text.toLowerCase()))
}
