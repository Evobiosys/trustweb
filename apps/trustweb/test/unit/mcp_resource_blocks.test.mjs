// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b resources-outliner (MCP parity P02): resource_block_add/edit/move and resource_share over the record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const item = (id, over = {}) => ({ id, text: `Item ${id}`, audience: 'friends', included: true, createdAt: 1, ...over })
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpblk-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [], sameAs: {}, meetings: [], inventory: [item('1'), item('2', { protected: true, blocks: [{ id: 'x', text: 'secret', children: [] }] })] }))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-16T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('resource block tools', () => {
  it('share is a read, the three block edits need writes on', () => {
    expect(Object.keys(fixture(false).by)).toContain('resource_share')
    for (const n of ['resource_block_add', 'resource_block_edit', 'resource_block_move']) { expect(Object.keys(fixture(false).by)).not.toContain(n); expect(Object.keys(fixture().by)).toContain(n) }
  })
  it('adds, edits, moves and shares', () => {
    const f = fixture()
    const a = f.by.resource_block_add.run({ id: '1', text: 'top' }).blockId
    const b = f.by.resource_block_add.run({ id: '1', text: 'next', afterId: a }).blockId
    const c = f.by.resource_block_add.run({ id: '1', text: 'kid', parentId: a }).blockId
    f.by.resource_block_edit.run({ id: '1', blockId: b, text: 'second' })
    expect(f.by.resource_block_move.run({ id: '1', blockId: b, how: 'indent' }).moved).toBe(true)
    expect(f.by.resource_block_move.run({ id: '1', blockId: a, how: 'up' }).moved).toBe(false)
    const blocks = f.rec().inventory[0].blocks
    expect(blocks.map((x) => x.text)).toEqual(['top'])
    expect(blocks[0].children.map((x) => x.text)).toEqual(['kid', 'second'])
    expect(f.by.resource_share.run({ id: '1', blockId: a, scope: 'block' })).toMatchObject({ lines: 3, blocks: 1, ref: { resourceId: '1', blockId: a } })
    expect(f.by.resource_share.run({ id: '1', blockId: a, scope: 'line' })).toMatchObject({ lines: 1, text: 'top' })
    expect(c).toBeTruthy()
  })
  it('rejects a bad move, a bad scope and a protected share', () => {
    const f = fixture()
    const a = f.by.resource_block_add.run({ id: '1', text: 'top' }).blockId
    expect(() => f.by.resource_block_move.run({ id: '1', blockId: a, how: 'sideways' })).toThrow(/how must/)
    expect(() => f.by.resource_share.run({ id: '1', blockId: a, scope: 'all' })).toThrow(/scope/)
    expect(() => f.by.resource_share.run({ id: '2', blockId: 'x', scope: 'line' })).toThrow(/protected/)
  })
})
