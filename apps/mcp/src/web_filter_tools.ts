// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 web-focus-filter: the Web's "show only" filter through MCP: web_filter_get / web_filter_set over the record's `uiRings.show` (the same chips the app's
 * filter list uses). An event tag is `event_<slug>` here (events.ts eventTagSlug) and the chip `event:<id>` in the record. Saved straight into the record (atomic replace), unlogged, like bar_tools.ts.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { eventTagSlug } from '../../trustweb/src/event_tag.ts'
import type { Tool } from './protocol.ts'

interface Ev { id: string; name: string; tagName?: string }
type Rec = Record<string, unknown> & { uiRings?: { show?: string[]; hide?: string[] } & Record<string, unknown>; events?: Ev[] }

/** Keyed by the lower-cased slug: event tags match whatever their letter case (event_tag.ts sameEventTag). */
const slugs = (r: Rec): Map<string, string> => new Map((r.events ?? []).map((e) => [eventTagSlug(e.tagName ?? e.name).toLowerCase(), e.id]))

function shape(r: Rec): Record<string, unknown> {
  const byId = new Map((r.events ?? []).map((e) => [e.id, eventTagSlug(e.tagName ?? e.name)]))
  const tag = (chip: string): string => (chip.startsWith('event:') ? byId.get(chip.slice(6)) ?? chip : chip)
  const show = r.uiRings?.show ?? []
  const hide = r.uiRings?.hide ?? []
  return { tags: show.map(tag), hide: hide.map(tag), count: show.length + hide.length }
}

/** `event_<slug>` -> `event:<id>`; `tag:<id>`, `person:<id>` and `event:<id>` pass as they are. */
function chipOf(r: Rec, tag: unknown): string {
  if (typeof tag !== 'string') throw new Error('every tag must be text')
  const t = tag.trim()
  if (/^(tag|person|event):.+/.test(t)) return t
  if (t.startsWith('event_')) {
    const id = slugs(r).get(t.toLowerCase())
    if (!id) throw new Error(`unknown event tag: ${t}`)
    return 'event:' + id
  }
  throw new Error(`tags are event_<slug>, tag:<id> or person:<id>, not "${t}"`)
}

export function webFilterTools(o: { file: string; write: boolean }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const read: Tool[] = [{
    name: 'web_filter_get', description: 'The Web\'s filter: the tags shown only (event_<slug>, tag:<id>, person:<id>), the hidden ones, and how many filters are on.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, run: () => shape(load()),
  }]
  const write: Tool[] = [{
    name: 'web_filter_set', description: 'Set the Web\'s filter: only people with these tags show (event_<slug>, tag:<id>, person:<id>). An empty list clears every filter.',
    inputSchema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' }, description: 'tags to show only; [] clears the filter' } }, required: ['tags'], additionalProperties: false },
    run: (a) => {
      if (!Array.isArray(a.tags)) throw new Error('tags must be a list')
      const r = load()
      const show = [...new Set(a.tags.map((t) => chipOf(r, t)))]
      r.uiRings = { ...r.uiRings, show, hide: show.length ? r.uiRings?.hide ?? [] : [] }
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r))
      renameSync(tmp, o.file)
      return shape(r)
    },
  }]
  return [...read, ...(o.write ? write : [])]
}
