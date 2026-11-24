// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave46 iyg-guest-path: community meta for a guest (receive gates, send once per change, invite token flag, wire). Fake names only. */
import { commOut, applyComm, joinedCommunity } from '../../src/community_meta.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { createInvite, verifyInvite } from '../../src/invite_policy.ts'
import { decodeFromQr as parse } from '../../../demo/src/wire.ts'

const P = (id, name, over = {}) => ({ id, name, ring: 'friend', lines: [], metAt: 0, ...over })
const ev = (over = {}) => ({ id: 'e1', name: 'IYG', from: '2026-12-01', where: 'Alm', createdAt: 1, attended: true, hosts: ['Hanna'], ...over })
const slice = (s) => s.extData?.['community-mighty']
const guest = (people, events = [ev()], extData) => ({ me: { id: 'm', displayName: 'Anna' }, people, peers: [], events, ...(extData ? { extData } : {}) })
const hanna = (over = {}) => P('h', 'Hanna', { peerId: 'ph', fields: { iyg: 'true' }, metAt: 1, ...over })

describe('applyComm (guest phone)', () => {
  const c = { tag: 'iyg', name: 'IYG', intimate: true, ev: ['e1'] }
  it('no organizer recorded: the person I joined through becomes it; community named, selected, managed; the event is marked', () => {
    const s = guest([hanna()], [ev({ fromLink: true })])
    expect(applyComm(s, s.people[0], c)).toBe(true)
    expect(slice(s).tag).toBe('iyg')
    expect(slice(s).meta.iyg).toMatchObject({ kind: 'managed', organizers: ['h'], name: 'IYG', intimate: true })
    expect(s.events[0].communityId).toBe('iyg')
  })
  it('a second identical run changes nothing', () => {
    const s = guest([hanna()])
    applyComm(s, s.people[0], c)
    expect(applyComm(s, s.people[0], c)).toBe(false)
  })
  it('a plain member cannot claim organizer when one is recorded', () => {
    const s = guest([hanna(), P('x', 'Xavier', { peerId: 'px', fields: { iyg: 'true' }, metAt: 5 })])
    applyComm(s, s.people[0], c)
    expect(applyComm(s, s.people[1], { ...c, name: 'Evil' })).toBe(false)
    expect(slice(s).meta.iyg.organizers).toEqual(['h'])
    expect(slice(s).meta.iyg.name).toBe('IYG')
  })
  it('no organizer recorded yet: only the first person I met in it may claim, not a later member', () => {
    const s = guest([hanna(), P('x', 'Xavier', { peerId: 'px', fields: { iyg: 'true' }, metAt: 5 })])
    expect(applyComm(s, s.people[1], c)).toBe(false)
    expect(slice(s)).toBeUndefined()
  })
  it('a community I do not hold from that person is dropped', () => {
    const s = guest([hanna({ fields: {} })])
    expect(applyComm(s, s.people[0], c)).toBe(false)
    expect(slice(s)).toBeUndefined()
  })
  it('a second-hand card cannot claim', () => {
    const s = guest([hanna({ via: 'q' })])
    expect(applyComm(s, s.people[0], c)).toBe(false)
  })
  it('name is cut to 40; an event only where the sender is a named host and none is set', () => {
    const s = guest([hanna()], [ev({ id: 'e1' }), ev({ id: 'e2', hosts: ['Other'] }), ev({ id: 'e3', communityId: 'zzz' })])
    applyComm(s, s.people[0], { ...c, name: 'n'.repeat(60), ev: ['e1', 'e2', 'e3', 'nope'] })
    expect(slice(s).meta.iyg.name).toHaveLength(40)
    expect(s.events.map((e) => e.communityId)).toEqual(['iyg', undefined, 'zzz'])
  })
})

describe('commOut (organizer phone)', () => {
  const host = (m) => ({ me: { id: 'm', displayName: 'Hanna' }, people: [], events: [ev({ communityId: 'iyg' }), ev({ id: 'e2', hosts: ['Other'], communityId: 'iyg', fromLink: true }), ev({ id: 'e3' })], extData: { 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['me'], ...m } } } } })
  it('organizer: tag, name, intimate, the community events I host', () => {
    expect(commOut(host({ intimate: true }), 'iyg', 'IYG')).toEqual({ tag: 'iyg', name: 'IYG', intimate: true, ev: ['e1'] })
  })
  it('not an organizer: nothing', () => {
    expect(commOut(host({ organizers: [] }), 'iyg', 'IYG')).toBeNull()
    expect(commOut(host({}), 'other', 'X')).toBeNull()
  })
})

describe('joinedCommunity (invite accepted)', () => {
  it('an organizer inviter is recorded; the community is selected', () => {
    const s = guest([hanna()], [])
    joinedCommunity(s, 'iyg', 'IYG', s.people[0], true)
    expect(slice(s)).toMatchObject({ tag: 'iyg', meta: { iyg: { kind: 'managed', organizers: ['h'], name: 'IYG' } } })
  })
  it('a plain inviter: selected only, no organizer', () => {
    const s = guest([hanna()], [])
    joinedCommunity(s, 'iyg', 'IYG', s.people[0], false)
    expect(slice(s).tag).toBe('iyg')
    expect(slice(s).meta?.iyg?.organizers ?? []).toEqual([])
  })
  it('a community already selected stays selected', () => {
    const s = guest([hanna()], [], { 'community-mighty': { tag: 'other' } })
    joinedCommunity(s, 'iyg', 'IYG', s.people[0], true)
    expect(slice(s).tag).toBe('other')
  })
})

