import type { AppState, Person } from '../../trustweb/src/model'
import type { FieldValues } from '../src/fields'
import type { PersonField } from '../src/person_fields'

type Entity = Person & { fields: FieldValues }

export function convert(
  index: unknown[], nodes: Record<string, string>, schema: PersonField[],
  workspaces?: { id: string; name: string }[], env?: { index: unknown[]; nodes: Record<string, string>; schema: PersonField[] },
  firstMet?: Record<string, { metAt: number; context?: string }>, hiddenIds?: Set<string>,
  intending?: Record<string, { n: number; since?: string }>,
): {
  record: Omit<AppState, 'people'> & { people: Entity[]; environments?: Omit<Entity, 'ring'>[] }
  stats: { persons: number; lines: number; withoutFields: number; environments: number; hidden: number; blank: number }
}
