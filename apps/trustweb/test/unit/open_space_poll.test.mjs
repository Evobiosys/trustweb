// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 open-space-date-poll: host proposes dates, people vote yes/maybe/no, "Use this date" sets the event date; wire and MCP. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { windowOf } from '../../src/open_space.ts'
import { POLL_MAX, addPollOption, leadingOption, mergePoll, tallyOf, useDate, votePoll } from '../../src/open_space_poll.ts'

const ev = (over = {}) => ({ id: 'e1', name: 'Open day', from: '2026-12-05T10:00', to: '2026-12-05T16:00', where: 'Online', createdAt: 1, attended: true, openSpace: { acts: [] }, ...over })

describe('options', () => {
  it('the host adds dates; a date needs YYYY-MM-DDTHH:MM, an end on the same day after the start', () => {
    const e = ev()
    const o = addPollOption(e, { from: '2026-12-12T10:00', to: '2026-12-12T15:00' }, 'o1')
    expect(o).toMatchObject({ id: 'o1', from: '2026-12-12T10:00', to: '2026-12-12T15:00', votes: {} })
    expect(e.openSpace.poll.options).toHaveLength(1)
    expect(() => addPollOption(e, { from: '2026-12-12' }, 'o2')).toThrow(/date/)
    expect(() => addPollOption(e, { from: '2026-13-12T10:00' }, 'o2')).toThrow(/date/)
    expect(() => addPollOption(e, { from: '2026-12-13T10:00', to: '2026-12-14T09:00' }, 'o2')).toThrow(/end/)
    expect(() => addPollOption(e, { from: '2026-12-13T10:00', to: '2026-12-13T09:00' }, 'o2')).toThrow(/end/)
    expect(() => addPollOption(e, { from: '2026-12-12T10:00', to: '2026-12-12T15:00' }, 'o3')).toThrow(/already/)
    expect(() => addPollOption({ ...ev(), openSpace: undefined }, { from: '2026-12-12T10:00' }, 'o2')).toThrow(/open space/)
  })
  it('holds at most POLL_MAX dates and none once a date is chosen', () => {
    const e = ev()
    for (let i = 0; i < POLL_MAX; i++) addPollOption(e, { from: `2026-12-${String(10 + i).padStart(2, '0')}T10:00` }, `o${i}`)
    expect(() => addPollOption(e, { from: '2027-01-01T10:00' }, 'x')).toThrow(/at most/)
    const f = ev()
    addPollOption(f, { from: '2026-12-12T10:00' }, 'a')
    useDate(f, 'a')
    expect(() => addPollOption(f, { from: '2026-12-13T10:00' }, 'b')).toThrow(/chosen/)
  })
})

describe('votes and the winner', () => {
  const poll = () => {
    const e = ev()
    addPollOption(e, { from: '2026-12-12T10:00', to: '2026-12-12T15:00' }, 'a')
    addPollOption(e, { from: '2026-12-19T09:00' }, 'b')
    return e
  }
  it('one vote per person per date; the answer changes, a repeat changes nothing', () => {
    const e = poll()
    expect(votePoll(e, 'a', 't1', 'yes', 10)).toBe(true)
    expect(votePoll(e, 'a', 't1', 'yes', 11)).toBe(false)
    expect(votePoll(e, 'a', 't1', 'no', 12)).toBe(true)
    votePoll(e, 'a', 't2', 'maybe', 13)
    expect(tallyOf(e.openSpace.poll.options[0])).toEqual({ yes: 0, maybe: 1, no: 1 })
    expect(() => votePoll(e, 'zz', 't1', 'yes', 1)).toThrow(/no date/)
    expect(() => votePoll(e, 'a', 't1', 'perhaps', 1)).toThrow(/yes, maybe or no/)
    expect(() => votePoll(ev(), 'a', 't1', 'yes', 1)).toThrow(/no date poll/)
  })
  it('the leader has the most yes, then yes plus maybe, then the earliest date; nobody yes = none', () => {
    const e = poll()
    expect(leadingOption(e.openSpace.poll)).toBeNull()
    votePoll(e, 'b', 't1', 'maybe', 1)
    expect(leadingOption(e.openSpace.poll)).toBeNull()
    votePoll(e, 'b', 't1', 'yes', 2)
    expect(leadingOption(e.openSpace.poll).id).toBe('b')
    votePoll(e, 'a', 't1', 'yes', 3)
    expect(leadingOption(e.openSpace.poll).id).toBe('a')
    votePoll(e, 'b', 't2', 'maybe', 4)
    expect(leadingOption(e.openSpace.poll).id).toBe('b')
    votePoll(e, 'a', 't2', 'yes', 5)
    expect(leadingOption(e.openSpace.poll).id).toBe('a')
  })
  it('"Use this date" sets the event date and window; an option without an end drops the end', () => {
    const e = poll()
    useDate(e, 'a')
    expect(e).toMatchObject({ from: '2026-12-12T10:00', to: '2026-12-12T15:00' })
    expect(e.openSpace.poll.chosen).toBe('a')
    expect(windowOf(e)).toEqual({ day: '2026-12-12', start: '10:00', end: '15:00' })
    const f = poll()
    useDate(f, 'b')
    expect(f.from).toBe('2026-12-19T09:00')
    expect(f.to).toBeUndefined()
    expect(() => useDate(f, 'zz')).toThrow(/no date/)
    expect(() => useDate(ev(), 'a')).toThrow(/no date poll/)
  })
})

