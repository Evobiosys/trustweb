// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * answers-44d item 4c, wired: two (three) stock Nets over an in-memory relay. A guest accepts the event invitation I shared: their device sends a
 * sealed `joined` envelope to me (the inviter) and to the hosts; my device marks them joined (event page, Web). In an intimate community, the
 * host's device also introduces the new joiner to the others at the event (seen-through). Fake names only.
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { Net } from '../../src/net.ts'
import { Ring } from '../../src/model.ts'
import { newEvent } from '../../src/events.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { decodeFromQr as parseEnvelope } from '../../../demo/src/wire.ts'

const ORIGIN = 'https://app.trustweb.one'
const URL_ = 'https://meet.jit.si/fake-room-4711'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(20)
  }
}

let relay, relayOrigin
const nets = []
const wire = []
beforeAll(async () => {
  relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port } = await relay.listen(0, '127.0.0.1')
  relayOrigin = `http://127.0.0.1:${port}`
})
afterAll(async () => {
  for (const n of nets) n.stop()
  await relay.close()
})

async function phone(name, events, extData) {
  const state = { v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false, inventory: [], events, ...(extData ? { extData } : {}) }
  const p = { name, state }
  p.env = createEventEnvelopes({
    state: () => state, save: () => {}, now: Date.now, link: (ev) => encodeEventLink(ev, ORIGIN, 'peer'), send: (peer, e) => p.net.sendEvent(peer, e), recipients: (ev) => state.people.filter((x) => x.peerId && x.events?.includes(ev.id)).map((x) => state.peers.find((q) => q.id === x.peerId)).filter(Boolean),
    pending: () => null, setPending: () => {}, changed: () => {}, later: () => {}, peers: () => state.peers,
  })
  p.net = new Net({
    state: () => state, save: () => {}, onStatus: () => {}, onAsk: () => {},
    onPeerConnected: () => {}, holdPeer: () => false, onPeerConfirmed: () => {}, ringForNewPeer: () => Ring.Friend, onLogChanged: () => {},
    askScope: () => undefined, onText: () => {}, mayPassOnFrom: () => true, samePerson: () => false,
    onEvent: (peer, env) => { void p.env.onEnvelope(peer, env) },
  }, { relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  const send = p.net.channel.send.bind(p.net.channel)
  p.net.channel.send = (did, env, key) => { expect(key).toBeTruthy(); wire.push(JSON.stringify(env)); return send(did, env, key) }
  return p
}

async function connect(a, b) {
  await a.net.completeConnect({ did: b.did, from: b.state.me }, Ring.Friend)
  await until(() => b.state.peers.some((x) => x.did === a.did))
}
const knows = (p, other) => {
  const peer = p.state.peers.find((x) => x.did === other.did)
  p.state.people.push({ id: randomId(8), name: other.name, context: '', ring: Ring.Friend, metAt: 0, lines: [], peerId: peer.id })
}

describe('wire: the joined envelope', () => {
  it('parses {id}; anything with want / link or a bad id is refused', () => {
    expect(parseEnvelope(JSON.stringify({ v: 1, t: 'event', joined: { id: 'evnet1' } }))).toEqual({ v: 1, t: 'event', joined: { id: 'evnet1' } })
    expect(parseEnvelope(JSON.stringify({ v: 1, t: 'event', joined: { id: 'evnet1' }, want: 'evnet1' }))).toBeNull()
    expect(parseEnvelope(JSON.stringify({ v: 1, t: 'event', joined: { id: 'bad id!' } }))).toBeNull()
    expect(parseEnvelope(JSON.stringify({ v: 1, t: 'event', joined: 'evnet1' }))).toBeNull()
  })
})

describe('an accepted event invitation reaches the inviter (4c)', () => {
  it('the guest joins -> sealed joined -> the host marks them joined, as an acquainted community member', async () => {
    const hostEv = { ...newEvent({ name: 'Winter OG', from: '2026-12-30', where: 'Alm', hosts: ['Hanna Host'] }, 'evnet1', 5), communityId: 'iyg' }
    const link = encodeEventLink(hostEv, ORIGIN, 'peer', { name: 'Hanna Host' })
    const { kind: _k, ...linked } = decodeEventLink(link.slice(link.indexOf('#')))
    const H = await phone('Hanna Host', [hostEv], { 'community-mighty': { meta: { iyg: { kind: 'informal', organizers: [] } } } })
    const G = await phone('Gabi Guest', [{ ...linked, createdAt: 1, attended: true, fromLink: true }])
    await connect(G, H)
    knows(G, H); knows(H, G)
    H.state.people.find((p) => p.name === 'Gabi Guest').ring = 'unsorted'
    await G.env.joined(G.state.events[0], { name: 'Hanna Host' })
    await until(() => H.state.people.find((p) => p.name === 'Gabi Guest').events?.includes('evnet1'))
    expect(H.state.people.find((p) => p.name === 'Gabi Guest')).toMatchObject({ ring: 'acquaintance', fields: { iyg: 'true' } })
    expect(wire.some((w) => w.includes('"joined"') && !w.includes('Gabi'))).toBe(true)
  })

  it('a host of an intimate community event introduces the new joiner to the others there; a big community does not', async () => {
    const make = async (meta) => {
      const ev = { ...newEvent({ name: 'Circle', from: '2026-12-30', where: 'Hall', hosts: ['Hostia'] }, 'evnet2', 5), communityId: 'c1' }
      const link = encodeEventLink(ev, ORIGIN, 'peer', { name: 'Hostia' })
      const { kind: _k, ...linked } = decodeEventLink(link.slice(link.indexOf('#')))
      const H = await phone('Hostia', [ev], { 'community-mighty': { meta: { c1: { kind: 'informal', organizers: [], ...meta } } } })
      const O = await phone('Otto Other', [{ ...linked, createdAt: 1, attended: true, fromLink: true }])
      const J = await phone('Jana Joiner', [{ ...linked, createdAt: 1, attended: true, fromLink: true }])
      await connect(O, H); knows(O, H); knows(H, O)
      await connect(J, H); knows(J, H); knows(H, J)
      H.state.people.find((p) => p.name === 'Otto Other').events = ['evnet2']
      return { H, O, J }
    }
    const small = await make({ intimate: true })
    small.J.state.events[0].showMe = 'open' // iyg-reviewfix F1: only a guest who shows 'open' is named without the host's showAll
    await small.J.env.joined(small.J.state.events[0], { name: 'Hostia' })
    await until(() => small.O.state.people.some((p) => p.via && p.name === 'Jana Joiner'))
    const big = await make({ intimate: false })
    big.J.state.events[0].showMe = 'open'
    await big.J.env.joined(big.J.state.events[0], { name: 'Hostia' })
    await until(() => big.H.state.people.find((p) => p.name === 'Jana Joiner').events?.includes('evnet2'))
    await sleep(400)
    expect(big.O.state.people.some((p) => p.via)).toBe(false)
  })
})
