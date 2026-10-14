import type { AppState, Person } from '../../trustweb/src/model'
import type { FieldValues } from '../src/fields'
import type { PersonField } from '../src/person_fields'

export function convert(index: unknown[], nodes: Record<string, string>, schema: PersonField[]): {
  record: Omit<AppState, 'people'> & { people: (Person & { fields: FieldValues })[] }
  stats: { persons: number; lines: number; withoutFields: number }
}
