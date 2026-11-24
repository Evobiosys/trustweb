// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave46 iyg-assemble: gaps G1 (edit a synced resource), G2 (retract across sessions), G4 (via people in asks / no duplicates), G5 (event already happened). Fake names only. */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { allTools } from '../../../mcp/src/tools.ts'
import { editSynced } from '../../src/resource_scope.ts'
import { createResourceSync, recipientsOf } from '../../src/resource_sync.ts'
import { addSeenThrough } from '../../src/seen_through.ts'
import { communityHostPeople, relayPeers } from '../../src/support_relay.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { buildViaMembers } from '../../src/ext/community-mighty/community_model.ts'

const NOW = Date.parse('2026-11-24T10:00:00Z')
const person = (id, name, extra = {}) => ({ id, name, ring: 'friend', peerId: `peer-${id}`, lines: [], fields: { iyg: 'true' }, ...extra })
const mine = (over = {}) => ({ id: 'r1', text: 'Sled', audience: 'me', included: true, createdAt: NOW, synced: true, communityId: 'iyg', eventId: 'e1', eventIds: ['e1'], tagAudience: ['iyg'], ...over })
const base = (over = {}) => ({
  me: { displayName: 'Hanna' },
  people: [person('pa', 'Anna'), person('pb', 'Ben')],
  events: [{ id: 'e1', name: 'Winter OG', communityId: 'iyg', attended: true, hosts: ['Hanna'], createdAt: 1 }],
  inventory: [], ...over,
})
function session(s, sent, clock) {
  const peers = ['pa', 'pb', 'pn'].map((id) => ({ id: `peer-${id}` }))
  return createResourceSync({ state: () => s, save: () => {}, now: () => clock.t, peers: () => peers, send: async (p, e) => { sent.push([p.id, e]) }, holdsCommunity: (t) => t === 'iyg', changed: () => {} })
}

describe('G1 editSynced', () => {
  it('changes title and link of my own synced item', () => {
    const s = base({ inventory: [mine()] })
    expect(editSynced(s.inventory, 'r1', '  Sled guide ', 'https://example.test/sled')).toBe(true)
    expect(s.inventory[0]).toMatchObject({ text: 'Sled guide', link: 'https://example.test/sled' })
    expect(editSynced(s.inventory, 'r1', 'Sled guide', '')).toBe(true)
    expect(s.inventory[0].link).toBeUndefined()
  })
  it('refuses a received item, an empty title, an http link, an unknown id', () => {
    const s = base({ inventory: [mine(), mine({ id: 'r2', sharedBy: 'Zed', synced: undefined })] })
    expect(editSynced(s.inventory, 'r2', 'Mine now', '')).toBe(false)
    expect(editSynced(s.inventory, 'r1', '   ', '')).toBe(false)
    expect(editSynced(s.inventory, 'r1', 'Sled', 'http://example.test')).toBe(false)
    expect(editSynced(s.inventory, 'r1', 'Sled', 'javascript:alert(1)')).toBe(false)
    expect(editSynced(s.inventory, 'nope', 'x', '')).toBe(false)
    expect(s.inventory[0]).toMatchObject({ text: 'Sled' })
  })
  it('the next sweep bumps updatedAt and sends the new title and link', async () => {
    const s = base({ inventory: [mine()] })
    const sent = []
    const clock = { t: NOW }
    const sync = session(s, sent, clock)
    await sync.sweep()
    clock.t += 5000
    editSynced(s.inventory, 'r1', 'Sled guide', 'https://example.test/sled')
    expect(await sync.sweep()).toBe(2)
    expect(s.inventory[0].updatedAt).toBe(NOW + 5000)
    expect(sent.at(-1)[1].res).toMatchObject({ text: 'Sled guide', link: 'https://example.test/sled', updatedAt: NOW + 5000 })
  })
})