describe('merge from another device', () => {
  const base = () => { const e = ev(); addPollOption(e, { from: '2026-12-12T10:00' }, 'a'); return e }
  const wire = (e) => JSON.parse(JSON.stringify(e.openSpace.poll))
  it('votes unite, the later answer wins; dates and the choice come only from a host', () => {
    const mine = base()
    votePoll(mine, 'a', 't1', 'yes', 5)
    const theirs = base()
    votePoll(theirs, 'a', 't1', 'no', 9)
    votePoll(theirs, 'a', 't2', 'yes', 4)
    addPollOption(theirs, { from: '2026-12-20T10:00' }, 'b')
    expect(mergePoll(mine, wire(theirs), false)).toBe(true)
    expect(mine.openSpace.poll.options).toHaveLength(1)
    expect(tallyOf(mine.openSpace.poll.options[0])).toEqual({ yes: 1, maybe: 0, no: 1 })
    expect(mergePoll(mine, wire(theirs), false)).toBe(false)
    expect(mergePoll(mine, wire(theirs), true)).toBe(true)
    expect(mine.openSpace.poll.options.map((o) => o.id)).toEqual(['a', 'b'])
    useDate(theirs, 'b')
    expect(mergePoll(mine, wire(theirs), false)).toBe(false)
    expect(mine.from).toBe('2026-12-05T10:00')
    expect(mergePoll(mine, wire(theirs), true)).toBe(true)
    expect(mine).toMatchObject({ from: '2026-12-20T10:00' })
    expect(mine.openSpace.poll.chosen).toBe('b')
  })
  it('a host poll opens a poll on an event without one; rubbish is skipped', () => {
    const mine = ev()
    const theirs = base()
    expect(mergePoll(mine, wire(theirs), false)).toBe(false)
    expect(mergePoll(mine, wire(theirs), true)).toBe(true)
    expect(mine.openSpace.poll.options).toHaveLength(1)
    const bad = { options: [{ id: 'x y', from: 'nope', votes: {} }, { id: 'c', from: '2026-12-21T10:00', votes: { t9: { v: 'perhaps', at: 1 }, t8: { v: 'yes', at: -4 }, '!!': { v: 'yes', at: 1 } } }], chosen: 'zz' }
    expect(mergePoll(mine, bad, true)).toBe(true)
    expect(mine.openSpace.poll.options.map((o) => o.id)).toEqual(['a', 'c'])
    expect(mine.openSpace.poll.options[1].votes).toEqual({})
    expect(mine.openSpace.poll.chosen).toBeUndefined()
    expect(mergePoll(mine, 'junk', true)).toBe(false)
    expect(mergePoll({ ...ev(), openSpace: undefined }, wire(theirs), true)).toBe(false)
  })
})

