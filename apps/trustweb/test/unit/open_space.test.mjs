// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-open-space: online open space (one shared schedule, "I join", host flag "Everyone can see everyone"), its wire, MCP tools. Fake data only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { recordTools } from '../../../mcp/src/record_tools.ts'
import { applyEventSettings } from '../../src/event_press.ts'
import { listedAttendees, visibilityOf } from '../../src/event_visibility.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { eventFromFields, fieldsOf } from '../../src/event_editor.ts'
import { emptyFields } from '../../src/event_draft.ts'
import { MCP_TOOLS } from '../../src/ext/mcp-local/mcp_config.ts'
import { OS_MAX_ACTS, joinActivity, joinedOf, leaveActivity, mergeActivities, proposeActivity, sortedActivities, tokenOf, windowOf } from '../../src/open_space.ts'

const ev = (over = {}) => ({ id: 'e1', name: 'Open day', from: '2026-12-05T10:00', to: '2026-12-05T16:00', where: 'Online', createdAt: 1, attended: true, openSpace: { acts: [] }, ...over })
const s = { me: { id: 'me', displayName: 'Mia Probe' }, people: [] }

describe('window and propose', () => {
  it('the window is the event day with its start and end time', () => {
    expect(windowOf(ev())).toEqual({ day: '2026-12-05', start: '10:00', end: '16:00' })
    expect(windowOf(ev({ to: undefined }))).toEqual({ day: '2026-12-05', start: '10:00', end: '23:59' })
  })
  it('a proposal needs a title and a slot inside the window; the proposer joins', () => {
    const e = ev()
    const a = proposeActivity(e, { title: 'Somatics class', slot: '11:30', description: 'Gentle movement' }, 'Mia Probe', 'a1', 100)
    expect(a).toMatchObject({ id: 'a1', title: 'Somatics class', slot: '11:30', by: 'Mia Probe', description: 'Gentle movement' })
    expect(a.joins).toEqual({ [tokenOf('e1', 'Mia Probe')]: 100 })
    expect(e.openSpace.acts).toHaveLength(1)
    expect(() => proposeActivity(e, { title: ' ', slot: '11:30' }, 'Mia', 'a2', 1)).toThrow(/title/)
    expect(() => proposeActivity(e, { title: 'x', slot: '9:5' }, 'Mia', 'a2', 1)).toThrow(/slot/)
    expect(() => proposeActivity(e, { title: 'x', slot: '09:00' }, 'Mia', 'a2', 1)).toThrow(/window/)
    expect(() => proposeActivity(e, { title: 'x', slot: '16:30' }, 'Mia', 'a2', 1)).toThrow(/window/)
    expect(() => proposeActivity({ ...ev(), openSpace: undefined }, { title: 'x', slot: '11:00' }, 'Mia', 'a2', 1)).toThrow(/open space/)
    expect(() => proposeActivity(e, { title: 'x'.repeat(81), slot: '11:00' }, 'Mia', 'a2', 1)).toThrow(/title/)
  })
  it('the schedule holds at most OS_MAX_ACTS activities and sorts by slot', () => {
    const e = ev()
    proposeActivity(e, { title: 'Late', slot: '15:00' }, 'Mia', 'z', 1)
    proposeActivity(e, { title: 'Early', slot: '10:30' }, 'Mia', 'y', 1)
    expect(sortedActivities(e).map((a) => a.title)).toEqual(['Early', 'Late'])
    for (let i = 0; i < OS_MAX_ACTS - 2; i++) proposeActivity(e, { title: `t${i}`, slot: '12:00' }, 'Mia', `i${i}`, 1)
    expect(() => proposeActivity(e, { title: 'one more', slot: '12:00' }, 'Mia', 'over', 1)).toThrow(/at most/)
  })
})

describe('I join', () => {
  it('joins and leaves once; false when nothing changed', () => {
    const e = ev()
    proposeActivity(e, { title: 'Talk', slot: '12:00' }, 'Ben', 'a1', 1)
    const me = tokenOf('e1', 'Mia Probe')
    expect(joinActivity(e, 'a1', me, 10)).toBe(true)
    expect(joinActivity(e, 'a1', me, 11)).toBe(false)
    expect(joinedOf(e.openSpace.acts[0])).toContain(me)
    expect(leaveActivity(e, 'a1', me, 12)).toBe(true)
    expect(leaveActivity(e, 'a1', me, 13)).toBe(false)
    expect(joinedOf(e.openSpace.acts[0])).toEqual([tokenOf('e1', 'Ben')])
    expect(() => joinActivity(e, 'nope', me, 14)).toThrow(/no activity/)
  })
  it('a token is the same on every device, differs per event and carries no readable name', () => {
    expect(tokenOf('e1', 'Ben Gruber')).toBe(tokenOf('e1', ' ben gruber '))
    expect(tokenOf('e1', 'Ben Gruber')).not.toBe(tokenOf('e2', 'Ben Gruber'))
    expect(tokenOf('e1', 'Ben Gruber')).not.toMatch(/ben/i)
  })
})

