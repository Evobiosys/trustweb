// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 46 iyg-ask-reach: scope on the wire (+ old payloads), who a host passes a scoped ask to, single hop, "I'm here" back through the host. Fake names only. */
import { SUPPORT_PARAM, buildSupport, cleanScope, parseSupportText, supportText, SupportWindow } from '../../src/support_ask.ts'
import { eventHostPeople, parseViaHere, relayPeers, relayText, scopeOfFilter, viaHereText } from '../../src/support_relay.ts'
import { MAX_FANOUT } from '../../src/hops.ts'
import { communityTools } from '../../../mcp/src/community_tools.ts'

const APP = 'https://app.example.test/'
const NOW = Date.UTC(2026, 10, 24, 10)
const person = (id, extra = {}) => ({ id: 'p-' + id, name: id, ring: 'friend', fields: {}, peerId: id, ...extra })
const peers = (...ids) => ids.map((id) => ({ id, displayName: id }))
const ask = (scope) => ({ id: 'ask1', chips: ['listen'], note: 'hello', until: NOW + 1e6, ...(scope ? { scope } : {}) })
const hostEvent = (over = {}) => ({ id: 'ev1', name: 'Winter IYG', from: '2026-12-30', where: 'Vienna', createdAt: 1, attended: true, ...over })
const state = (over = {}) => ({
  me: { id: 'me', displayName: 'Hana Host' },
  people: [person('anna', { events: ['ev1'] }), person('ben', { events: ['ev1'] }), person('cy', { events: ['ev1'] }), person('dora')],
  peers: peers('anna', 'ben', 'cy', 'dora'),
  events: [hostEvent()],
  supportIn: [],
  ...over,
})
const ids = (list) => list.map((p) => p.id)

describe('scope on the wire', () => {
  it('encodes into the support text and decodes back; id and the rest stay', () => {
    const a = buildSupport({ chips: ['listen'], note: 'x', window: SupportWindow.Today, ids: ['a'], scope: { event: 'ev1', name: 'Winter IYG' } }, NOW, 'ask1')
    const back = parseSupportText(APP, supportText(APP, a))
    expect(back.id).toBe('ask1')
    expect(back.scope).toEqual({ event: 'ev1', name: 'Winter IYG' })
  })
  it('an old payload without scope still parses, with no scope key', () => {
    const old = `${APP}?${SUPPORT_PARAM}=${encodeURIComponent(JSON.stringify({ id: 'o1', chips: ['call'], note: '', until: NOW }))}`
    const back = parseSupportText(APP, old)
    expect(back).toEqual({ id: 'o1', chips: ['call'], note: '', until: NOW })
    expect(supportText(APP, ask())).not.toContain('scope')
  })
  it('cleanScope keeps known fields, clips long text, drops junk and empty scopes', () => {
    expect(cleanScope({ tag: 't', evil: 1, from: 'x'.repeat(80) })).toEqual({ tag: 't', from: 'x'.repeat(40) })
    expect(cleanScope({ name: 'only a name' })).toBeUndefined()
    expect(cleanScope('nope')).toBeUndefined()
    expect(cleanScope({ event: 5, tag: ['a'] })).toBeUndefined()
  })
  it('scopeOfFilter: the community tag and/or the first event chip, with their labels', () => {
    const label = (kind, id) => `${kind}:${id}`
    expect(scopeOfFilter({ only: 'iyg', add: [] }, label)).toEqual({ tag: 'iyg', name: 'tag:iyg' })
    expect(scopeOfFilter({ add: ['person:p1', 'event:ev1'] }, label)).toEqual({ event: 'ev1', name: 'event:ev1' })
    expect(scopeOfFilter({ add: ['person:p1'] }, label)).toBeUndefined()
  })
})

