// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b community-shell: MCP parity (community_menu_get, community_home_tiles_set, community_chat_scope_set, event_link_mode_set, settings name / connect_events). */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const base = () => ({
  v: 1, people: [], me: { displayName: 'Tester' },
  events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true }],
  extData: { 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['me'], name: 'IYG circle' }, book: { kind: 'informal', organizers: [], name: 'Book club' } } } },
  sameAs: {}, meetings: [],
})
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcps-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-15T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('community shell tools', () => {
  it('menu_get is a read tool; the three setters need writes on', () => {
    const off = Object.keys(fixture(false).by)
    expect(off).toContain('community_menu_get')
    for (const n of ['community_home_tiles_set', 'community_chat_scope_set', 'event_link_mode_set']) {
      expect(off).not.toContain(n)
      expect(Object.keys(fixture().by)).toContain(n)
    }
  })
  it('community_menu_get: the menu order, the tiles, the chat scope, connect events', () => {
    const out = fixture().by.community_menu_get.run({ community: 'iyg' })
    expect(out.items).toEqual(['home', 'spaces', 'events', 'docs', 'resources', 'references', 'chat', 'ask', 'timeline', 'members'])
    expect(out.tiles).toEqual({ managed: [], own: ['events', 'spaces', 'docs', 'members'] })
    expect(out).toMatchObject({ chatOnly: true, connectEvents: false, manager: true })
    expect(() => fixture().by.community_menu_get.run({ community: 'nope' })).toThrow(/no community/)
  })
  it('community_home_tiles_set: my tiles, and the managed ones only for a manager', () => {
    const f = fixture()
    expect(f.by.community_home_tiles_set.run({ community: 'book', tiles: ['timeline', 'events'] })).toMatchObject({ own: ['events', 'timeline'] })
    expect(f.rec().extData['community-mighty'].meta.book.tiles).toEqual(['events', 'timeline'])
    expect(f.by.community_home_tiles_set.run({ community: 'iyg', managed: ['docs'] })).toMatchObject({ managed: ['docs'] })
    expect(() => f.by.community_home_tiles_set.run({ community: 'book', managed: ['docs'] })).toThrow(/manager/)
    expect(() => f.by.community_home_tiles_set.run({ community: 'book' })).toThrow(/tiles/)
  })
  it('community_chat_scope_set: only people of the community, on or off', () => {
    const f = fixture()
    expect(f.by.community_chat_scope_set.run({ only: false })).toEqual({ only: false })
    expect(f.rec().extData['community-mighty'].chatOnly).toBe(false)
    expect(f.by.community_chat_scope_set.run({ only: true })).toEqual({ only: true })
    expect(f.rec().extData['community-mighty'].chatOnly).toBeUndefined()
    expect(() => f.by.community_chat_scope_set.run({ only: 'x' })).toThrow(/only/)
  })
  it('community_settings_set also renames and connects the events', () => {
    const f = fixture()
    f.by.community_settings_set.run({ community: 'iyg', name: 'IYG Crew', connect_events: true })
    const m = f.rec().extData['community-mighty'].meta.iyg
    expect(m).toMatchObject({ name: 'IYG Crew', connectEvents: true })
  })
  it('event_link_mode_set: event = what people see when they open the link', () => {
    const f = fixture()
    expect(f.by.event_link_mode_set.run({ event: 'Winter IYG', mode: 'event' })).toEqual({ id: 'e1', mode: 'event' })
    expect(f.rec().events[0].linkMode).toBe('event')
    expect(f.by.event_link_mode_set.run({ event: 'e1', mode: 'full' })).toEqual({ id: 'e1', mode: 'full' })
    expect(f.rec().events[0].linkMode).toBeUndefined()
    expect(() => f.by.event_link_mode_set.run({ event: 'e1', mode: 'x' })).toThrow(/mode/)
    expect(() => f.by.event_link_mode_set.run({ event: 'zzz', mode: 'event' })).toThrow(/no event/)
  })
})
