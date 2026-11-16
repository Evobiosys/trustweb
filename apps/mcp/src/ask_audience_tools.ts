// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b ask-page-filter: the ask audience through MCP: ask_audience_get / ask_audience_set over the record's `askAudience` {zone, add, exclude}
 * and `askReach` (the degree: 1, 2 or 3; 1 = the default, stored as no value). Public is refused until PUBLIC_ASK_ENABLED. Saved straight into the record
 * (atomic replace), unlogged, like web_filter_tools.ts.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { parseFilter } from '../../trustweb/src/audience_zones.ts'
import type { Tool } from './protocol.ts'

type Rec = Record<string, unknown> & { askAudience?: unknown; askReach?: number }

function shape(r: Rec): Record<string, unknown> {
  const f = parseFilter({ ...(r.askAudience as object | undefined), degree: r.askReach === 2 || r.askReach === 3 ? r.askReach : 1 })
  return { ...(f.zone ? { zone: f.zone } : {}), add: f.add, exclude: f.exclude, degree: f.degree }
}

export function askAudienceTools(o: { file: string; write: boolean }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const read: Tool[] = [{
    name: 'ask_audience_get', description: 'Who an ask reaches: the zone (closest, close, friend: this zone and more intimate; none = every connected person), people and tags added (person:<id>, tag:<id>), hidden ones, and the degree 1, 2 or 3.',
    inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false }, run: () => shape(load()),
  }]
  const write: Tool[] = [{
    name: 'ask_audience_set', description: 'Set who an ask reaches: zone (closest, close, friend), add / exclude lists of person:<id> or tag:<id>, degree 1, 2 or 3. Public is not available yet.',
    inputSchema: {
      type: 'object',
      properties: {
        zone: { type: 'string', enum: ['closest', 'close', 'friend'] }, add: { type: 'array', items: { type: 'string' } }, exclude: { type: 'array', items: { type: 'string' } },
        degree: { type: ['integer', 'string'], description: '1, 2 or 3 (public is refused for now)' },
      },
      required: [], additionalProperties: false,
    },
    run: (a) => {
      const f = parseFilter(a)
      const r = load()
      r.askAudience = { ...(f.zone ? { zone: f.zone } : {}), add: f.add, exclude: f.exclude }
      if (f.degree === 1) delete r.askReach
      else r.askReach = f.degree
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r))
      renameSync(tmp, o.file)
      return shape(r)
    },
  }]
  return [...read, ...(o.write ? write : [])]
}
