// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave46 iyg-reviewfix: one describe per finding of the 2026-11-24 review (F1..F10, D1..D3). Fake names only. */
import { rosterNames } from '../../src/event_roster.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { decodeFromQr as parse } from '../../../demo/src/wire.ts'

export const P = (id, name, over = {}) => ({ id, name, ring: 'friend', lines: [], metAt: 0, ...over })
export const ev = (over = {}) => ({ id: 'e1', name: 'IYG', from: '2026-12-01', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], ...over })
export const meta = (m) => ({ 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [], ...m } } } })

/** One device: people with a peerId have a peer that announced the same name. */
export function phone(name, people, events, extData, now = 1000) {
  const state = { v: 1, me: { id: 'm', displayName: name }, peers: people.filter((p) => p.peerId).map((p) => ({ id: p.peerId, displayName: p.name })), people, log: [], events, ...(extData ? { extData } : {}) }
  const sent = []
  const env = createEventEnvelopes({
    state: () => state, save: () => {}, now: () => now, link: () => '', send: async (p, e) => { sent.push([p.id, e]) },
    recipients: (e) => state.people.filter((x) => x.peerId && x.events?.includes(e.id)).map((x) => ({ id: x.peerId })),
    members: (tag) => state.people.filter((x) => x.peerId && String(x.fields?.[tag]) === 'true').map((x) => ({ id: x.peerId })),
    pending: () => null, setPending: () => {}, changed: () => {}, later: () => {}, peers: () => state.peers,
  })
  return { state, sent, env }
}
const rec = (people, extData) => ({ me: { id: 'm', displayName: 'Hanna' }, people, peers: people.filter((p) => p.peerId).map((p) => ({ id: p.peerId, displayName: p.name })), events: [], ...(extData ? { extData } : {}) })

describe('F1 an off guest is never named', () => {
  const guests = () => [P('a', 'Anna', { events: ['e1'], peerId: 'pa' }), P('c', 'Cleo', { events: ['e1'], peerId: 'pc' })]
  it('no stored mode counts as discoverable: only under showAll', () => {
    expect(rosterNames(rec(guests()), ev({ showAll: true })).sort()).toEqual(['Anna', 'Cleo'])
    expect(rosterNames(rec(guests(), meta({ intimate: true })), ev({ communityId: 'iyg' }))).toEqual([])
  })
  it('a joined envelope carries the guest\'s show; the host then never names an off guest', async () => {
    const h = phone('Hanna', guests(), [ev({ showAll: true })])
    expect(await h.env.onEnvelope({ id: 'pc' }, { v: 1, t: 'event', joined: { id: 'e1', show: 'off' } })).toBe('ignored') // already joined (tagged): nothing else changes
    expect(h.state.people[1].eventShow).toEqual({ e1: 'off' })
    await h.env.rosterSync()
    expect(JSON.stringify(h.sent)).not.toContain('Cleo')
    expect(h.sent.map(([p, e]) => [p, e.seen.who])).toEqual([['pc', 'Anna']])
  })
  it('an rsvp carries show too (a host only)', async () => {
    const h = phone('Hanna', guests(), [ev({ showAll: true })])
    await h.env.onEnvelope({ id: 'pc' }, { v: 1, t: 'event', rsvp: { id: 'e1', yes: true, show: 'off' } })
    expect(h.state.people[1].eventShow).toEqual({ e1: 'off' })
    const g = phone('Anna', [P('h', 'Hanna', { peerId: 'ph' })], [ev({ hosts: ['Someone'] })])
    await g.env.onEnvelope({ id: 'ph' }, { v: 1, t: 'event', rsvp: { id: 'e1', yes: true, show: 'off' } })
    expect(g.state.people[0].eventShow).toBeUndefined()
  })
  it('the guest sends joined and rsvp with its own show', async () => {
    const e = ev({ hosts: ['Hanna'], showMe: 'off' })
    const g = phone('Cleo', [P('h', 'Hanna', { peerId: 'ph' })], [e])
    g.env = createEventEnvelopes({ state: () => g.state, save: () => {}, now: () => 1, link: () => '', send: async (p, x) => { g.sent.push([p.id, x]) }, pending: () => null, setPending: () => {}, changed: () => {}, later: () => {}, peers: () => g.state.peers })
    await g.env.joined(e)
    await g.env.rsvp(e)
    expect(g.sent.map(([, x]) => x.joined?.show ?? x.rsvp?.show)).toEqual(['off', 'off'])
  })
  it('wire: show on joined and rsvp is kept when valid, dropped otherwise', () => {
    expect(parse(JSON.stringify({ v: 1, t: 'event', joined: { id: 'e1abcd', show: 'off' } })).joined).toEqual({ id: 'e1abcd', show: 'off' })
    expect(parse(JSON.stringify({ v: 1, t: 'event', joined: { id: 'e1abcd', show: 'x' } })).joined).toEqual({ id: 'e1abcd' })
    expect(parse(JSON.stringify({ v: 1, t: 'event', rsvp: { id: 'e1abcd', yes: true, show: 'discoverable' } })).rsvp).toEqual({ id: 'e1abcd', yes: true, show: 'discoverable' })
    expect(parse(JSON.stringify({ v: 1, t: 'event', rsvp: { id: 'e1abcd', yes: true } })).rsvp).toEqual({ id: 'e1abcd', yes: true })
  })
})

