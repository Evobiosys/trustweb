// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b resources-views (POLICY P02, MCP parity): the Resources page's views, filters, kind and "recommended by", as tools over the record file. */
import { listResources, setKind, setRecommender } from '../../trustweb/src/resource_views.ts'
import { setPhysical } from '../../trustweb/src/physical_place.ts'
import { forPage, itemTags, markOpened, partitionScope, scopedList } from '../../trustweb/src/resource_scope.ts'
import type { Scope } from '../../trustweb/src/resource_scope.ts'
import { arrange, scopeKey, scopeLabelOf, setViewPrefs } from '../../trustweb/src/resource_notion.ts'
import type { NotionRow, ResViews, ViewPatch, ViewPrefs } from '../../trustweb/src/resource_notion.ts'
import { eventTagLabel, eventTagSlug } from '../../trustweb/src/event_tag.ts'
import { parseCommunity } from '../../trustweb/src/ext/community-mighty/community_data.ts'
import type { InventoryItem } from '../../trustweb/src/model.ts'
import type { Tool } from './protocol.ts'

type Obj = Record<string, unknown>
interface Person extends Obj { id: string; name: string; deleted_at?: string }
interface Rec extends Obj { people: Person[]; inventory?: InventoryItem[]; resViews?: ResViews; events?: { id: string; name: string; tagName?: string }[]; extData?: Record<string, unknown> }
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
    inputSchema: schema({ kind: S(KIND), sharedBy: S('person id or exact name'), communityId: S('community id'), view: S('list, outliner or person'), scope: S('mine (default), community or event: adds sections {shared, new, general} (ids) of that community or event'), community: S('community id, with scope community'), event: S('event id, with scope event') }),
    run: (a) => {
      const r = e.load()
      const tags = Object.entries(parseCommunity(r.extData?.['community-mighty']).meta ?? {}).map(([id, m]) => ({ id, label: m.name ?? id, protected: false }))
      const scoped = scopedList(r.inventory ?? [], tags, r.events ?? [], { slug: eventTagSlug, label: eventTagLabel }, { scope: str(a.scope), community: str(a.community), event: str(a.event) })
      const listed = listResources(r.inventory ?? [], tags, {
        ...(str(a.kind) ? { kind: str(a.kind) as never } : {}), ...(str(a.sharedBy).trim() ? { sharedBy: whoOf(r, a.sharedBy) } : {}),
        ...(str(a.communityId) ? { communityId: str(a.communityId) } : {}), ...(str(a.view) ? { view: str(a.view) } : {}),
      })
      return scoped ? { ...listed, ...scoped } : listed
    },
  }]
  const write: Tool[] = [
    {
      name: 'resource_mark_opened', description: 'Mark a resource that someone shared with you as opened: it leaves the New section of its community or event.',
      inputSchema: schema({ id: S('resource id') }, ['id']),
      run: (a) => {
        let changed = false
        e.commit((r) => {
          if (!(r.inventory ?? []).some((i) => i.id === str(a.id))) throw new Error(`no resource "${str(a.id)}"`)
          changed = markOpened(r.inventory ?? [], str(a.id), Date.now())
        })
        return { id: str(a.id), opened: true, changed }
      },
    },
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
    {
      name: 'resource_set_physical', description: 'Mark a resource as something to pick up (physical:true) with the place where it is, or take the mark off (physical:false). A physical thing needs a place: without one nothing changes and the answer says needsPlace; confirm_no_place:true continues anyway ("Are you sure? Without a place nobody can pick it up.").',
      inputSchema: schema({ id: S('resource id'), physical: { type: 'boolean' }, place: S('where it physically is'), confirm_no_place: { type: 'boolean' } }, ['id', 'physical']),
      run: (a) => {
        let out: 'ok' | 'needs-place' = 'ok'
        e.commit((r) => {
          const item = (r.inventory ?? []).find((i) => i.id === str(a.id))
          if (!item) throw new Error('no such resource')
          out = setPhysical(item, a.physical === true, str(a.place), a.confirm_no_place === true)
        })
        return out === 'ok' ? { id: str(a.id), physical: a.physical === true, place: str(a.place).trim() } : { id: str(a.id), needsPlace: true, message: 'Are you sure? Without a place nobody can pick it up. Send place, or confirm_no_place:true.' }
      },
    },
  ]
  return { read, write: [...write, resourcesViewSet(e)] /* wave45 resources-notion-views */ }
}

