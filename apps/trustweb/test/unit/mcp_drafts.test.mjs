// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c event-autosave (MCP parity D-P02): drafts_list (editor, target, size, time; never the content) and draft_discard over the record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const base = () => ({ v: 1, me: { displayName: 'Test Person' }, people: [], sameAs: {}, meetings: [], drafts: {
  'ask:new': { editor: 'ask', target: 'new', value: { a: 'Who has a ladder?' }, updatedAt: 2000, size: 30 },
  'chat:p1': { editor: 'chat', target: 'p1', value: { a: 'see you' }, updatedAt: 1000, size: 20 },
} })
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpdr-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-17T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('drafts tools', () => {
  it('are listed in mcp_config; the discard only with writes on', () => {
    expect(MCP_TOOLS).toContainEqual({ name: 'drafts_list', write: false })
    expect(MCP_TOOLS).toContainEqual({ name: 'draft_discard', write: true })
    expect(Object.keys(fixture(false).by)).toContain('drafts_list')
    expect(Object.keys(fixture(false).by)).not.toContain('draft_discard')
  })
  it('drafts_list: newest first, with key, size and time, without the typed content', () => {
    const list = fixture().by.drafts_list.run({})
    expect(list).toEqual([
      { key: 'ask:new', editor: 'ask', target: 'new', size: 30, updatedAt: '1970-01-01T00:00:02.000Z' },
      { key: 'chat:p1', editor: 'chat', target: 'p1', size: 20, updatedAt: '1970-01-01T00:00:01.000Z' },
    ])
    expect(JSON.stringify(list)).not.toContain('ladder')
  })
  it('draft_discard drops one draft by key; an unknown key throws', () => {
    const f = fixture()
    expect(f.by.draft_discard.run({ key: 'ask:new' })).toEqual({ key: 'ask:new', discarded: true })
    expect(Object.keys(f.rec().drafts)).toEqual(['chat:p1'])
    expect(() => f.by.draft_discard.run({ key: 'ask:new' })).toThrow(/no draft/)
  })
})