import { addSeenThrough } from '../../src/seen_through.ts'

describe('F2 a tag roster counts only from an organizer or a host of one of the community\'s events', () => {
  const seen = (who = 'Ben') => ({ v: 1, t: 'event', seen: { tag: 'iyg', shown: true, who } })
  it('a plain member holding the tag cannot plant names', async () => {
    const g = phone('Anna', [P('h', 'Mallory', { peerId: 'ph', fields: { iyg: 'true' } })], [])
    expect(await g.env.onEnvelope({ id: 'ph' }, seen())).toBe('ignored')
    expect(g.state.people.map((p) => p.name)).toEqual(['Mallory'])
  })
  it('an organizer of that community on my device is taken', async () => {
    const g = phone('Anna', [P('h', 'Hanna', { peerId: 'ph', fields: { iyg: 'true' } })], [], meta({ organizers: ['h'] }))
    expect(await g.env.onEnvelope({ id: 'ph' }, seen())).toBe('filled')
  })
  it('a host of an event of that community I attend is taken', async () => {
    const g = phone('Anna', [P('h', 'Hanna', { peerId: 'ph' })], [ev({ communityId: 'iyg', hosts: ['Hanna'], attended: true })])
    expect(await g.env.onEnvelope({ id: 'ph' }, seen())).toBe('filled')
    const n = phone('Anna', [P('h', 'Hanna', { peerId: 'ph' })], [ev({ communityId: 'other', hosts: ['Hanna'], attended: true })])
    expect(await n.env.onEnvelope({ id: 'ph' }, seen())).toBe('ignored')
  })
  it('one friend adds at most 200 roster cards; names are cut to 40', () => {
    const s = { people: [P('f', 'Friend')] }
    for (let i = 0; i < 205; i++) addSeenThrough(s, { via: 'f', who: 'Guest ' + i, shown: true, source: 'event', tag: 'iyg', now: 1, id: 'x' + i })
    expect(s.people.filter((p) => p.via === 'f')).toHaveLength(200)
    const t = { people: [P('f', 'Friend')] }
    addSeenThrough(t, { via: 'f', who: 'y'.repeat(60), shown: true, source: 'event', tag: 'iyg', now: 1, id: 'z' })
    expect(t.people[1].name).toHaveLength(40)
  })
})

import { applyIncoming, createResourceSync, payloadOf } from '../../src/resource_sync.ts'
import { hideReceived, partitionScope } from '../../src/resource_scope.ts'
import { filterResources, listResources } from '../../src/resource_views.ts'
import { allTools } from '../../../mcp/src/tools.ts'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const NOW = Date.parse('2026-11-24T10:00:00Z')
const rp = (id, name, extra = {}) => ({ id, name, ring: 'friend', peerId: `peer-${id}`, lines: [], fields: { iyg: 'true' }, ...extra })
const rres = (over = {}) => ({ id: 'r1', text: 'Sled guide', communityId: 'iyg', eventIds: ['e1'], updatedAt: NOW, by: 'Hanna', ...over })
const rrec = (over = {}) => ({
  me: { displayName: 'Gus' },
  people: [rp('ph', 'Hanna'), rp('pa', 'Anna'), rp('pb', 'Ben')],
  events: [{ id: 'e1', name: 'Winter', communityId: 'iyg', attended: true, hosts: ['Hanna'], createdAt: 1 }, { id: 'e2', name: 'Summer', communityId: 'iyg', attended: true, hosts: ['Anna'], createdAt: 1 }],
  inventory: [], ...over,
})
const anyTag = () => true
function rworld(over = {}, clock = { t: NOW }) {
  const s = rrec(over)
  const sent = []
  const peers = s.people.map((p) => ({ id: p.peerId }))
  const sync = createResourceSync({ state: () => s, save: () => {}, now: () => clock.t, peers: () => peers, send: async (p, e) => { sent.push([p.id, e]) }, holdsCommunity: anyTag, changed: () => {} })
  return { s, sent, sync, clock }
}

