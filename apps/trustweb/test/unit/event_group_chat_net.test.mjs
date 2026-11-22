// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * wave45 event-group-chat, wired: three stock Nets over an in-memory relay. Hanna hosts; Ben and Cleo are connected to Hanna only. Ben accepts
 * the invitation (sealed `joined`) -> Hanna's device announces the join to everyone in the event's ONE thread; Ben writes -> Cleo reads it in the
 * same thread (passed on by the host's device, sealed per pair); Cleo leaves -> nothing more reaches her. Fake names only.
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { Net } from '../../src/net.ts'
import { Ring } from '../../src/model.ts'
import { newEvent } from '../../src/events.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { createEventGroupChat, threadOf } from '../../src/event_group_chat.ts'

const ORIGIN = 'https://app.trustweb.one'
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
beforeAll(async () => {
  relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port } = await relay.listen(0, '127.0.0.1')
  relayOrigin = `http://127.0.0.1:${port}`
})
afterAll(async () => {
  for (const n of nets) n.stop()
  await relay.close()
})

async function phone(name, events) {
  const state = { v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false, inventory: [], events }
  const p = { name, state, sealed: 0 }
  p.env = createEventEnvelopes({
    state: () => state, save: () => {}, now: Date.now, link: (ev) => encodeEventLink(ev, ORIGIN, 'peer'), send: (peer, e) => p.net.sendEvent(peer, e), recipients: () => [],
    pending: () => null, setPending: () => {}, changed: () => {}, later: () => {}, peers: () => state.peers,
  })
  p.chat = createEventGroupChat({ state: () => state, save: () => {}, now: Date.now, newId: () => randomId(10), peers: () => state.peers, send: (peer, e) => p.net.sendEvent(peer, e), changed: () => {} })
  p.net = new Net({
    state: () => state, save: () => {}, onStatus: () => {}, onAsk: () => {},
    onPeerConnected: () => {}, holdPeer: () => false, onPeerConfirmed: () => {}, ringForNewPeer: () => Ring.Friend, onLogChanged: () => {},
    askScope: () => undefined, onText: () => {}, mayPassOnFrom: () => true, samePerson: () => false,
    // main.ts: a gc item goes to the group chat; any other event envelope to event_envelope.ts, then the chat hears of joins / rsvps
    onEvent: (peer, env) => { if (env.gc) void p.chat.onEnvelope(peer, env.gc); else void p.env.onEnvelope(peer, env).then((o) => p.chat.afterEnvelope(peer, env, o)) },
  }, { relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  const send = p.net.channel.send.bind(p.net.channel)
  p.net.channel.send = (did, env, key) => { if (env.gc) { expect(key).toBeTruthy(); p.sealed++ } return send(did, env, key) }
  return p
}
async function connect(a, b) {
  await a.net.completeConnect({ did: b.did, from: b.state.me }, Ring.Friend)
  await until(() => b.state.peers.some((x) => x.did === a.did))
}
const knows = (p, other, over = {}) => {
  const peer = p.state.peers.find((x) => x.did === other.did)
  p.state.people.push({ id: randomId(8), name: other.name, context: '', ring: Ring.Friend, metAt: 0, lines: [], peerId: peer.id, ...over })
}
const texts = (p) => threadOf(p.state, 'evgc1').items.map((i) => `${i.k}:${i.by}${i.text ? `:${i.text}` : ''}`)

describe('one shared thread per event, over the relay', () => {
  it('join announced, a guest message reaches the other guest through the host, a leave stops delivery', async () => {
    const hostEv = newEvent({ name: 'Winter OG', from: '2026-12-30', where: 'Alm', hosts: ['Hanna Host'] }, 'evgc1', 5)
    const link = encodeEventLink(hostEv, ORIGIN, 'peer', { name: 'Hanna Host' })
    const { kind: _k, ...linked } = decodeEventLink(link.slice(link.indexOf('#')))
    const H = await phone('Hanna Host', [hostEv])
    const B = await phone('Ben Guest', [{ ...linked, createdAt: 1, attended: true, fromLink: true }])
    const C = await phone('Cleo Guest', [{ ...linked, createdAt: 1, attended: true, fromLink: true }])
    await connect(B, H); knows(B, H); knows(H, B)
    await connect(C, H); knows(C, H); knows(H, C, { events: ['evgc1'] })
    await H.chat.send('evgc1', 'Welcome to Winter OG')
    await until(() => texts(C).includes('msg:Hanna Host:Welcome to Winter OG'))

    await B.env.joined(B.state.events[0], { name: 'Hanna Host' })
    await until(() => texts(C).includes('join:Ben Guest'))
    await until(() => texts(B).includes('msg:Hanna Host:Welcome to Winter OG'))   // the history for the new member
    expect(texts(H)).toContain('join:Ben Guest')

    await B.chat.send('evgc1', 'Who brings tea?')
    await until(() => texts(C).includes('msg:Ben Guest:Who brings tea?'))
    expect(texts(H)).toContain('msg:Ben Guest:Who brings tea?')
    expect(threadOf(C.state, 'evgc1').items.filter((i) => i.text === 'Who brings tea?').length).toBe(1)

    await C.chat.leave('evgc1', true)
    await until(() => texts(H).includes('leave:Cleo Guest'))
    await until(() => texts(B).includes('leave:Cleo Guest'))
    await B.chat.send('evgc1', 'Tea is sorted')
    await until(() => texts(H).includes('msg:Ben Guest:Tea is sorted'))
    await sleep(300)
    expect(texts(C)).not.toContain('msg:Ben Guest:Tea is sorted')
    expect(H.sealed + B.sealed + C.sealed).toBeGreaterThan(5)
  })
})
