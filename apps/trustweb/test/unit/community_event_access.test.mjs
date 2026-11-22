// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 community-events-invite-only: who sees a community's events. Fake data. */
import { DEFAULT_EVENT_ACCESS, EVENT_ACCESS, eventAccessOf, invitedTo, isEventAccess, mayAnnounce, seesEvent, setEventAccess } from '../../src/community_event_access.ts'
import { applyJoined } from '../../src/event_community.ts'
import { parseCommunity } from '../../src/ext/community-mighty/community_data.ts'

const P = (id, name, over = {}) => ({ id, name, ring: 'friend', lines: [], context: '', metAt: 1, ...over })
const EV = { id: 'e1', name: 'Winter OG', from: '2026-12-30', where: '', createdAt: 1, attended: true, communityId: 'iyg' }
const rec = (people = [], mode) => ({ people, events: [EV], extData: { 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [], ...(mode ? { eventAccess: mode } : {}) } } } } })

describe('the mode', () => {
  it('members is the default; invited is stored and survives parseCommunity', () => {
    expect(EVENT_ACCESS).toEqual(['members', 'invited'])
    expect(DEFAULT_EVENT_ACCESS).toBe('members')
    const r = rec()
    expect(eventAccessOf(r, 'iyg')).toBe('members')
    setEventAccess(r, 'iyg', 'invited')
    expect(eventAccessOf(r, 'iyg')).toBe('invited')
    expect(parseCommunity(r.extData['community-mighty']).meta.iyg.eventAccess).toBe('invited')
    expect(eventAccessOf(rec([], 'bogus'), 'iyg')).toBe('members')
    expect(isEventAccess('invited')).toBe(true)
    expect(isEventAccess('all')).toBe(false)
  })
})

describe('who sees an event', () => {
  const member = P('m', 'Mia', { fields: { iyg: 'true' } })
  const stranger = P('s', 'Sam')
  it('mode members: members see it; a non-member only when invited personally', () => {
    const r = rec([member, stranger])
    expect(seesEvent(r, EV, member)).toBe(true)
    expect(seesEvent(r, EV, stranger)).toBe(false)
    expect(seesEvent(r, { ...EV, people: ['s'] }, stranger)).toBe(true)
  })
  it('mode invited: only the personally invited, members too', () => {
    const r = rec([member, stranger], 'invited')
    expect(seesEvent(r, EV, member)).toBe(false)
    expect(seesEvent(r, { ...EV, people: ['m'] }, member)).toBe(true)
    expect(seesEvent(r, EV, P('j', 'Jo', { events: ['e1'] }))).toBe(true)
  })
  it('an invitation shows that one event only: another event of the community stays hidden', () => {
    const r = rec([stranger])
    expect(seesEvent(r, { ...EV, people: ['s'] }, stranger)).toBe(true)
    expect(seesEvent(r, { ...EV, id: 'e2' }, stranger)).toBe(false)
  })
  it('an event outside any community is not restricted', () => {
    expect(seesEvent(rec(), { id: 'e9' }, stranger)).toBe(true)
  })
  it('invitedTo: on the invite list or joined', () => {
    expect(invitedTo({ id: 'e1', people: ['s'] }, stranger)).toBe(true)
    expect(invitedTo({ id: 'e1' }, P('x', 'X', { events: ['e1'] }))).toBe(true)
    expect(invitedTo({ id: 'e1' }, stranger)).toBe(false)
  })
})

describe('announce and the warning', () => {
  it('the community as a whole is told only in mode members', () => {
    expect(mayAnnounce(rec(), 'iyg')).toBe(true)
    expect(mayAnnounce(rec([], 'invited'), 'iyg')).toBe(false)
  })
})

describe('a non-member who accepts the invitation', () => {
  it('stays a non-member in mode invited (that event only); in mode members the joiner is placed as before', () => {
    const inv = rec([P('j', 'Jo', { ring: 'unsorted', peerId: 'peer-j' })], 'invited')
    inv.events = [{ ...EV, people: ['j'] }]
    expect(applyJoined(inv, 'peer-j', 'e1')).toBe(true)
    expect(inv.people[0]).toMatchObject({ events: ['e1'], ring: 'unsorted' })
    expect(inv.people[0].fields).toBeUndefined()
    const mem = rec([P('j', 'Jo', { ring: 'unsorted', peerId: 'peer-j' })])
    applyJoined(mem, 'peer-j', 'e1')
    expect(mem.people[0].fields).toEqual({ iyg: 'true' })
  })
})

describe('MCP community_event_visibility', () => {
  it('reads the mode, sets it, refuses a bad one and a write-off server has no setter', async () => {
    const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const { allTools } = await import('../../../mcp/src/tools.ts')
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-ceio-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], events: [], extData: { 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [] } } } } }))
    const by = (write) => Object.fromEntries(allTools({ file, write, now: () => new Date('2026-11-20T10:00:00Z') }).map((t) => [t.name, t]))
    expect(by(false).community_event_visibility).toBeUndefined()
    const t = by(true).community_event_visibility
    expect(t.run({ community: 'iyg' })).toEqual({ community: 'iyg', mode: 'members' })
    expect(t.run({ community: 'iyg', mode: 'invited' })).toEqual({ community: 'iyg', mode: 'invited' })
    expect(JSON.parse(readFileSync(file, 'utf8')).extData['community-mighty'].meta.iyg.eventAccess).toBe('invited')
    expect(t.run({ community: 'iyg' })).toEqual({ community: 'iyg', mode: 'invited' })
    expect(() => t.run({ community: 'iyg', mode: 'all' })).toThrow(/members or invited/)
  })
})