/* wave45 resources-notion-views */
function resourcesViewSet(e: ResourceToolsEnv): Tool {
  return {
    name: 'resources_view_set', description: 'Pick how Resources look (as the view pills do), remembered per scope: view list, table, board, gallery (or the older outliner / person) for mine (default), a community or an event. Optional for that view: sort (name, tags, sharedBy, when, scope; none clears) with dir asc/desc, groupBy tag or status (board), filters tag, kind, sharedBy (person id), communityId ("" clears one). Answers the rows the view shows (id, name, tags, sharedBy, when, scope, status) and, for a board, its columns.',
    inputSchema: schema({
      scope: S('mine (default), community or event'), community: S('community id, with scope community'), event: S('event id, with scope event'), page: S('resources (default) or references'),
      view: S('list, table, board, gallery, outliner or person'), sort: S('name, tags, sharedBy, when, scope or none'), dir: S('asc or desc (default asc; when: desc)'), groupBy: S('tag or status (board)'),
      tag: S('only items with this tag id ("" clears)'), kind: S(`${KIND} ("" clears)`), sharedBy: S('person id ("" clears)'), communityId: S('community id ("" clears)'),
    }, ['view']),
    run: (a) => {
      const r0 = e.load()
      const tags = Object.entries(parseCommunity(r0.extData?.['community-mighty']).meta ?? {}).map(([id, m]) => ({ id, label: m.name ?? id, community: true }))
      const events = r0.events ?? []
      const et = { slug: eventTagSlug, label: eventTagLabel }
      const scope = str(a.scope) || 'mine'
      let sc: Scope | null = null
      if (scope === 'community') {
        const t = tags.find((x) => x.id === str(a.community))
        if (!t) throw new Error('community: give the id of a community')
        sc = { kind: 'community', id: t.id, label: t.label }
      } else if (scope === 'event') {
        const ev = events.find((x) => x.id === str(a.event))
        if (!ev) throw new Error('event: give the id of an event')
        sc = { kind: 'event', id: ev.id, label: et.label(ev.tagName ?? ev.name), tagIds: [et.slug(ev.tagName ?? ev.name)] }
      } else if (scope !== 'mine') throw new Error('scope must be one of mine, community, event')
      const page = str(a.page) === 'references' ? 'references' : 'resources'
      const key = scopeKey(sc, page)
      const sortName = str(a.sort)
      const filter = Object.fromEntries((['tag', 'kind', 'sharedBy', 'communityId'] as const).filter((k) => typeof a[k] === 'string').map((k) => [k, str(a[k])]))
      const patch: ViewPatch = {
        view: str(a.view), ...(str(a.groupBy) ? { groupBy: str(a.groupBy) } : {}), ...(Object.keys(filter).length ? { filter } : {}),
        ...(sortName === 'none' ? { sort: null } : sortName ? { sort: { key: sortName, dir: str(a.dir) || (sortName === 'when' ? 'desc' : 'asc') } } : {}),
      }
      let prefs: ViewPrefs | undefined
      e.commit((r) => { prefs = setViewPrefs(r, key, patch) })
      const r = e.load()
      const inv = r.inventory ?? []
      const items = sc ? (({ shared, fresh }) => [...shared, ...fresh])(partitionScope(forPage(inv, page), sc)) : inv
      const ctx = { tagsOf: (i: InventoryItem) => itemTags(i, tags, events, et), nameOf: (id: string) => r.people.find((p) => p.id === id)?.name, scopeOf: (i: InventoryItem) => scopeLabelOf(i, tags, events, et) }
      const shown = arrange(items, ctx, prefs!)
      const row = (x: NotionRow): Obj => ({ id: x.id, name: x.name, tags: x.tags, sharedBy: x.sharedBy, when: x.when, scope: x.scope, status: x.status })
      return { key, prefs, rows: shown.rows.map(row), ...(prefs!.view === 'board' ? { columns: shown.columns.map((c) => ({ id: c.id, label: c.label, ids: c.rows.map((x) => x.id) })) } : {}) }
    },
  }
}