describe('merging what another device sent', () => {
  it('unions activities by id and joins by token; bad entries are dropped; true when something changed', () => {
    const e = ev()
    proposeActivity(e, { title: 'Mine', slot: '11:00' }, 'Mia', 'a1', 1)
    const theirs = [
      { id: 'a1', title: 'Mine', slot: '11:00', by: 'Mia', joins: { 't-ben': 5 } },
      { id: 'a2', title: 'Theirs', slot: '13:00', by: 'Ben', joins: {} },
      { id: 'a3', title: '', slot: '13:00', by: 'Ben', joins: {} },
      { id: 'a4', title: 'Outside', slot: '07:00', by: 'Ben', joins: {} },
      'junk', null,
    ]
    expect(mergeActivities(e, theirs)).toBe(true)
    expect(e.openSpace.acts.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
    expect(joinedOf(e.openSpace.acts.find((a) => a.id === 'a1'))).toEqual(expect.arrayContaining(['t-ben', tokenOf('e1', 'Mia')]))
    expect(mergeActivities(e, theirs)).toBe(false)
  })
  it('the later change of one person wins, so a leave survives the merge', () => {
    const e = ev()
    proposeActivity(e, { title: 'Talk', slot: '11:00' }, 'Ben', 'a1', 1)
    const ben = tokenOf('e1', 'Ben')
    leaveActivity(e, 'a1', ben, 50)
    expect(mergeActivities(e, [{ id: 'a1', title: 'Talk', slot: '11:00', by: 'Ben', joins: { [ben]: 1 } }])).toBe(false)
    expect(joinedOf(e.openSpace.acts[0])).toEqual([])
    expect(mergeActivities(e, [{ id: 'a1', title: 'Talk', slot: '11:00', by: 'Ben', joins: { [ben]: 90 } }])).toBe(true)
    expect(joinedOf(e.openSpace.acts[0])).toEqual([ben])
  })
  it('refuses an event that is no open space and keeps the first copy of a title', () => {
    expect(mergeActivities({ ...ev(), openSpace: undefined }, [{ id: 'a1', title: 'x', slot: '11:00', by: 'B', joins: {} }])).toBe(false)
    const e = ev()
    proposeActivity(e, { title: 'First', slot: '11:00' }, 'Mia', 'a1', 1)
    mergeActivities(e, [{ id: 'a1', title: 'Changed', slot: '12:00', by: 'Evil', joins: {} }])
    expect(e.openSpace.acts[0]).toMatchObject({ title: 'First', slot: '11:00', by: 'Mia' })
  })
})

describe('host flag: everyone can see everyone', () => {
  const people = [{ id: 'a', name: 'Ada', eventShow: { e1: 'discoverable' } }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cleo', eventShow: { e1: 'off' } }]
  it('default: only open people are listed; with the flag discoverable people are listed too, off stays hidden', () => {
    expect(listedAttendees(people, 'e1').map((p) => p.id)).toEqual(['b'])
    expect(listedAttendees(people, 'e1', true).map((p) => p.id)).toEqual(['a', 'b'])
  })
  it('the flag turns my own default to show; an explicit choice stays', () => {
    expect(visibilityOf({})).toBe('discoverable')
    expect(visibilityOf({ showAll: true })).toBe('open')
    expect(visibilityOf({ showAll: true, showMe: 'off' })).toBe('off')
  })
  it('applyEventSettings stores the flag and the type; the type cannot go while activities exist', () => {
    const e = { id: 'e', name: 'x', from: '2026-12-05T10:00', to: '2026-12-05T16:00', where: '', createdAt: 1, attended: true }
    applyEventSettings(e, { showAll: true, openSpace: true })
    expect(e).toMatchObject({ showAll: true, openSpace: { acts: [] } })
    proposeActivity(e, { title: 'x', slot: '11:00' }, 'M', 'a1', 1)
    expect(() => applyEventSettings(e, { openSpace: false })).toThrow(/activities/)
    applyEventSettings(e, { showAll: false })
    expect(e.showAll).toBeUndefined()
  })
  it('the flag travels in the event link', () => {
    const link = encodeEventLink(ev({ showAll: true }), 'https://app.trustweb.one', 'peer')
    expect(decodeEventLink(link.slice(link.indexOf('#'))).showAll).toBe(true)
    const plain = encodeEventLink(ev(), 'https://app.trustweb.one', 'peer')
    expect(decodeEventLink(plain.slice(plain.indexOf('#'))).showAll).toBeUndefined()
  })
})

describe('editor', () => {
  it('the open-space type needs a start and an end time on one day', () => {
    const f = { ...emptyFields('2026-12-05', 'Mia Probe'), name: 'Day', openSpace: true }
    expect(eventFromFields(s, { ...f, from: '2026-12-05', to: '' }, { id: 'e', now: 1 })).toBe('window')
    expect(eventFromFields(s, { ...f, from: '2026-12-05T10:00', to: '2026-12-06T12:00' }, { id: 'e', now: 1 })).toBe('window')
    expect(eventFromFields(s, { ...f, from: '2026-12-05T12:00', to: '2026-12-05T10:00' }, { id: 'e', now: 1 })).toBe('window')
    const made = eventFromFields(s, { ...f, from: '2026-12-05T10:00', to: '2026-12-05T16:00', showAll: true }, { id: 'e', now: 1 })
    expect(made).toMatchObject({ openSpace: { acts: [] }, showAll: true })
  })
  it('editing an open space keeps its activities; fieldsOf reads the type and flag back', () => {
    const e = ev({ showAll: true })
    proposeActivity(e, { title: 'Talk', slot: '12:00' }, 'Mia', 'a1', 1)
    const f = fieldsOf(s, e)
    expect(f).toMatchObject({ openSpace: true, showAll: true })
    const made = eventFromFields(s, f, { id: 'e1', now: 2, existing: e })
    expect(made.openSpace.acts).toHaveLength(1)
    expect(eventFromFields(s, { ...f, openSpace: false }, { id: 'e1', now: 2, existing: e }).openSpace.acts).toHaveLength(1)
  })
  it('a plain event stays plain', () => {
    const made = eventFromFields(s, { ...emptyFields('2026-12-05', 'Mia Probe'), name: 'Plain' }, { id: 'p', now: 1 })
    expect(made.openSpace).toBeUndefined()
    expect(made.showAll).toBeUndefined()
  })
})

describe('wire and envelope', () => {
  const env = { v: 1, t: 'event', os: { id: 'e1', open: true, acts: [{ id: 'a1', title: 'Talk', slot: '12:00', by: 'Ben', joins: { t1: 7 } }] } }
  it('the os part survives the wire; a bad one is dropped', () => {
    expect(decodeFromQr(encodeForQr(env))).toMatchObject({ t: 'event', os: { id: 'e1', open: true, acts: [{ id: 'a1' }] } })
    const big = { ...env, os: { id: 'e1', acts: new Array(500).fill({ id: 'a', title: 'x'.repeat(100), slot: '12:00', by: 'b', joins: {} }) } }
    expect(decodeFromQr(encodeForQr(big))).toBeNull()
    expect(decodeFromQr(encodeForQr({ v: 1, t: 'event', os: 'x' }))).toBeNull()
    expect(decodeFromQr(encodeForQr({ ...env, link: 'https://x/#ev=1' }))).toBeNull()
  })
  const host = (state, sent = []) => ({
    state: () => state, save: () => undefined, now: () => 1000, link: () => 'https://app.trustweb.one/#ev=x', send: async (p, e) => { sent.push([p.id, e]) },
    pending: () => null, setPending: () => undefined, changed: () => undefined, later: () => undefined,
    recipients: () => [{ id: 'p-ben' }, { id: 'p-cleo' }],
  })
  it('a host message opens the space on a held event; others only add to a held open space', async () => {
    const state = { me: { id: 'me', displayName: 'Mia Probe' }, people: [{ id: 'h', name: 'Hanna Host', peerId: 'p-h' }, { id: 'b', name: 'Ben', peerId: 'p-ben' }], events: [{ id: 'e1', name: 'Open day', from: '2026-12-05T10:00', to: '2026-12-05T16:00', where: '', createdAt: 1, attended: false, hosts: ['Hanna Host'] }] }
    const e = createEventEnvelopes(host(state))
    expect(await e.onEnvelope({ id: 'p-ben' }, env)).toBe('ignored')   // Ben is no host and the event is no open space yet
    expect(state.events[0].openSpace).toBeUndefined()
    expect(await e.onEnvelope({ id: 'p-h' }, env)).toBe('filled')
    expect(state.events[0].openSpace.acts.map((a) => a.id)).toEqual(['a1'])
    expect(await e.onEnvelope({ id: 'p-ben' }, { ...env, os: { id: 'e1', acts: [{ id: 'a2', title: 'More', slot: '13:00', by: 'Ben', joins: {} }] } })).toBe('filled')
    expect(state.events[0].openSpace.acts).toHaveLength(2)
    expect(await e.onEnvelope({ id: 'p-ben' }, { ...env, os: { id: 'zz', acts: [] } })).toBe('ignored')
  })
  it('a change goes on to the other people, not back to the sender, and a repeat goes nowhere', async () => {
    const sent = []
    const state = { me: { id: 'me', displayName: 'Mia Probe' }, people: [], events: [{ id: 'e1', name: 'Open day', from: '2026-12-05T10:00', to: '2026-12-05T16:00', where: '', createdAt: 1, attended: false, openSpace: { acts: [] } }] }
    const e = createEventEnvelopes(host(state, sent))
    await e.onEnvelope({ id: 'p-ben' }, env)
    expect(sent.map(([to]) => to)).toEqual(['p-cleo'])
    expect(sent[0][1]).toMatchObject({ t: 'event', os: { id: 'e1', acts: [{ id: 'a1' }] } })
    await e.onEnvelope({ id: 'p-ben' }, env)
    expect(sent).toHaveLength(1)
  })
  it('pushOpenSpace sends the schedule to every recipient; the host also says it is an open space', async () => {
    const sent = []
    const state = { me: { id: 'me', displayName: 'Mia Probe' }, people: [], events: [{ id: 'e1', name: 'Open day', from: '2026-12-05T10:00', to: '2026-12-05T16:00', where: '', createdAt: 1, attended: true, hosts: ['Mia Probe'], openSpace: { acts: [] } }] }
    await createEventEnvelopes(host(state, sent)).pushOpenSpace(state.events[0])
    expect(sent.map(([to]) => to)).toEqual(['p-ben', 'p-cleo'])
    expect(sent[0][1].os).toMatchObject({ id: 'e1', open: true })
  })
})

describe('MCP', () => {
  function fixture(write = true) {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-os-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me', displayName: 'Mia Probe' }, people: [], sameAs: {}, meetings: [], events: [ev()] }))
    const tools = recordTools({ file, write, now: () => new Date('2026-12-01T10:00:00Z') })
    return { by: Object.fromEntries(tools.map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('open_space_propose and open_space_join are writes, registered in MCP_TOOLS', () => {
    for (const n of ['open_space_propose', 'open_space_join']) {
      expect(MCP_TOOLS.find((t) => t.name === n)).toMatchObject({ write: true })
      expect(Object.keys(fixture(false).by)).not.toContain(n)
      expect(Object.keys(fixture().by)).toContain(n)
    }
  })
  it('propose adds an activity the proposer has joined; join and leave switch my place', () => {
    const f = fixture()
    const r = f.by.open_space_propose.run({ event: 'e1', title: 'Somatics class', slot: '11:00', description: 'Gentle' })
    expect(r).toMatchObject({ title: 'Somatics class', slot: '11:00', joined: 1 })
    expect(f.rec().events[0].openSpace.acts).toHaveLength(1)
    const id = f.rec().events[0].openSpace.acts[0].id
    expect(f.by.open_space_join.run({ event: 'Open day', activity: id, join: false })).toMatchObject({ joined: 0, changed: true })
    expect(f.by.open_space_join.run({ event: 'e1', activity: id })).toMatchObject({ joined: 1, changed: true })
    expect(f.by.open_space_join.run({ event: 'e1', activity: id })).toMatchObject({ changed: false })
    expect(() => f.by.open_space_join.run({ event: 'e1', activity: 'nope' })).toThrow(/no activity/)
    expect(() => f.by.open_space_propose.run({ event: 'e1', title: 'x', slot: '03:00' })).toThrow(/window/)
  })
  it('event_settings_set makes an event an open space and sets the flag', () => {
    const f = fixture()
    f.by.event_settings_set.run({ event: 'e1', showAll: true })
    expect(f.rec().events[0].showAll).toBe(true)
    expect(f.by.event_settings_set.run({ event: 'e1', openSpace: true })).toMatchObject({ openSpace: true, showAll: true })
  })
})
