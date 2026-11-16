// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 event-press-share (MCP parity): event_settings_set, event_offers_set, event_times_set, me_nickname_set. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'

const EV = { id: 'e1', name: 'Winter Forum', from: '2026-11-15T09:30', to: '2026-11-18', where: 'Town', createdAt: 1, attended: true, hosts: ['Mia'] }
function fixture(write = true) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-mcpp-'))
  const file = path.join(dir, 'record.json')
  writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me', displayName: 'Mia Probe' }, people: [], sameAs: {}, meetings: [], events: [EV] }))
  const tools = recordTools({ file, write, now: () => new Date('2026-11-15T10:00:00Z') })
  return { file, by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
}

describe('event press tools', () => {
  it('are changes: only offered with writes on', () => {
    for (const n of ['event_settings_set', 'event_offers_set', 'event_times_set', 'me_nickname_set']) {
      expect(Object.keys(fixture(false).by)).not.toContain(n)
      expect(Object.keys(fixture().by)).toContain(n)
    }
  })
  it('event_settings_set stores the invite policy, notifications and name reveal (by id or exact name)', () => {
    const f = fixture()
    expect(f.by.event_settings_set.run({ event: 'e1', invitePolicy: 'everyone', notify: false, nameReveal: 'nick' })).toMatchObject({ id: 'e1', invitePolicy: 'everyone', notify: false, nameReveal: 'nick' })
    expect(f.rec().events[0]).toMatchObject({ invitePolicy: 'everyone', notify: false, nameReveal: 'nick' })
    f.by.event_settings_set.run({ event: 'winter forum', invitePolicy: 'hosts', notify: true })
    expect(f.rec().events[0].invitePolicy).toBeUndefined()
    expect(f.rec().events[0].notify).toBeUndefined()
  })
  it('review-fixes-43: notify true also lifts a muted "I\'m here now" bell of that event (one switch, as on the event page)', () => {
    const f = fixture()
    const r = f.rec(); r.atEvent = { eventId: 'e1', since: 1, bell: false }; writeFileSync(f.file, JSON.stringify(r))
    expect(f.by.event_settings_set.run({ event: 'e1', notify: true })).toMatchObject({ notify: true })
    expect(f.rec().atEvent).toEqual({ eventId: 'e1', since: 1 })
  })
  it('event_settings_set refuses a value outside the choices and an unknown event', () => {
    const f = fixture()
    expect(() => f.by.event_settings_set.run({ event: 'e1', invitePolicy: 'anyone' })).toThrow(/invitePolicy/)
    expect(() => f.by.event_settings_set.run({ event: 'nope', notify: false })).toThrow(/no event/)
  })
  it('event_offers_set switches support, resources and feed', () => {
    const f = fixture()
    expect(f.by.event_offers_set.run({ event: 'e1', feed: true, support: true })).toMatchObject({ offers: { support: true, resources: false, feed: true } })
    expect(f.rec().events[0].offers).toEqual({ support: true, resources: false, feed: true })
    f.by.event_offers_set.run({ event: 'e1', feed: false, support: false })
    expect(f.rec().events[0].offers).toBeUndefined()
  })
  it('event_times_set stays longer, and refuses an end before the start', () => {
    const f = fixture()
    expect(f.by.event_times_set.run({ event: 'e1', to: '2026-11-25' })).toMatchObject({ from: '2026-11-15T09:30', to: '2026-11-25' })
    expect(f.rec().events[0].to).toBe('2026-11-25')
    expect(() => f.by.event_times_set.run({ event: 'e1', to: '2026-11-01' })).toThrow(/to/)
    expect(f.rec().events[0].to).toBe('2026-11-25')
  })
  it('me_nickname_set stores and clears my nickname', () => {
    const f = fixture()
    expect(f.by.me_nickname_set.run({ nickname: ' Addy ' })).toEqual({ nickname: 'Addy' })
    expect(f.rec().me.nickname).toBe('Addy')
    f.by.me_nickname_set.run({ nickname: '' })
    expect(f.rec().me.nickname).toBeUndefined()
  })
})