describe('F3 a res stays inside its own scope', () => {
  const hanna = rp('ph', 'Hanna')
  it('an event of another community cannot be claimed into this one', () => {
    const s = rrec({ events: [{ id: 'e1', name: 'Other', communityId: 'zzz', attended: true, hosts: ['Hanna'], createdAt: 1 }] })
    expect(applyIncoming(s, hanna, rres(), NOW, anyTag)).toBe('ignored')
    expect(s.inventory).toEqual([])
  })
  it('a sender who is not in the community must attend or host every listed event I know', () => {
    const s = rrec()
    const plain = rp('px', 'Xena', { fields: {}, events: ['e1'] })
    expect(applyIncoming(s, plain, rres({ eventIds: ['e1', 'e2'] }), NOW, anyTag)).toBe('ignored')
    expect(applyIncoming(s, plain, rres({ eventIds: ['e1'] }), NOW, anyTag)).toBe('new')
  })
  it('a community holder is taken for its events', () => {
    expect(applyIncoming(rrec(), rp('pm', 'Mia'), rres({ eventIds: ['e1', 'e2'] }), NOW, anyTag)).toBe('new')
  })
  it('a host forwards only into the scopes the sender belongs to', async () => {
    const people = [rp('px', 'Xena', { fields: {}, events: ['e1'] }), rp('pc', 'Cleo'), rp('pe', 'Eve', { fields: {}, events: ['e1'] })]
    const w = rworld({ me: { displayName: 'Hanna' }, people, events: [{ id: 'e1', name: 'Winter', communityId: 'iyg', attended: true, hosts: ['Hanna'], createdAt: 1 }] })
    expect(await w.sync.onEnvelope({ id: 'peer-px' }, rres())).toBe(true)
    expect(w.sent.map(([p]) => p)).toEqual(['peer-pe'])
  })
})

describe('F4 caps, forward rate limit, Hide', () => {
  const sender = (n) => rp('p' + n, 'S' + n)
  it('at most 100 new items per sender and 300 per community', () => {
    const s = rrec({ people: Array.from({ length: 5 }, (_, k) => sender(k)) })
    for (let i = 0; i < 120; i++) applyIncoming(s, s.people[0], rres({ id: 'a' + i, text: 'A' + i }), NOW, anyTag)
    expect(s.inventory).toHaveLength(100)
    expect(applyIncoming(s, s.people[0], rres({ id: 'a0', text: 'edited', updatedAt: NOW + 5 }), NOW, anyTag)).toBe('updated')
    for (let k = 1; k < 5; k++) for (let i = 0; i < 100; i++) applyIncoming(s, s.people[k], rres({ id: `b${k}-${i}`, text: 'B' }), NOW, anyTag)
    expect(s.inventory).toHaveLength(300)
  })
  it('a host forwards at most 20 items per sender per 10 minutes', async () => {
    const w = rworld({ me: { displayName: 'Hanna' }, events: [{ id: 'e1', name: 'Winter', communityId: 'iyg', attended: true, hosts: ['Hanna'], createdAt: 1 }], people: [rp('ps', 'Sender'), rp('pa', 'Anna')] })
    for (let i = 0; i < 25; i++) await w.sync.onEnvelope({ id: 'peer-ps' }, rres({ id: 'r' + i, by: 'Sender' }))
    expect(w.s.inventory).toHaveLength(25)
    expect(w.sent.filter(([p]) => p === 'peer-pa')).toHaveLength(20)
    w.clock.t += 11 * 60_000
    await w.sync.onEnvelope({ id: 'peer-ps' }, rres({ id: 'late', by: 'Sender' }))
    expect(w.sent.filter(([p]) => p === 'peer-pa')).toHaveLength(21)
  })
  const held = (over = {}) => ({ id: 'r1', text: 'T', audience: 'me', included: true, createdAt: 1, sharedBy: 'Hanna', sharedFrom: 'ph', communityId: 'iyg', eventId: 'e1', eventIds: ['e1'], ...over })
  it('Hide: local flag, gone from the views, stays hidden on a later update, never deleted; own items refused', () => {
    const items = [held(), { ...held({ id: 'mine' }), sharedBy: undefined }]
    expect(hideReceived(items, 'r1')).toBe(true)
    expect(hideReceived(items, 'mine')).toBe(false)
    expect(items[0].hidden).toBe(true)
    expect(partitionScope(items, { kind: 'community', id: 'iyg', label: 'x' }).fresh).toEqual([])
    expect(filterResources(items, {}).map((i) => i.id)).toEqual(['mine'])
    const s = rrec({ inventory: items })
    expect(applyIncoming(s, rp('ph', 'Hanna'), rres({ text: 'Newer', updatedAt: NOW + 9 }), NOW, anyTag)).toBe('updated')
    expect(s.inventory[0]).toMatchObject({ text: 'Newer', hidden: true })
    expect(s.inventory).toHaveLength(2)
  })
  it('MCP resource_hide hides a received resource', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-w46-rf-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], inventory: [held()], events: [] }))
    writeFileSync(path.join(dir, 'colourtags.json'), '[]')
    const by = Object.fromEntries(allTools({ file, write: true, now: () => new Date(NOW) }).map((t) => [t.name, t]))
    by.resource_hide.run({ id: 'r1' })
    expect(JSON.parse(readFileSync(file, 'utf8')).inventory[0].hidden).toBe(true)
    expect(() => by.resource_hide.run({ id: 'nope' })).toThrow()
  })
})

