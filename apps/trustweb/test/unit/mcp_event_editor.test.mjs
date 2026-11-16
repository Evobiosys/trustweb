// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 event-editor (MCP parity D-P02): drafts, direct invites, event details, calendars by tag, tech-support takeover over the record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 0, lines: [], fields: {} })
const base = () => ({ v: 1, me: { displayName: 'Jakob' }, people: [P('a', 'Ada Lovelace', 'friend'), P('b', 'Ben Huber', 'close')], sameAs: {}, meetings: [], events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 0, attended: true }] })
const NAMES = ['event_draft_save', 'event_drafts_list', 'event_invite', 'event_details_set', 'calendar_add', 'calendar_tag_toggle']
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpee-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-16T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('event editor tools', () => {
  it('are listed in mcp_config; the writes only with writes on, the list always', () => {
    for (const n of NAMES) expect(MCP_TOOLS.map((t) => t.name)).toContain(n)
    expect(Object.keys(fixture(false).by)).toContain('event_drafts_list')
    for (const n of NAMES.filter((x) => x !== 'event_drafts_list')) { expect(Object.keys(fixture(false).by)).not.toContain(n); expect(Object.keys(fixture().by)).toContain(n) }
  })
  it('event_draft_save keeps a draft (never an event); the same id replaces it; event_drafts_list reads them', () => {
    const f = fixture()
    const { id } = f.by.event_draft_save.run({ name: 'Picnic', from: '2026-12-01', where: 'Prater' })
    expect(f.rec().events.length).toBe(1)
    f.by.event_draft_save.run({ id, name: 'Picnic in the park' })
    const list = f.by.event_drafts_list.run({})
    expect(list).toEqual([{ id, name: 'Picnic in the park', from: '2026-12-01', where: 'Prater' }])
  })
  it('event_invite invites people directly by id or name; cohost:true also makes them hosts', () => {
    const f = fixture()
    expect(f.by.event_invite.run({ event: 'Winter IYG', people: ['Ada Lovelace', 'b'] })).toMatchObject({ id: 'e1', people: ['a', 'b'] })
    f.by.event_invite.run({ event: 'e1', people: ['b'], cohost: true })
    expect(f.rec().events[0]).toMatchObject({ people: ['a', 'b'], hosts: ['b'] })
    expect(() => f.by.event_invite.run({ event: 'e1', people: ['Nobody'] })).toThrow(/no person/)
  })
  it('event_details_set stores repeat, conference links, attachment, description and calendar', () => {
    const f = fixture()
    f.by.event_details_set.run({ event: 'e1', repeat: 'weekly', conference: [{ provider: 'kmeet', url: 'https://kmeet.infomaniak.com/x' }], attachment: 'https://kdrive.infomaniak.com/s/1', description: 'Practice' })
    expect(f.rec().events[0]).toMatchObject({ repeat: 'weekly', conference: [{ provider: 'kmeet' }], attachment: 'https://kdrive.infomaniak.com/s/1', docs: { description: 'Practice' } })
    expect(() => f.by.event_details_set.run({ event: 'e1', repeat: 'hourly' })).toThrow(/repeat/)
  })
  it('calendar_add + calendar_tag_toggle: a tag off hides its calendars; event_details_set refuses an unknown calendar', () => {
    const f = fixture()
    const { id } = f.by.calendar_add.run({ name: 'Vienna', tags: '#here #anna' })
    f.by.event_details_set.run({ event: 'e1', calendar: id })
    expect(f.by.calendar_tag_toggle.run({ tag: '#anna' })).toEqual({ tag: 'anna', on: false })
    expect(f.rec().calendars.off).toEqual(['anna'])
    expect(f.by.calendar_tag_toggle.run({ tag: 'anna', on: true })).toEqual({ tag: 'anna', on: true })
    expect(() => f.by.event_details_set.run({ event: 'e1', calendar: 'nope' })).toThrow(/calendar/)
  })
  it('event_settings_set techTakeover: the host lets technical support take over', () => {
    const f = fixture()
    expect(f.by.event_settings_set.run({ event: 'e1', techTakeover: true })).toMatchObject({ techTakeover: true })
    expect(f.rec().events[0].techTakeover).toBe(true)
    f.by.event_settings_set.run({ event: 'e1', techTakeover: false })
    expect(f.rec().events[0].techTakeover).toBeUndefined()
  })
})