describe('relay: who the host passes it on to (event)', () => {
  const scope = { event: 'ev1', name: 'Winter IYG' }
  it('a host passes it to the other attendees, never back to the sender', () => {
    expect(ids(relayPeers(state(), ask(scope), 'anna'))).toEqual(['ben', 'cy'])
  })
  it('people of the event I never meet stay out; people outside the event too', () => {
    expect(ids(relayPeers(state(), ask(scope), 'anna'))).not.toContain('dora')
  })
  it('a non-host never forwards', () => {
    const s = state({ events: [hostEvent({ fromLink: true, hosts: ['Someone Else'] })] })
    expect(relayPeers(s, ask(scope), 'anna')).toEqual([])
  })
  it('an unscoped ask is never forwarded', () => {
    expect(relayPeers(state(), ask(), 'anna')).toEqual([])
  })
  it('a sender who is not part of the event cannot use the host as a megaphone', () => {
    expect(relayPeers(state(), ask(scope), 'dora')).toEqual([])
  })
  it('people who opted out (non-responsive) or are blocked get nothing', () => {
    const s = state()
    s.people[1].fields = { 'tw-non-responsive': 'true' }
    s.people[2].blocked = 1
    expect(relayPeers(s, ask(scope), 'anna')).toEqual([])
  })
  it('a relayed ask is never relayed again (single hop)', () => {
    expect(relayPeers(state(), ask({ ...scope, relayed: true, from: 'Anna' }), 'anna')).toEqual([])
  })
  it('an ask already received (same id) is dropped', () => {
    expect(relayPeers(state({ supportIn: [{ id: 'ask1', peerId: 'anna', chips: [], note: '', until: NOW }] }), ask(scope), 'anna')).toEqual([])
  })
  it('the fan-out is capped at MAX_FANOUT', () => {
    const many = Array.from({ length: MAX_FANOUT + 10 }, (_, i) => `m${i}`)
    const s = state({ people: [person('anna', { events: ['ev1'] }), ...many.map((m) => person(m, { events: ['ev1'] }))], peers: peers('anna', ...many) })
    expect(relayPeers(s, ask(scope), 'anna')).toHaveLength(MAX_FANOUT)
  })
})

describe('the ask reaches the event\'s hosts', () => {
  it('hosts by name or id, connected only', () => {
    const s = state({ people: [person('hana'), person('anna'), { ...person('ghost'), peerId: undefined, name: 'Gus' }], events: [hostEvent({ hosts: ['Hana', 'Gus'] })] })
    expect(eventHostPeople(s, 'ev1').map((p) => p.id)).toEqual(['p-hana'])
    expect(eventHostPeople(s, 'nope')).toEqual([])
  })
})

describe('relay: community tag', () => {
  const scope = { tag: 'iyg', name: 'IYG' }
  const community = (over) => ({ 'community-mighty': { meta: { iyg: { kind: 'managed', organizers: ['me'], ...over } } } })
  const members = () => [person('anna', { fields: { iyg: 'true' } }), person('ben', { fields: { iyg: 'true' } }), person('dora')]
  const s0 = (extData) => state({ people: members(), peers: peers('anna', 'ben', 'dora'), events: [], extData })
  it('an organizer of a community that announces passes it to the other holders of the tag', () => {
    expect(ids(relayPeers(s0(community()), ask(scope), 'anna'))).toEqual(['ben'])
  })
  it('a plain member (informal community, no organizer role) never forwards', () => {
    expect(relayPeers(s0({ 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [] } } } }), ask(scope), 'anna')).toEqual([])
  })
  it('a community that does not announce (invited only) never forwards', () => {
    expect(relayPeers(s0(community({ eventAccess: 'invited' })), ask(scope), 'anna')).toEqual([])
  })
})

describe('relayed text and the answer back', () => {
  it('same ask, marked relayed with the asker name (clipped); receivers parse it', () => {
    const t = relayText(APP, { ...ask({ event: 'ev1', name: 'Winter IYG' }), scope: { event: 'ev1', name: 'Winter IYG' } }, 'A'.repeat(60))
    const back = parseSupportText(APP, t)
    expect(back.note).toBe('hello')
    expect(back.id).toBe('ask1')
    expect(back.scope).toEqual({ event: 'ev1', name: 'Winter IYG', relayed: true, from: 'A'.repeat(40) })
  })
  it('"I\'m here" through the host: who answered travels as a name', () => {
    expect(parseViaHere(APP, viaHereText(APP, 'ask1', 'Ben'))).toEqual({ id: 'ask1', name: 'Ben' })
    expect(parseViaHere(APP, `${APP}?support-via=garbage`)).toBeNull()
  })
})

describe('MCP parity: support_ask takes the scope', () => {
  it('the scope is written on the queued ask and validated', () => {
    const rec = { people: [person('anna', { ring: 'closest' })], peers: [] }
    const env = { load: () => rec, commit: (f) => { f(rec); return true }, write: true, now: () => new Date(NOW) }
    const tool = communityTools(env).write.find((t) => t.name === 'support_ask')
    const out = tool.run({ text: 'hello', audience: ['closest-few'], scope: { event: 'ev1', name: 'Winter IYG', junk: 1 } })
    expect(out.asked).toBe(1)
    expect(rec.supportAsks[0].scope).toEqual({ event: 'ev1', name: 'Winter IYG' })
    expect(() => tool.run({ text: 'x', audience: ['closest-few'], scope: { name: 'no ids' } })).toThrow()
  })
})