describe('F5 a retraction carries no content', () => {
  const full = { id: 'r1', text: 'Secret title', communityId: 'iyg', eventIds: ['e1'], updatedAt: NOW, by: 'Hanna', link: 'https://x.org', blocks: [{ id: 'b', text: 'private', children: [] }], retracted: true }
  it('wire: a retraction is {id, retracted, updatedAt, communityId} only', () => {
    const got = parse(JSON.stringify({ v: 1, t: 'event', res: full }))
    expect(got.res).toEqual({ id: 'r1', retracted: true, updatedAt: NOW, communityId: 'iyg' })
    expect(parse(JSON.stringify({ v: 1, t: 'event', res: { id: 'r1', retracted: true, updatedAt: NOW } }))).toBeNull()
  })
  it('the sender strips a retraction before it leaves the device', async () => {
    const w = rworld({ me: { displayName: 'Hanna' }, inventory: [{ id: 'r1', text: 'Secret title', audience: 'me', included: true, createdAt: NOW, synced: true, communityId: 'iyg', eventId: 'e1', eventIds: ['e1'], link: 'https://x.org' }] })
    await w.sync.sweep()
    w.clock.t += 10
    w.s.inventory[0].included = false
    w.sent.length = 0
    await w.sync.sweep()
    expect(w.sent.length).toBeGreaterThan(0)
    for (const [, e] of w.sent) expect(Object.keys(e.res).sort()).toEqual(['communityId', 'id', 'retracted', 'updatedAt'])
    expect(JSON.stringify(w.sent)).not.toContain('Secret')
  })
  it('a retraction for an item I do not hold is ignored; for one I hold it hides it', () => {
    const s = rrec()
    const r = { id: 'r1', retracted: true, updatedAt: NOW + 5, communityId: 'iyg' }
    expect(applyIncoming(s, rp('ph', 'Hanna'), r, NOW, anyTag)).toBe('ignored')
    expect(s.inventory).toEqual([])
    applyIncoming(s, rp('ph', 'Hanna'), rres(), NOW, anyTag)
    expect(applyIncoming(s, rp('ph', 'Hanna'), r, NOW, anyTag)).toBe('updated')
    expect(s.inventory[0]).toMatchObject({ included: false, retractedAt: NOW + 5 })
  })
  it('a received retracted item is hidden in the Resources list and the MCP list', () => {
    const items = [{ id: 'r1', text: 'T', audience: 'me', included: false, createdAt: 1, sharedBy: 'Hanna', communityId: 'iyg', retractedAt: 5 }, { id: 'r2', text: 'U', audience: 'me', included: true, createdAt: 1, sharedBy: 'Hanna', communityId: 'iyg' }]
    expect(filterResources(items, {}).map((i) => i.id)).toEqual(['r2'])
    expect(listResources(items, [], {}).items.map((i) => i.id)).toEqual(['r2'])
  })
})

