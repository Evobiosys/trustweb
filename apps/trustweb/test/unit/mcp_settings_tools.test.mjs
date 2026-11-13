// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 settings-llm-first: the MCP settings tools are the registry, over a record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { settingsTools } from '../../../mcp/src/settings_tools.ts'
import { SETTINGS_REGISTRY } from '../../src/settings_registry.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

function fixture(write) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-set-')), 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [], chatsHidden: true }))
  const tools = settingsTools({ file, write })
  return { file, tools, by: Object.fromEntries(tools.map((t) => [t.name, t])) }
}

describe('settings MCP tools', () => {
  it('read-only offers list/get/search; write adds set', () => {
    expect(fixture(false).tools.map((t) => t.name).sort()).toEqual(['settings_get', 'settings_list', 'settings_search'])
    expect(fixture(true).tools.map((t) => t.name).sort()).toEqual(['settings_get', 'settings_list', 'settings_search', 'settings_set'])
  })
  it('settings_list equals the registry, with values', () => {
    const { by } = fixture(false)
    const out = by.settings_list.run({})
    expect(out.map((s) => s.id)).toEqual(SETTINGS_REGISTRY.map((s) => s.id))
    expect(out.find((s) => s.id === 'chats.hidden').value).toBe(true)
    expect(by.settings_list.run({ simple: true }).every((s) => s.simple)).toBe(true)
  })
  it('settings_get / settings_set / settings_search', () => {
    const { by, file } = fixture(true)
    expect(by.settings_get.run({ id: 'chats.hidden' }).value).toBe(true)
    expect(by.settings_set.run({ id: 'chats.hidden', value: false })).toMatchObject({ id: 'chats.hidden', value: false })
    expect(JSON.parse(readFileSync(file, 'utf8')).chatsHidden).toBe(false)
    expect(() => by.settings_set.run({ id: 'ui.bar', value: true })).toThrow(/action/)
    expect(() => by.settings_get.run({ id: 'x' })).toThrow(/unknown setting/)
    expect(by.settings_search.run({ q: 'birthday' }).map((s) => s.id)).toContain('birthdays.reminders')
  })
  it('the app-side tool list names exactly these tools', () => {
    const names = MCP_TOOLS.map((t) => t.name)
    for (const n of ['settings_list', 'settings_get', 'settings_search']) expect(MCP_TOOLS.find((t) => t.name === n)?.write).toBe(false)
    expect(MCP_TOOLS.find((t) => t.name === 'settings_set')?.write).toBe(true)
    expect(names).toContain('settings_set')
  })
})