describe('invite token organizer flag', () => {
  const sign = () => 'sig'
  const mk = (organizer) => createInvite({ kind: 'open', tag: 'iyg', label: 'IYG', inviterDid: 'did:x', inviterName: 'Hanna', id: 'abc', now: 0, sign, ...(organizer !== undefined ? { organizer } : {}) })
  const read = (e) => verifyInvite(e.tok, 'did:x', 1, () => true)
  it('carried when the inviter organizes, absent otherwise (old tokens unchanged)', () => {
    expect(read(mk(true)).inv.o).toBe(1)
    expect(read(mk(false)).inv.o).toBeUndefined()
    expect(read(mk()).inv.o).toBeUndefined()
  })
})

describe('wire', () => {
  const env = (comm) => JSON.stringify({ v: 1, t: 'event', comm })
  it('round trip, name cut check, bad shapes dropped', () => {
    expect(parse(env({ tag: 'iyg', name: 'IYG', intimate: true, ev: ['e1'] }))).toEqual({ v: 1, t: 'event', comm: { tag: 'iyg', name: 'IYG', intimate: true, ev: ['e1'] } })
    expect(parse(env({ tag: 'iyg', name: 'n'.repeat(41), ev: [] }))).toBeNull()
    expect(parse(env({ tag: '', ev: [] }))).toBeNull()
    expect(parse(env({ tag: 'iyg', ev: 'e1' }))).toBeNull()
    expect(parse(env({ tag: 'iyg', ev: Array.from({ length: 51 }, (_, i) => 'e' + i) }))).toBeNull()
    expect(parse(JSON.stringify({ v: 1, t: 'event', want: 'e1', comm: { tag: 'iyg', ev: [] } }))).toBeNull()
  })
})

function phone(name, people, events, extData, tagName) {
  const state = { v: 1, me: { id: 'm', displayName: name }, peers: people.filter((p) => p.peerId).map((p) => ({ id: p.peerId, displayName: p.name })), people, log: [], events, ...(extData ? { extData } : {}) }
  const sent = []
  const env = createEventEnvelopes({
    state: () => state, save: () => {}, now: () => 1000, link: () => '', send: async (p, e) => { sent.push([p.id, e]) }, tagName,
    recipients: (e) => state.people.filter((x) => x.peerId && x.events?.includes(e.id)).map((x) => ({ id: x.peerId })),
    members: (tag) => state.people.filter((x) => x.peerId && String(x.fields?.[tag]) === 'true').map((x) => ({ id: x.peerId })),
    pending: () => null, setPending: () => {}, changed: () => {}, later: () => {}, peers: () => [],
  })
  return { state, sent, env }
}
const meta = (m) => ({ 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['me'], intimate: true, ...m } } } })
const comms = (h) => h.sent.filter(([, e]) => e.comm).map(([p, e]) => [p, e.comm])

describe('envelope: send once per change, receive', () => {
  const members = () => [P('a', 'Anna', { peerId: 'pa', fields: { iyg: 'true' }, events: ['e1'] }), P('b', 'Ben', { peerId: 'pb', fields: { iyg: 'true' } }), P('z', 'Zed', { peerId: 'pz' })]
  it('the organizer sends each member its community data once; a change goes again; non-members get none', async () => {
    const h = phone('Hanna', members(), [ev({ communityId: 'iyg' })], meta({}), () => 'IYG')
    await h.env.rosterSync()
    expect(comms(h).map(([p]) => p).sort()).toEqual(['pa', 'pb'])
    expect(comms(h)[0][1]).toEqual({ tag: 'iyg', name: 'IYG', intimate: true, ev: ['e1'] })
    h.sent.length = 0
    await h.env.rosterSync()
    expect(comms(h)).toEqual([])
    h.state.events.push(ev({ id: 'e2', communityId: 'iyg' }))
    await h.env.rosterSync()
    expect(comms(h).map(([, c]) => c.ev)).toEqual([['e1', 'e2'], ['e1', 'e2']])
  })
  it('a joiner of a community event gets it at once, even when nothing else changed', async () => {
    const h = phone('Hanna', members(), [ev({ communityId: 'iyg' })], meta({}), () => 'IYG')
    await h.env.rosterSync()
    h.sent.length = 0
    expect(await h.env.onEnvelope({ id: 'pb' }, { v: 1, t: 'event', joined: { id: 'e1' } })).toBe('filled')
    expect(comms(h).filter(([p]) => p === 'pb')).toHaveLength(1)
  })
  it('not an organizer: sends nothing', async () => {
    const h = phone('Hanna', members(), [ev({ communityId: 'iyg' })], meta({ organizers: [] }))
    await h.env.rosterSync()
    expect(comms(h)).toEqual([])
  })
  it('the guest side applies it from a connected person only', async () => {
    const g = phone('Anna', [hanna()], [ev({ fromLink: true })])
    expect(await g.env.onEnvelope({ id: 'unknown' }, { v: 1, t: 'event', comm: { tag: 'iyg', ev: ['e1'] } })).toBe('ignored')
    expect(await g.env.onEnvelope({ id: 'ph' }, { v: 1, t: 'event', comm: { tag: 'iyg', ev: ['e1'] } })).toBe('filled')
    expect(g.state.events[0].communityId).toBe('iyg')
  })
})