import { retractSynced, sharedWithLine } from '../../src/resource_scope.ts'

describe('F6 a synced item shows its scope, not audience controls', () => {
  it('one line names the community and its events', () => {
    const item = { communityId: 'iyg', eventIds: ['e1', 'e2'] }
    const line = sharedWithLine(item, (t) => 'IYG ' + t, (id) => ({ e1: 'Winter', e2: 'Summer' })[id], (c, e) => `Shared with ${c}${e ? ` and ${e}` : ''}`)
    expect(line).toBe('Shared with IYG iyg and Winter, Summer')
    expect(sharedWithLine({ communityId: 'iyg' }, (t) => t, () => '', (c, e) => `${c}|${e}`)).toBe('iyg|')
  })
  it('Remove retracts my own synced item only', () => {
    const items = [{ id: 'a', text: 'T', included: true, synced: true }, { id: 'b', text: 'T', included: true }, { id: 'c', text: 'T', included: true, synced: true, sharedBy: 'X' }]
    expect(retractSynced(items, 'a')).toBe(true)
    expect(items[0].included).toBe(false)
    expect(retractSynced(items, 'b')).toBe(false)
    expect(retractSynced(items, 'c')).toBe(false)
    expect(items[1].included).toBe(true)
  })
  it('MCP resource_retract does the same', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-w46-rf6-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], inventory: [{ id: 'a', text: 'T', audience: 'me', included: true, createdAt: 1, synced: true }], events: [] }))
    writeFileSync(path.join(dir, 'colourtags.json'), '[]')
    const by = Object.fromEntries(allTools({ file, write: true, now: () => new Date(NOW) }).map((t) => [t.name, t]))
    by.resource_retract.run({ id: 'a' })
    expect(JSON.parse(readFileSync(file, 'utf8')).inventory[0].included).toBe(false)
    expect(() => by.resource_retract.run({ id: 'zz' })).toThrow()
  })
})

import { relayText } from '../../src/support_relay.ts'
import { noteOf, parseSupportText } from '../../src/support_ask.ts'

describe('F7 an old app shows who asked', () => {
  const APP = 'https://app.example.test/'
  const ask = { id: 'ask1', chips: ['listen'], note: 'hello', until: NOW + 1e6, scope: { event: 'ev1', name: 'Winter' } }
  it('the relayed note starts with "<Asker>: " so an app that ignores scope still names the asker', () => {
    const back = parseSupportText(APP, relayText(APP, ask, 'Anna'))
    expect(back.note).toBe('Anna: hello')
    expect(back.scope).toMatchObject({ relayed: true, from: 'Anna' })
  })
  it('a new client strips the prefix once, only when scope.from says so', () => {
    const back = parseSupportText(APP, relayText(APP, ask, 'Anna'))
    expect(noteOf(back)).toBe('hello')
    expect(noteOf({ note: 'Anna: hello' })).toBe('Anna: hello')
    expect(noteOf({ note: 'Anna: Anna: hi', scope: { relayed: true, from: 'Anna' } })).toBe('Anna: hi')
    expect(noteOf({ note: 'plain', scope: { relayed: true, from: 'Anna' } })).toBe('plain')
  })
  it('the note stays within the ask limit', () => {
    const back = parseSupportText(APP, relayText(APP, { ...ask, note: 'n'.repeat(200) }, 'A'.repeat(40)))
    expect(back.note.length).toBeLessThanOrEqual(200)
  })
})

import { dropSeenThrough } from '../../src/seen_through.ts'

