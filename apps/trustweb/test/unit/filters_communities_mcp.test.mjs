// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44b filters-communities (P02): saved filters, event mode, bare community chip and sub-communities through MCP. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { SUBCOMMUNITY_FREE_LIMIT } from '../../src/ext/community-mighty/community_data.ts'

function fx() {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-fc-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, people: [], events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-01', to: '2026-12-02', where: 'x', attended: false }], uiRings: { show: ['tag:a'], hide: ['tag:b'] } }))
  const tools = allTools({ file, write: true, now: () => new Date('2026-11-16T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('filter states over MCP', () => {
  it('save, list, apply, pin', () => {
    const { by, rec } = fx()
    const saved = by.filter_state_save.run({ name: 'Mine' })
    expect(saved).toMatchObject({ name: 'Mine', show: ['tag:a'], hide: ['tag:b'], pinned: false })
    by.web_filter_set.run({ tags: [] })
    expect(rec().uiRings.show).toEqual([])
    by.filter_state_apply.run({ filter: 'mine' })
    expect(rec().uiRings.show).toEqual(['tag:a'])
    expect(by.filter_state_pin.run({ filter: saved.id }).pinned).toBe(true)
    expect(by.filter_state_list.run({}).map((f) => f.pinned)).toEqual([true])
    expect(by.filter_state_pin.run({ filter: 'Mine', pinned: false }).pinned).toBe(false)
    expect(() => by.filter_state_apply.run({ filter: 'nope' })).toThrow(/no saved filter/)
    expect(() => by.filter_state_save.run({ name: ' ' })).toThrow()
  })
  it('web_filter_set takes the bare community chip', () => {
    const { by, rec } = fx()
    by.web_filter_set.run({ tags: ['community'] })
    expect(rec().uiRings.show).toEqual(['community'])
  })
})

describe('event mode over MCP', () => {
  it('on by event_<slug>, off without an event', () => {
    const { by, rec } = fx()
    expect(by.event_mode_get.run({})).toEqual({ on: false })
    expect(by.event_mode_set.run({ event: 'event_Winter_IYG' })).toMatchObject({ on: true, id: 'e1', event: 'event_Winter_IYG' })
    expect(rec().uiRings.eventMode).toBe('e1')
    expect(rec().uiRings.show).toEqual(['tag:a'])
    expect(by.event_mode_set.run({})).toEqual({ on: false })
    expect(rec().uiRings.eventMode).toBeUndefined()
    expect(() => by.event_mode_set.run({ event: 'event_nope' })).toThrow(/no event/)
  })
})

describe('sub-communities over MCP', () => {
  it('community_create with a parent; the limit refuses', () => {
    const { by } = fx()
    by.community_create.run({ name: 'Root' })
    by.community_create.run({ name: 'Kid', parent: 'root' })
    expect(by.community_list.run({}).find((c) => c.id === 'kid').parent).toBe('root')
    for (let i = 0; i < SUBCOMMUNITY_FREE_LIMIT - 1; i++) by.community_create.run({ name: 'S' + i, parent: 'root' })
    expect(() => by.community_create.run({ name: 'Over', parent: 'root' })).toThrow(/free limit is 20/)
    expect(() => by.community_create.run({ name: 'Orphan', parent: 'ghost' })).toThrow(/no community/)
  })
})
