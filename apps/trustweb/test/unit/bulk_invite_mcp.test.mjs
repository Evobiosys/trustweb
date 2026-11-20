// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 bulk-invite-filter (MCP parity): invite_bulk over the record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const P = (id, tags = []) => ({ id, name: `Person ${id}`, context: '', ring: 'friend', metAt: 0, lines: [], fields: Object.fromEntries(tags.map((t) => [t, 'true'])) })
const base = () => ({ v: 1, me: { displayName: 'Jakob' }, people: [P('a', ['iyg']), P('b', ['iyg', 'cook']), P('c', ['cook']), P('d')], events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 0, attended: true, communityId: 'iyg' }, { id: 'e2', name: 'Picnic', from: '2026-12-01', where: 'Prater', createdAt: 0, attended: true }] })
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-bulk-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  return { by: Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-20T10:00:00Z') }).map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('invite_bulk', () => {
  it('is a write tool in mcp_config; absent with writes off', () => {
    expect(MCP_TOOLS.find((t) => t.name === 'invite_bulk')).toEqual({ name: 'invite_bulk', write: true })
    expect(fixture(false).by.invite_bulk).toBeUndefined()
  })
  it('preview (confirm absent) lists who would be invited and changes nothing', () => {
    const f = fixture()
    const out = f.by.invite_bulk.run({ event: 'Picnic', include: ['tag:cook'], exclude: ['person:c'] })
    expect(out).toEqual({ event: 'e2', count: 1, people: ['b'], notMembers: [], community: null, invited: false })
    expect(f.rec().events[1].people).toBeUndefined()
  })
  it('a community event: non-members are listed and the invite needs accept_non_members', () => {
    const f = fixture()
    const ask = { event: 'e1', include: ['tag:cook', 'tag:iyg'], exclude: [] }
    expect(f.by.invite_bulk.run(ask)).toMatchObject({ people: ['a', 'b', 'c'], notMembers: ['c'], community: 'iyg', invited: false })
    expect(() => f.by.invite_bulk.run({ ...ask, confirm: true })).toThrow(/not members of iyg/)
    expect(f.by.invite_bulk.run({ ...ask, confirm: true, accept_non_members: true })).toMatchObject({ count: 3, invited: true })
    expect(f.rec().events[0].people).toEqual(['a', 'b', 'c'])
  })
  it('rejects an unknown event or chip', () => {
    const f = fixture()
    expect(() => f.by.invite_bulk.run({ event: 'Nope', include: ['tag:cook'] })).toThrow(/no event/)
    expect(() => f.by.invite_bulk.run({ event: 'e2', include: ['cook'] })).toThrow(/chip/)
  })
})