describe('F8 a name told is taken back', () => {
  const host = (extra = {}) => phone('Hanna', [P('a', 'Anna', { events: ['e1'], peerId: 'pa' }), P('b', 'Ben', { events: ['e1'], peerId: 'pb' }), P('c', 'Cleo', { events: ['e1'], peerId: 'pc' })], [ev({ showAll: true, ...extra })])
  const goneTo = (h, id) => h.sent.filter(([p, e]) => p === id && e.seen.gone).map(([, e]) => e.seen.who).sort()
  it('a guest who turns off is taken back from everyone who heard the name, and from the list sent', async () => {
    const h = host()
    await h.env.rosterSync()
    h.sent.length = 0
    h.state.people[2].eventShow = { e1: 'off' }
    await h.env.rosterSync()
    expect(goneTo(h, 'pa')).toEqual(['Cleo'])
    expect(goneTo(h, 'pb')).toEqual(['Cleo'])
    expect(goneTo(h, 'pc')).toEqual([])
    expect(h.sent.find(([, e]) => e.seen.gone)[1].seen).toEqual({ id: 'e1', shown: true, who: 'Cleo', gone: true })
    expect(h.state.rosterSent.e1.pa).not.toContain('Cleo')
    h.sent.length = 0
    await h.env.rosterSync()
    expect(h.sent).toEqual([])
  })
  it('leaving (untagged) and a rename: gone(old) then seen(new)', async () => {
    const h = host()
    await h.env.rosterSync()
    h.sent.length = 0
    h.state.people[1].name = 'Benny'
    h.state.peers[1].displayName = 'Benny'
    h.state.people[2].events = []
    await h.env.rosterSync()
    const toA = h.sent.filter(([p]) => p === 'pa').map(([, e]) => `${e.seen.gone ? 'gone' : 'seen'}:${e.seen.who}`)
    expect(toA).toEqual(expect.arrayContaining(['gone:Ben', 'gone:Cleo', 'seen:Benny']))
    expect(toA.indexOf('gone:Ben')).toBeLessThan(toA.indexOf('seen:Benny'))
  })
  it('showAll switched off takes every name back', async () => {
    const h = host()
    await h.env.rosterSync()
    h.sent.length = 0
    delete h.state.events[0].showAll
    await h.env.rosterSync()
    expect(goneTo(h, 'pa')).toEqual(['Ben', 'Cleo'])
  })
  it('a community roster is taken back the same way', async () => {
    const h = phone('Hanna', [P('a', 'Anna', { peerId: 'pa', fields: { iyg: 'true' } }), P('b', 'Ben', { peerId: 'pb', fields: { iyg: 'true' } })], [], meta({ intimate: true, organizers: ['me'] }))
    await h.env.rosterSync()
    h.sent.length = 0
    h.state.people[1].fields = {}
    await h.env.rosterSync()
    expect(h.sent.map(([p, e]) => [p, e.seen])).toEqual([['pa', { tag: 'iyg', shown: true, who: 'Ben', gone: true }]])
  })
  it('wire: gone needs a name and a yes; otherwise ignored', () => {
    expect(parse(JSON.stringify({ v: 1, t: 'event', seen: { id: 'e1abcd', shown: true, who: 'Ben', gone: true } })).seen).toEqual({ id: 'e1abcd', shown: true, who: 'Ben', gone: true })
    expect(parse(JSON.stringify({ v: 1, t: 'event', seen: { tag: 'iyg', shown: true, who: 'Ben', gone: true } })).seen).toEqual({ tag: 'iyg', shown: true, who: 'Ben', gone: true })
    expect(parse(JSON.stringify({ v: 1, t: 'event', seen: { id: 'e1abcd', shown: true, gone: true } }))).toBeNull()
  })
  const seenOn = (ev1 = 'e1') => ({ people: [P('f', 'Friend'), P('x', 'Ben', { via: 'f', anonymous: undefined, seen: { source: 'event', at: 1, event: ev1 } })] })
  it('dropSeenThrough: a card only that event vouched for goes (soft), one with notes or another source stays', () => {
    const s = seenOn()
    expect(dropSeenThrough(s, { via: 'f', who: 'ben', event: 'e1', now: 5 })).toBe(true)
    expect(s.people[1].deleted_at).toBeDefined()
    const n = seenOn(); n.people[1].lines = [{ id: 'l', text: 'note' }]
    expect(dropSeenThrough(n, { via: 'f', who: 'Ben', event: 'e1', now: 5 })).toBe(true)
    expect(n.people[1].deleted_at).toBeUndefined()
    expect(n.people[1].seen.event).toBeUndefined()
    const t = seenOn(); t.people[1].seen.tag = 'iyg'
    dropSeenThrough(t, { via: 'f', who: 'Ben', event: 'e1', now: 5 })
    expect(t.people[1]).toMatchObject({ seen: { tag: 'iyg' } })
    expect(t.people[1].deleted_at).toBeUndefined()
    const o = seenOn()
    expect(dropSeenThrough(o, { via: 'other', who: 'Ben', event: 'e1', now: 5 })).toBe(false)
    expect(dropSeenThrough(o, { via: 'f', who: 'Ben', event: 'e2', now: 5 })).toBe(false)
  })
  it('the guest device applies it only from the same friend who is host / organizer', async () => {
    const g = phone('Anna', [P('h', 'Hanna', { peerId: 'ph' }), P('z', 'Zoe', { peerId: 'pz' })], [ev({ hosts: ['Hanna'], attended: true })])
    await g.env.onEnvelope({ id: 'ph' }, { v: 1, t: 'event', seen: { id: 'e1', shown: true, who: 'Ben' } })
    expect(g.state.people.find((p) => p.name === 'Ben')).toMatchObject({ via: 'h' })
    expect(await g.env.onEnvelope({ id: 'pz' }, { v: 1, t: 'event', seen: { id: 'e1', shown: true, who: 'Ben', gone: true } })).toBe('ignored')
    expect(g.state.people.find((p) => p.name === 'Ben').deleted_at).toBeUndefined()
    expect(await g.env.onEnvelope({ id: 'ph' }, { v: 1, t: 'event', seen: { id: 'e1', shown: true, who: 'Ben', gone: true } })).toBe('filled')
    expect(g.state.people.find((p) => p.name === 'Ben').deleted_at).toBeDefined()
  })
})

