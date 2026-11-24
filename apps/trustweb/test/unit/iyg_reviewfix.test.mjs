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
