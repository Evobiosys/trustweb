// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-event-visibility-3: the host's default for participants, asked once; MCP parity. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { answerHostDefault, applyEventSettings, hostDefaultPending } from '../../src/event_press.ts'
import { decodeEventLink, encodeEventLink, shortFields } from '../../src/event_link.ts'
import { joinEvent, localSettings } from '../../src/events.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'

const ev = (over = {}) => ({ id: 'e1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, ...over })

describe('host default for participants', () => {
  it('setting validates and is stored, also for the default value', () => {
    const e = ev()
    applyEventSettings(e, { hostDefault: 'discoverable' })
    expect(e.hostDefault).toBe('discoverable')
    expect(() => applyEventSettings(e, { hostDefault: 'nope' })).toThrow()
  })

  it('travels in the long and the short event link, and a join keeps it', () => {
    const host = ev({ hostDefault: 'off' })
    const long = decodeEventLink(new URL(encodeEventLink(host, 'https://x.test', 'peer')).hash)
    expect(long.hostDefault).toBe('off')
    const short = decodeEventLink(`#evs=${shortFields({ ...host, kind: 'peer' })}`)
    expect(short.hostDefault).toBe('off')
    expect(decodeEventLink(new URL(encodeEventLink(ev(), 'https://x.test', 'peer')).hash).hostDefault).toBeUndefined()
    const s = { events: [] }
    joinEvent(s, long, 5)
    expect(s.events[0].hostDefault).toBe('off')
  })

  it('a value outside the three is dropped from a link', () => {
    const bad = encodeEventLink(ev({ hostDefault: 'nope' }), 'https://x.test', 'peer')
    expect(decodeEventLink(new URL(bad).hash).hostDefault).toBeUndefined()
  })

  it('is asked once to a participant, never to the host', () => {
    const e = ev({ hostDefault: 'open' })
    expect(hostDefaultPending(e, false)).toBe('open')
    expect(hostDefaultPending(e, true)).toBeUndefined()
    expect(hostDefaultPending(ev(), false)).toBeUndefined()
    answerHostDefault(e, 'keep')
    expect(e.showMe).toBe('open')
    expect(hostDefaultPending(e, false)).toBeUndefined()
  })

  it('Change keeps my mode; my own choice wins afterwards', () => {
    const e = ev({ hostDefault: 'off', showMe: 'open' })
    answerHostDefault(e, 'change')
    expect(e.showMe).toBe('open')
    expect(hostDefaultPending(e, false)).toBeUndefined()
    applyEventSettings(e, { showMe: 'discoverable' })
    expect('showMe' in e).toBe(false)
    expect(e.hostDefault).toBe('off')
  })

  it('an edit of the event form keeps both fields', () => {
    expect(localSettings(ev({ hostDefault: 'off', hostDefaultAnswered: true }))).toMatchObject({ hostDefault: 'off', hostDefaultAnswered: true })
  })
})

describe('MCP parity: event_visibility_default', () => {
  const fixture = (events, people = []) => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'tw-vd-')), 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { displayName: 'Jakob' }, people, sameAs: {}, meetings: [], events }))
    return { file, by: Object.fromEntries(recordTools({ file, write: true, now: () => new Date('2026-11-16T10:00:00Z') }).map((t) => [t.name, t])) }
  }
  it('is listed', () => expect(MCP_TOOLS.map((t) => t.name)).toContain('event_visibility_default'))
  it('the organizer sets it; a participant answers it once', () => {
    const org = fixture([ev({ organizers: ['Jakob'] })])
    expect(org.by.event_visibility_default.run({ event: 'e1', default: 'open' })).toMatchObject({ hostDefault: 'open', waiting: null })
    expect(JSON.parse(readFileSync(org.file, 'utf8')).events[0].hostDefault).toBe('open')
    expect(() => org.by.event_visibility_default.run({ event: 'e1', default: 'nope' })).toThrow()
    const guest = fixture([ev({ hostDefault: 'off', fromLink: true, hosts: ['Someone'] })])
    expect(() => guest.by.event_visibility_default.run({ event: 'e1', default: 'open' })).toThrow()
    expect(guest.by.event_visibility_default.run({ event: 'e1' })).toMatchObject({ waiting: 'off', answered: false })
    expect(guest.by.event_visibility_default.run({ event: 'e1', answer: 'keep' })).toMatchObject({ waiting: null, answered: true, showMe: 'off' })
    expect(() => guest.by.event_visibility_default.run({ event: 'e1', answer: 'keep' })).toThrow()
  })
})