describe('wire and envelope', () => {
  it('the poll travels in the os envelope within the size limit', () => {
    const poll = { options: [{ id: 'a', from: '2026-12-12T10:00', votes: { t1: { v: 'yes', at: 5 } } }] }
    const env = { v: 1, t: 'event', os: { id: 'e1', open: true, acts: [], poll } }
    expect(decodeFromQr(encodeForQr(env))).toMatchObject({ os: { poll } })
    const huge = { options: [{ id: 'a', from: '2026-12-12T10:00', votes: Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [`t${i}`, { v: 'yes', at: 1 }])) }] }
    expect(decodeFromQr(encodeForQr({ ...env, os: { ...env.os, poll: huge } }))).toBeNull()
  })
  const host = (state, sent = []) => ({
    state: () => state, save: () => undefined, now: () => 1000, link: () => 'https://app.trustweb.one/#ev=x', send: async (p, e) => { sent.push([p.id, e]) },
    pending: () => null, setPending: () => undefined, changed: () => undefined, later: () => undefined,
    recipients: () => [{ id: 'p-ben' }, { id: 'p-cleo' }],
  })
  it('a host message adds the poll to a held open space and passes it on; a guest cannot add dates', async () => {
    const sent = []
    const state = { me: { id: 'me', displayName: 'Mia Probe' }, people: [{ id: 'h', name: 'Hanna Host', peerId: 'p-h' }, { id: 'b', name: 'Ben', peerId: 'p-ben' }], events: [ev({ attended: false, fromLink: true, hosts: ['Hanna Host'] })] }
    const e = createEventEnvelopes(host(state, sent))
    const poll = { options: [{ id: 'a', from: '2026-12-12T10:00', votes: {} }] }
    const env = { v: 1, t: 'event', os: { id: 'e1', acts: [], poll } }
    expect(await e.onEnvelope({ id: 'p-ben' }, env)).toBe('ignored')
    expect(state.events[0].openSpace.poll).toBeUndefined()
    expect(await e.onEnvelope({ id: 'p-h' }, env)).toBe('filled')
    expect(state.events[0].openSpace.poll.options).toHaveLength(1)
    expect(sent.map(([to]) => to)).toEqual(['p-ben', 'p-cleo'])
    expect(sent[0][1].os.poll.options).toHaveLength(1)
  })
})

describe('MCP', () => {
  const NAMES = ['open_space_poll_get', 'open_space_poll_add', 'open_space_poll_vote', 'open_space_poll_use']
  function fixture(write = true, over = {}) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-osp-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me', displayName: 'Mia Probe' }, people: [], sameAs: {}, meetings: [], events: [ev(over)] }))
    const tools = recordTools({ file, write, now: () => new Date('2026-12-01T10:00:00Z') })
    return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('registered: get is a read, the rest are writes', () => {
    for (const n of NAMES) expect(MCP_TOOLS.find((t) => t.name === n)).toMatchObject({ write: n !== 'open_space_poll_get' })
    expect(Object.keys(fixture(false).by).filter((n) => n.startsWith('open_space_poll'))).toEqual(['open_space_poll_get'])
    expect(Object.keys(fixture().by)).toEqual(expect.arrayContaining(NAMES))
  })
  it('add, vote, get, use', () => {
    const f = fixture()
    expect(f.by.open_space_poll_get.run({ event: 'e1' })).toMatchObject({ options: [], chosen: null })
    const a = f.by.open_space_poll_add.run({ event: 'e1', from: '2026-12-12T10:00', to: '2026-12-12T15:00' })
    expect(a).toMatchObject({ from: '2026-12-12T10:00' })
    expect(() => f.by.open_space_poll_add.run({ event: 'e1', from: 'soon' })).toThrow(/date/)
    expect(f.by.open_space_poll_vote.run({ event: 'Open day', option: a.id, vote: 'yes' })).toMatchObject({ yes: 1, changed: true, mine: 'yes' })
    expect(f.by.open_space_poll_vote.run({ event: 'e1', option: a.id, vote: 'yes' })).toMatchObject({ changed: false })
    const g = f.by.open_space_poll_get.run({ event: 'e1' })
    expect(g.options[0]).toMatchObject({ id: a.id, yes: 1, maybe: 0, no: 0, mine: 'yes' })
    expect(g.leading).toBe(a.id)
    expect(f.by.open_space_poll_use.run({ event: 'e1', option: a.id })).toMatchObject({ from: '2026-12-12T10:00', to: '2026-12-12T15:00' })
    expect(f.rec().events[0]).toMatchObject({ from: '2026-12-12T10:00' })
    expect(f.rec().events[0].openSpace.poll.chosen).toBe(a.id)
  })
  it('only a host adds dates and uses one', () => {
    const f = fixture(true, { fromLink: true, hosts: ['Hanna'], openSpace: { acts: [], poll: { options: [{ id: 'a', from: '2026-12-12T10:00', votes: {} }] } } })
    expect(() => f.by.open_space_poll_add.run({ event: 'e1', from: '2026-12-13T10:00' })).toThrow(/host/)
    expect(() => f.by.open_space_poll_use.run({ event: 'e1', option: 'a' })).toThrow(/host/)
    expect(f.by.open_space_poll_vote.run({ event: 'e1', option: 'a', vote: 'maybe' })).toMatchObject({ maybe: 1 })
  })
})
