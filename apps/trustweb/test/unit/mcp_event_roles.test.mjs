// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 event-roles (MCP parity P02): event_roles_set and event_person_identify over the record file. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const P = (id, name, ring) => ({ id, name, context: '', ring, metAt: 0, lines: [], fields: {} })
const base = () => ({ v: 1, people: [P('a', 'Ada Lovelace', 'friend'), P('b', 'Ben Huber', 'close')], sameAs: {}, meetings: [], events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 0, attended: true }] })
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpr-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(base()))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-15T10:00:00Z') })
  return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('event roles tools', () => {
  it('are changes: only offered with writes on', () => {
    for (const n of ['event_roles_set', 'event_person_identify']) { expect(Object.keys(fixture(false).by)).not.toContain(n); expect(Object.keys(fixture().by)).toContain(n) }
  })
  it('event_roles_set stores the three lists; names of people become their ids, other names stay free names', () => {
    const f = fixture()
    const out = f.by.event_roles_set.run({ event: 'Winter IYG', organizers: ['Ada Lovelace', 'Verein X'], hosts: ['b'], techSupport: ['Ben Huber'] })
    expect(out).toMatchObject({ id: 'e1', organizers: ['a', 'Verein X'], hosts: ['b'], techSupport: ['b'] })
    expect(f.rec().events[0]).toMatchObject({ organizers: ['a', 'Verein X'], hosts: ['b'], techSupport: ['b'], organizer: 'Ada Lovelace, Verein X' })
  })
  it('event_roles_set leaves a list that is not given as it is; an empty list clears it', () => {
    const f = fixture()
    f.by.event_roles_set.run({ event: 'e1', hosts: ['b'], organizers: ['a'] })
    f.by.event_roles_set.run({ event: 'e1', organizers: [] })
    expect(f.rec().events[0].organizers).toBeUndefined()
    expect(f.rec().events[0].hosts).toEqual(['b'])
  })
  it('event_roles_set refuses an unknown event', () => {
    expect(() => fixture().by.event_roles_set.run({ event: 'nope', hosts: [] })).toThrow(/no event/)
  })
  it('event_person_identify finds a person by name (no duplicate) or makes one, tagged with the event', () => {
    const f = fixture()
    expect(f.by.event_person_identify.run({ event: 'e1', name: ' ada lovelace ' })).toEqual({ personId: 'a', created: false })
    const made = f.by.event_person_identify.run({ event: 'e1', name: 'Cleo Neu' })
    expect(made.created).toBe(true)
    const rec = f.rec()
    expect(rec.people).toHaveLength(3)
    expect(rec.people.at(-1)).toMatchObject({ id: made.personId, name: 'Cleo Neu', ring: 'unsorted', events: ['e1'] })
    expect(f.by.event_person_identify.run({ event: 'e1', name: 'Cleo Neu' })).toEqual({ personId: made.personId, created: false })
  })
  it('event_person_identify refuses an empty name', () => {
    expect(() => fixture().by.event_person_identify.run({ event: 'e1', name: ' ' })).toThrow(/name/)
  })
})
