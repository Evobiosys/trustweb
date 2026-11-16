// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b resources-views (POLICY P02, MCP parity): the Resources page's views, filters, kind and "recommended by", as tools over the record file. */
import { listResources, setKind, setRecommender } from '../../trustweb/src/resource_views.ts'
import { parseCommunity } from '../../trustweb/src/ext/community-mighty/community_data.ts'
import type { InventoryItem } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
interface Person extends Obj { id: string; name: string; deleted_at?: string }
interface Rec extends Obj { people: Person[]; inventory?: InventoryItem[]; extData?: Record<string, unknown> }
export interface ResourceToolsEnv { load: () => Rec; commit: (change: (r: Rec) => void) => boolean }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const schema = (properties: Obj, required: string[] = []): Obj => ({ type: 'object', properties, required, additionalProperties: false })
const S = (description: string): Obj => ({ type: 'string', description })
const KIND = 'book, publication, reference, recording, link or other'

/** A person given by id or exact name becomes the id; any other text stays a free name. */
function whoOf(r: Rec, v: unknown): string {
  const key = str(v).trim()
  const hits = r.people.filter((p) => p.deleted_at === undefined && (p.id === key || p.name.trim().toLowerCase() === key.toLowerCase()))
  return hits.length === 1 ? hits[0].id : key
}

export function resourceTools(e: ResourceToolsEnv): { read: Tool[]; write: Tool[] } {
  const read: Tool[] = [{
    name: 'resources_list', description: `My resources. Filter by kind (${KIND}), sharedBy (person id or name) and communityId; view: list (default, flat), outliner (community > kind > item) or person (grouped by who shared or recommended). A protected resource (from a protected community) comes without its link.`,
    inputSchema: schema({ kind: S(KIND), sharedBy: S('person id or exact name'), communityId: S('community id'), view: S('list, outliner or person') }),
    run: (a) => {
      const r = e.load()
      const tags = Object.entries(parseCommunity(r.extData?.['community-mighty']).meta ?? {}).map(([id, m]) => ({ id, label: m.name ?? id, protected: false }))
      return listResources(r.inventory ?? [], tags, {
        ...(str(a.kind) ? { kind: str(a.kind) as never } : {}), ...(str(a.sharedBy).trim() ? { sharedBy: whoOf(r, a.sharedBy) } : {}),
        ...(str(a.communityId) ? { communityId: str(a.communityId) } : {}), ...(str(a.view) ? { view: str(a.view) } : {}),
      })
    },
  }]
  const write: Tool[] = [
    {
      name: 'resource_set_kind', description: `Say what kind a resource is: ${KIND}.`,
      inputSchema: schema({ id: S('resource id'), kind: S(KIND) }, ['id', 'kind']),
      run: (a) => { e.commit((r) => { setKind({ inventory: r.inventory ?? [] }, str(a.id), str(a.kind)) }); return { id: str(a.id), kind: str(a.kind) } },
    },
    {
      name: 'resource_set_suggester', description: 'Say who recommended a resource: a person (id or exact name) or a free name; empty clears it.',
      inputSchema: schema({ id: S('resource id'), by: S('person id or name, empty = none') }, ['id', 'by']),
      run: (a) => {
        let by = ''
        e.commit((r) => { by = whoOf(r, a.by); setRecommender({ inventory: r.inventory ?? [] }, str(a.id), by) })
        return { id: str(a.id), recommendedBy: by }
      },
    },
  ]
  return { read, write }
}
