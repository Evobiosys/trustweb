// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 settings-llm-first: Settings through MCP, over apps/trustweb/src/settings_registry.ts, the same table that draws the Settings page.
 * Reads and writes the record file (atomic replace, like bar_tools.ts); the edit stream follows people only, so a settings change is unlogged.
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { SETTINGS_REGISTRY, describeSetting, readSetting, searchSettings, writeSetting, type Rec } from '../../trustweb/src/settings_registry.ts'
import type { Tool } from './protocol.ts'

const schema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({ type: 'object', properties, required, additionalProperties: false })
const need = (v: unknown, what: string): string => { if (typeof v !== 'string' || !v.trim()) throw new Error(`${what} is required`); return v.trim() }

export function settingsTools(o: { file: string; write: boolean }): Tool[] {
  const load = (): Rec => JSON.parse(readFileSync(o.file, 'utf8')) as Rec
  const read: Tool[] = [
    {
      name: 'settings_list', description: 'Every setting: id, section, label, type (boolean|choice|number|text|action), default, choices, whether it is on the short page (simple), and its current value. Actions open a screen in the app and carry no value.',
      inputSchema: schema({ simple: { type: 'boolean', description: 'only the settings on the short Settings page' } }),
      run: (a) => { const r = load(); return SETTINGS_REGISTRY.filter((d) => a.simple !== true || d.simple).map((d) => describeSetting(d, r)) },
    },
    { name: 'settings_get', description: 'One setting by id, with its current value.', inputSchema: schema({ id: { type: 'string' } }, ['id']), run: (a) => { const id = need(a.id, 'id'); return { id, value: readSetting(load(), id) } } },
    {
      name: 'settings_search', description: 'Settings whose id, label, hint or section contain every word of the query.',
      inputSchema: schema({ q: { type: 'string' } }, ['q']), run: (a) => { const r = load(); return searchSettings(typeof a.q === 'string' ? a.q : '').map((d) => describeSetting(d, r)) },
    },
  ]
  const write: Tool[] = [{
    name: 'settings_set', description: 'Set one setting by id. boolean: true|false; choice: one of its choices; number: within its range. Returns the stored value.',
    inputSchema: schema({ id: { type: 'string' }, value: { description: 'boolean, string or number, per the setting type' } }, ['id', 'value']),
    run: (a) => {
      const id = need(a.id, 'id')
      const r = load()
      const value = writeSetting(r, id, a.value)
      const tmp = o.file + '.tmp'
      writeFileSync(tmp, JSON.stringify(r)); renameSync(tmp, o.file)
      return { id, value }
    },
  }]
  return [...read, ...(o.write ? write : [])]
}