import { relayHostPeople } from '../../src/support_relay.ts'

describe('F9 an ask reaches only hosts who can relay that scope', () => {
  const people = [P('h', 'Hanna', { peerId: 'ph' }), P('o', 'Olga', { peerId: 'po' }), P('g', 'Gus', { peerId: 'pg' }), P('d', 'Dan')]
  const evs = [ev({ id: 'e1', communityId: 'iyg', hosts: ['Hanna'], attended: true })]
  const s = (extData) => ({ people, events: evs, ...(extData ? { extData } : {}) })
  it('event scope: the event\'s named hosts', () => {
    expect(relayHostPeople(s(), { event: 'e1' }).map((p) => p.name)).toEqual(['Hanna'])
  })
  it('community scope: only its organizers on my device, not every event host', () => {
    expect(relayHostPeople(s(), { tag: 'iyg' })).toEqual([])
    expect(relayHostPeople(s(meta({ organizers: ['o'] })), { tag: 'iyg' }).map((p) => p.name)).toEqual(['Olga'])
  })
  it('no scope or an unknown event: nobody', () => {
    expect(relayHostPeople(s(), {})).toEqual([])
    expect(relayHostPeople(s(), { event: 'zz' })).toEqual([])
  })
})

import { rosterWork } from '../../src/event_roster.ts'

describe('F10 the roster does no work on a save that changed nothing', () => {
  const big = () => {
    const people = Array.from({ length: 683 }, (_, i) => P('p' + i, 'Person ' + i, { events: ['e' + (i % 20)], peerId: i < 40 ? 'q' + i : undefined }))
    return phone('Hanna', people, Array.from({ length: 20 }, (_, k) => ev({ id: 'e' + k, showAll: true })))
  }
  it('second call: no roster computed (counter), a changed input recomputes', async () => {
    const h = big()
    rosterWork.names = 0
    await h.env.rosterSync()
    expect(rosterWork.names).toBe(20)
    const sentAfterFirst = h.sent.length
    rosterWork.names = 0
    await h.env.rosterSync()
    expect(rosterWork.names).toBe(0)
    expect(h.sent.length).toBe(sentAfterFirst)
    h.state.people[100].eventShow = { e0: 'off' }
    await h.env.rosterSync()
    expect(rosterWork.names).toBe(20)
  })
  it('a new connection, a rename and a showAll switch each count as a change', async () => {
    const h = big()
    await h.env.rosterSync()
    for (const change of [() => { h.state.people[100].peerId = 'qnew'; h.state.peers.push({ id: 'qnew', displayName: 'Person 100' }) }, () => { h.state.people[5].name = 'Renamed' }, () => { delete h.state.events[3].showAll }]) {
      rosterWork.names = 0
      change()
      await h.env.rosterSync()
      expect(rosterWork.names).toBeGreaterThan(0)
    }
  })
})

