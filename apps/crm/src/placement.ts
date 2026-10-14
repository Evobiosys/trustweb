/**
 * Where each field sits: on the collapsed row, in the expanded simple view, in the advanced view, or hidden.
 * A placement is data (this device's, or a network's under Curate); the layout is derived from it and the values. Pure.
 */
import { ENVIRONMENT_FIELDS } from './environment_fields'
import { ADHOC, fieldLabelOf, intendingOf, isSet } from './fields'
import type { FieldValues } from './fields'
import { PERSON_FIELDS } from './person_fields'
import type { PersonField } from './person_fields'

export enum Kind {
  Person = 'person',
  Environment = 'environment',
}

export enum Section {
  Collapsed = 'collapsed',
  Simple = 'simple',
  Advanced = 'advanced',
  Hidden = 'hidden',
}

export const SECTIONS: readonly Section[] = [Section.Collapsed, Section.Simple, Section.Advanced, Section.Hidden]

export interface Placement {
  /** Only fields the person (or an admin) placed on purpose; the rest follow the defaults below. */
  sections: Record<string, Section>
  /** Explicit order, across sections. */
  order: string[]
}

export const LAST_NAME_KEY = 'kb0JInYEW2lD'

const DEFAULT_SIMPLE: Record<Kind, readonly string[]> = {
  [Kind.Person]: ['tw-first', LAST_NAME_KEY, 'tw-context', 'tw-ring', 'tw-fav'],
  [Kind.Environment]: ['tw-context'],
}

export type Placements = Record<Kind, Placement>

export function emptyPlacements(): Placements {
  return { person: emptyPlacement(), environment: emptyPlacement() }
}

export function emptyPlacement(): Placement {
  return { sections: {}, order: [] }
}

export function fieldsOf(kind: Kind): readonly PersonField[] {
  return kind === Kind.Person ? PERSON_FIELDS : ENVIRONMENT_FIELDS
}

/** Layers from weakest to strongest: a stronger layer wins per field and in order. */
export function mergePlacements(layers: readonly Placement[]): Placement {
  const order = [...layers].reverse().flatMap((l) => l.order)
  return { sections: Object.assign({}, ...layers.map((l) => l.sections)), order: [...new Set(order)] }
}

/** "Met in which context", or "Intending to connect" while the person is not met yet. */
export function labelOf(field: PersonField, values: FieldValues): string {
  if (field.id !== 'tw-context') return field.label
  return values['tw-ring'] === 'intending' || intendingOf(values) >= 1 ? 'Intending to connect' : 'Met in which context'
}

export type Layout = Record<Section, PersonField[]>

/** The four sections with their fields in order. A filled field nobody placed shows in simple; an empty one waits in advanced. */
export function layout(kind: Kind, placement: Placement, values: FieldValues): Layout {
  const adhoc: PersonField[] = Object.keys(values).filter((k) => k.startsWith(ADHOC) && isSet(values[k]))
    .map((id) => ({ id, tanaAttributeId: null, label: fieldLabelOf(id), type: 'content', description: '' }))
  const fields = [...fieldsOf(kind), ...adhoc]
  const base = [...DEFAULT_SIMPLE[kind], ...fields.map((f) => f.id)]
  const rank = (id: string): number => {
    const i = placement.order.indexOf(id)
    return i >= 0 ? i : placement.order.length + base.indexOf(id)
  }
  const out: Layout = { collapsed: [], simple: [], advanced: [], hidden: [] }
  const sorted = [...fields].sort((a, b) => rank(a.id) - rank(b.id))
  for (const f of sorted) {
    const section = placement.sections[f.id]
      ?? (DEFAULT_SIMPLE[kind].includes(f.id) || isSet(values[f.id]) ? Section.Simple : Section.Advanced)
    out[section].push(f)
  }
  return out
}

/** Puts `key` into `section` before `beforeKey` (end when null). Returns a placement with every field's order explicit. */
export function move(kind: Kind, placement: Placement, values: FieldValues, key: string, section: Section, beforeKey: string | null): Placement {
  const lay = layout(kind, placement, values)
  const ids = (s: Section): string[] => lay[s].map((f) => f.id).filter((id) => id !== key)
  const target = ids(section)
  const at = beforeKey === null ? -1 : target.indexOf(beforeKey)
  target.splice(at < 0 ? target.length : at, 0, key)
  const order = SECTIONS.flatMap((s) => (s === section ? target : ids(s)))
  return { sections: { ...placement.sections, [key]: section }, order }
}