describe('G2 retract across sessions', () => {
  it('removed in a later session (state reloaded from JSON): everyone still gets the retraction', async () => {
    const clock = { t: NOW }
    const s1 = base({ inventory: [mine()] })
    await session(s1, [], clock).sweep()
    const s2 = JSON.parse(JSON.stringify(s1)) // app closed and reopened
    s2.inventory.length = 0
    const sent = []
    clock.t += 1000
    expect(await session(s2, sent, clock).sweep()).toBe(2)
    expect(sent.map((x) => x[0]).sort()).toEqual(['peer-pa', 'peer-pb'])
    expect(sent[0][1].res).toMatchObject({ id: 'r1', retracted: true })
  })
  it('a peer who was offline gets the retraction when it connects later, in a third session', async () => {
    const clock = { t: NOW }
    const s1 = base({ inventory: [mine()], people: [person('pa', 'Anna'), person('pn', 'Newo')] })
    await session(s1, [], clock).sweep()
    const s2 = JSON.parse(JSON.stringify(s1))
    s2.inventory.length = 0
    clock.t += 1000
    await session(s2, [], clock).sweep()
    const s3 = JSON.parse(JSON.stringify(s2))
    const sent = []
    clock.t += 120_000
    expect(await session(s3, sent, clock).catchUp({ id: 'peer-pn' })).toBe(1)
    expect(sent[0][1].res).toMatchObject({ id: 'r1', retracted: true })
  })
  it('an item restored from the trash after its retraction is sent again', async () => {
    const clock = { t: NOW }
    const s = base({ inventory: [mine()] })
    const sent = []
    const sync = session(s, sent, clock)
    await sync.sweep()
    const item = s.inventory.pop()
    clock.t += 1000
    await sync.sweep()
    s.inventory.push(item)
    clock.t += 1000
    expect(await sync.sweep()).toBe(2)
    expect(sent.at(-1)[1].res.retracted).toBeUndefined()
    expect(await sync.sweep()).toBe(0)
  })
  it('the tombstone stays out of the lists and is never sent to outsiders', async () => {
    const clock = { t: NOW }
    const s1 = base({ inventory: [mine()], people: [person('pa', 'Anna'), person('pz', 'Zed', { fields: {} })] })
    await session(s1, [], clock).sweep()
    s1.inventory.length = 0
    const sent = []
    await session(JSON.parse(JSON.stringify(s1)), sent, clock).sweep()
    expect(sent.map((x) => x[0])).toEqual(['peer-pa'])
  })
})

describe('G4 via people next to asks and resources', () => {
  const viaAnna = { id: 'v1', name: 'Vera', ring: 'none', lines: [], via: 'pa', seen: { source: 'event', at: 1, event: 'e1' }, fields: { iyg: 'true' }, events: ['e1'] }
  it('a via person is no resource recipient, no ask relay target', () => {
    const s = base({ people: [person('pa', 'Anna'), viaAnna] })
    expect(recipientsOf(s, { communityId: 'iyg', eventIds: ['e1'] }).map((p) => p.id)).toEqual(['pa'])
    const rs = { me: { id: 'me', displayName: 'Hanna' }, people: [person('pa', 'Anna', { events: ['e1'] }), person('pb', 'Ben', { events: ['e1'] }), viaAnna], peers: [{ id: 'peer-pa' }, { id: 'peer-pb' }], events: s.events, supportIn: [] }
    expect(relayPeers(rs, { id: 'k1', scope: { event: 'e1', name: 'Winter OG' } }, 'peer-pa').map((p) => p.id)).toEqual(['peer-pb'])
  })
  it('a resource whose author is only a via person creates no person', () => {
    const s = base({ people: [person('pa', 'Anna'), viaAnna] })
    expect(s.people).toHaveLength(2)
  })
  it('a name told by a second friend is the same via person, not a duplicate', () => {
    const people = [person('pa', 'Anna'), person('pb', 'Ben'), viaAnna]
    const again = addSeenThrough({ people }, { via: 'pb', who: 'vera', shown: true, source: 'event', event: 'e1', now: 5, id: 'new1' })
    expect(again).toBe('v1')
    expect(people.filter((p) => p.name.toLowerCase() === 'vera')).toHaveLength(1)
  })
  it('a told name that is already a direct person adds nobody; Members lists it once', () => {
    const people = [person('pa', 'Anna'), person('pb', 'Ben')]
    expect(addSeenThrough({ people }, { via: 'pa', who: 'Ben', shown: true, source: 'event', tag: 'iyg', now: 5, id: 'x' })).toBe('pb')
    expect(people).toHaveLength(2)
    expect(buildViaMembers([...people, { ...viaAnna, name: 'Ben', seen: { source: 'event', at: 1, tag: 'iyg' } }], 'iyg').map((m) => m.name)).toEqual([])
  })
})