import { supportTextFor } from '../../src/support_relay.ts'

describe('D3 the scope name goes only to people inside the scope', () => {
  const APP = 'https://app.example.test/'
  const a = (scope) => ({ id: 'ask1', chips: ['listen'], note: 'hi', until: NOW + 1e6, scope })
  const s = { people: [P('in', 'Ina', { events: ['e1'] }), P('out', 'Otto'), P('mem', 'Mia', { fields: { iyg: 'true' } })], events: [ev({ id: 'e1', hosts: ['Hanna'] })] }
  it('an event ask: attendees get the name, others get the ids only', () => {
    const scope = { event: 'e1', name: 'Secret retreat' }
    expect(supportTextFor(APP, s, a(scope), s.people[0])).toContain('Secret%20retreat')
    const other = supportTextFor(APP, s, a(scope), s.people[1])
    expect(decodeURIComponent(other)).not.toContain('Secret retreat')
    expect(decodeURIComponent(other)).toContain('"event":"e1"')
  })
  it('a community ask: members get the name, others do not', () => {
    const scope = { tag: 'iyg', name: 'Inner circle' }
    expect(decodeURIComponent(supportTextFor(APP, s, a(scope), s.people[2]))).toContain('Inner circle')
    expect(decodeURIComponent(supportTextFor(APP, s, a(scope), s.people[1]))).not.toContain('Inner circle')
  })
  it('no scope: unchanged', () => {
    expect(supportTextFor(APP, s, a(undefined), s.people[1])).not.toContain('scope')
  })
})

import { ownName } from '../../src/own_name.ts'

describe('D1 + D2 rosters name only connected people, by the name they announced', () => {
  const peers = [{ id: 'pa', displayName: 'Anna Real' }, { id: 'pn', displayName: 'Someone' }]
  const people = [P('a', 'Mom', { events: ['e1'], peerId: 'pa' }), P('t', 'Tagged Only', { events: ['e1'] }), P('n', 'Nameless', { events: ['e1'], peerId: 'pn' }), P('x', 'Ghost', { events: ['e1'], peerId: 'gone' })]
  it('ownName: the announced name, never the label; "" for none, the nameless peer or no peer', () => {
    const s = { peers }
    expect(ownName(s, people[0])).toBe('Anna Real')
    expect(ownName(s, people[1])).toBe('')
    expect(ownName(s, people[2])).toBe('')
    expect(ownName(s, people[3])).toBe('')
    expect(ownName({}, people[0])).toBe('')
  })
  it('D1 + D2: the event roster lists Anna Real only: no tagged contact, no label, no nameless peer', () => {
    expect(rosterNames({ me: { displayName: 'Hanna' }, people, peers, events: [] }, ev({ showAll: true }))).toEqual(['Anna Real'])
  })
  it('a roster sent to a peer carries the announced name; the label never leaves', async () => {
    const h = phone('Hanna', [P('a', 'Mom', { events: ['e1'], peerId: 'pa' }), P('b', 'Dad', { events: ['e1'], peerId: 'pb' })], [ev({ showAll: true })])
    h.state.peers = [{ id: 'pa', displayName: 'Anna Real' }, { id: 'pb', displayName: 'Ben Real' }]
    await h.env.rosterSync()
    expect(h.sent.map(([p, e]) => [p, e.seen.who]).sort()).toEqual([['pa', 'Ben Real'], ['pb', 'Anna Real']])
    expect(JSON.stringify(h.sent)).not.toMatch(/Mom|Dad/)
  })
  it('D2 resources: a forwarded author is the name they announced, not my label', async () => {
    const w = rworld({ me: { displayName: 'Hanna' }, events: [{ id: 'e1', name: 'Winter', communityId: 'iyg', attended: true, hosts: ['Hanna'], createdAt: 1 }], people: [rp('ps', 'Annie-label'), rp('pa', 'Ben')] })
    w.s.peers = [{ id: 'peer-ps', displayName: 'Anna Real' }, { id: 'peer-pa', displayName: 'Ben Real' }]
    await w.sync.onEnvelope({ id: 'peer-ps' }, rres({ by: 'Anna Real' }))
    expect(w.s.inventory[0].sharedBy).toBe('Anna Real')
    expect(w.sent.map(([p, e]) => [p, e.res.by])).toEqual([['peer-pa', 'Anna Real']])
  })
})
