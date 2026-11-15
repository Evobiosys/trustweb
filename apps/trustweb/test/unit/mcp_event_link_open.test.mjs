// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b event-qr-join (MCP parity P02): event_link_open(eventId | url) -> {view: 'edit' | 'normal'}. Fake data only. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { encodeEventLink } from '../../src/event_link.ts'
import { newEvent } from '../../src/events.ts'

const rec = () => ({ v: 1, me: { id: 'me1', displayName: 'Ben Example' }, people: [], sameAs: {}, meetings: [], events: [{ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 0, attended: true, fromLink: true, hosts: ['Ben Example'] }, { id: 'e2', name: 'Summer Camp', from: '2027-07-01', where: 'Graz', createdAt: 0, attended: true, fromLink: true, hosts: ['Cleo Example'] }] })
function tools(write) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpl-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify(rec()))
  return Object.fromEntries(recordTools({ file, write, now: () => new Date('2026-11-15T10:00:00Z') }).map((t) => [t.name, t]))
}

describe('event_link_open', () => {
  it('is a read: offered with writes off too', () => { expect(Object.keys(tools(false))).toContain('event_link_open') })
  it('by event id or name: edit for a host of it, normal for another event', () => {
    const t = tools(false)
    expect(t.event_link_open.run({ eventId: 'e1' })).toEqual({ id: 'e1', view: 'edit' })
    expect(t.event_link_open.run({ eventId: 'Summer Camp' })).toEqual({ id: 'e2', view: 'normal' })
  })
  it('by url: a peer link of an event nobody here hosts opens normal, a host link opens edit', () => {
    const t = tools(false)
    const ev = newEvent({ name: 'New Meet', from: '2027-02-01', where: 'Linz' }, 'e9', 0)
    expect(t.event_link_open.run({ url: encodeEventLink(ev, 'https://app.trustweb.one', 'peer') })).toEqual({ id: 'e9', view: 'normal' })
    expect(t.event_link_open.run({ url: encodeEventLink(ev, 'https://app.trustweb.one', 'host') })).toEqual({ id: 'e9', view: 'edit' })
  })
  it('by url: an event held here follows my role in it', () => {
    const t = tools(false)
    const ev = newEvent({ name: 'Winter IYG', from: '2026-12-30', where: 'Vienna' }, 'e1', 0)
    expect(t.event_link_open.run({ url: encodeEventLink(ev, 'https://app.trustweb.one', 'peer') })).toEqual({ id: 'e1', view: 'edit' })
  })
  it('refuses nothing to open', () => {
    expect(() => tools(false).event_link_open.run({})).toThrow(/eventId or url/)
    expect(() => tools(false).event_link_open.run({ url: 'https://x.example/#nope' })).toThrow(/event link/)
    expect(() => tools(false).event_link_open.run({ eventId: 'zzz' })).toThrow(/no event/)
  })
})