describe('G5 event already happened', () => {
  const P = (id, name, over = {}) => ({ id, name, ring: 'friend', lines: [], metAt: 0, ...over })
  function phone(name, people, events, extData) {
    const state = { v: 1, me: { id: 'm', displayName: name }, peers: people.filter((p) => p.peerId).map((p) => ({ id: p.peerId, displayName: p.name })), people, log: [], events, ...(extData ? { extData } : {}) }
    const sent = []
    const env = createEventEnvelopes({
      state: () => state, save: () => {}, now: () => NOW, link: () => '', send: async (p, e) => { sent.push([p.id, e]) },
      recipients: (e) => state.people.filter((x) => x.peerId && x.events?.includes(e.id)).map((x) => ({ id: x.peerId })),
      members: (tag) => state.people.filter((x) => x.peerId && String(x.fields?.[tag]) === 'true').map((x) => ({ id: x.peerId })),
      pending: () => null, setPending: () => {}, changed: () => {}, later: () => {}, peers: () => [],
    })
    return { state, sent, env }
  }
  const past = { id: 'e1', name: 'Winter IYG 2025', from: '2025-12-30', to: '2026-01-02', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], showAll: true }
  it('a past event with attendees tagged before this build: the host names them to each connected one', async () => {
    const h = phone('Hanna', [P('a', 'Anna', { events: ['e1'], peerId: 'pa' }), P('b', 'Ben', { events: ['e1'], peerId: 'pb' })], [past])
    await h.env.rosterSync()
    expect(h.sent.map(([p, e]) => [p, e.seen.who]).sort()).toEqual([['pa', 'Ben'], ['pb', 'Anna']])
  })
  it('an existing community: members who already hold the tag get the roster', async () => {
    const h = phone('Hanna', [P('a', 'Anna', { peerId: 'pa', fields: { iyg: 'true' } }), P('b', 'Ben', { peerId: 'pb', fields: { iyg: 'true' } })], [], { 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['me'], intimate: true } } } })
    await h.env.rosterSync()
    expect(h.sent.map(([p, e]) => [p, e.seen.who]).sort()).toEqual([['pa', 'Ben'], ['pb', 'Anna']])
  })
  it('a guest who holds the event (joined by QR or link) takes the roster; one only tagged by the host (never held it) ignores it', async () => {
    const holder = phone('Anna', [P('h', 'Hanna', { peerId: 'ph' })], [{ ...past, hosts: ['Hanna'], showAll: undefined }])
    expect(await holder.env.onEnvelope({ id: 'ph' }, { v: 1, t: 'event', seen: { id: 'e1', shown: true, who: 'Ben' } })).toBe('filled')
    const tagged = phone('Anna', [P('h', 'Hanna', { peerId: 'ph' })], [])
    expect(await tagged.env.onEnvelope({ id: 'ph' }, { v: 1, t: 'event', seen: { id: 'e1', shown: true, who: 'Ben' } })).toBe('ignored')
    expect(tagged.state.people).toHaveLength(1)
  })
})

describe('G1 MCP resource_edit', () => {
  const fixture = (inventory) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-w46-asm-'))
    const file = path.join(dir, 'record.json')
    writeFileSync(file, JSON.stringify({ v: 1, me: { id: 'me1', displayName: 'Ana' }, people: [], inventory, events: [] }))
    writeFileSync(path.join(dir, 'colourtags.json'), '[]')
    return { by: Object.fromEntries(allTools({ file, write: true, now: () => new Date(NOW) }).map((t) => [t.name, t])), rec: () => JSON.parse(readFileSync(file, 'utf8')) }
  }
  it('changes title and link of my synced resource; refuses anything else', () => {
    const f = fixture([mine(), mine({ id: 'r2', synced: undefined })])
    f.by.resource_edit.run({ id: 'r1', title: 'Sled guide', link: 'https://example.test/s' })
    expect(f.rec().inventory[0]).toMatchObject({ text: 'Sled guide', link: 'https://example.test/s' })
    expect(() => f.by.resource_edit.run({ id: 'r1', title: 'x', link: 'http://example.test' })).toThrow()
    expect(() => f.by.resource_edit.run({ id: 'r2', title: 'x' })).toThrow()
    expect(f.rec().inventory[0].text).toBe('Sled guide')
  })
})

describe('G3b community ask reaches the host', () => {
  const guestView = () => ({
    people: [person('ph', 'Hanna', { ring: 'acquaintance', fields: { iyg: 'true' } }), person('pc', 'Cleo', { ring: 'acquaintance', fields: { iyg: 'true' } }), person('pv', 'Vera', { peerId: undefined, via: 'ph' })],
    events: [{ id: 'e1', name: 'Winter OG', communityId: 'iyg', attended: true, hosts: ['Hanna'], createdAt: 1 }, { id: 'e2', name: 'Other', communityId: 'zzz', attended: true, hosts: ['Cleo'], createdAt: 1 }],
  })
  it('the hosts of the community\'s events, connected only, no other acquaintance', () => {
    expect(communityHostPeople(guestView(), 'iyg').map((p) => p.name)).toEqual(['Hanna'])
    expect(communityHostPeople(guestView(), 'none')).toEqual([])
  })
})
