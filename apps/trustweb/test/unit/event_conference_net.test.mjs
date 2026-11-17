// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c event-autosave (zeta), wired: two stock Nets over an in-memory relay (as hide_from_net.test.mjs). The guest holds the event from its
 * link (no conference link in it); "I will attend" sends the host an rsvp; the host's device answers with the link, sealed; the guest shows it.
 * The relay never sees the link in clear. Fake names and links only.
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { Net } from '../../src/net.ts'
import { Ring } from '../../src/model.ts'
import { newEvent } from '../../src/events.ts'
import { decodeEventLink, encodeEventLink } from '../../src/event_link.ts'
import { createEventEnvelopes } from '../../src/event_envelope.ts'
import { attendChanged, conferenceState } from '../../src/event_conference.ts'

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

async function phone(name, events) {
  const state = { v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false, inventory: [], events }
  const p = { name, state }
  p.env = createEventEnvelopes({
    state: () => state, save: () => {}, now: Date.now, link: (ev) => encodeEventLink(ev, ORIGIN, 'peer'), send: (peer, e) => p.net.sendEvent(peer, e),
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

describe('the conference link reaches a guest only after "I will attend"', () => {
  it('rsvp yes -> sealed conference link -> shown under Location', async () => {
    const hostEv = { ...newEvent({ name: 'Online circle', from: '2026-12-30', where: 'Online', hosts: ['Hanna Host'] }, 'evnet1', 5), conference: [{ provider: 'jitsi', url: URL_ }] }
    const link = encodeEventLink(hostEv, ORIGIN, 'peer', { name: 'Hanna Host' })
    expect(link).not.toContain('jit.si')
    const { kind: _k, ...linked } = decodeEventLink(link.slice(link.indexOf('#')))
    const H = await phone('Hanna Host', [hostEv])
    const G = await phone('Gabi Guest', [{ ...linked, createdAt: 1, attended: false, fromLink: true }])
    await connect(G, H)
    knows(G, H); knows(H, G)
    const ev = G.state.events[0]
    expect(conferenceState(ev)).toBe('hidden')

    ev.attended = true
    expect(attendChanged(G.state, ev)).toBe(true)
    await G.env.rsvp(ev)
    await until(() => conferenceState(ev) !== 'asked' && conferenceState(ev) !== 'hidden')
    expect(conferenceState(ev)).toEqual({ links: [{ provider: 'jitsi', url: URL_ }] })
    expect(H.state.events[0].confTo).toHaveLength(1)
    // the link went out once, as a conf envelope after the rsvp, through the sealed channel (channel.send with the pair key)
    expect(wire.filter((w) => w.includes('jit.si')).map((w) => JSON.parse(w).conf?.id)).toEqual(['evnet1'])
    expect(wire.findIndex((w) => w.includes('"rsvp"'))).toBeLessThan(wire.findIndex((w) => w.includes('jit.si')))
  })
})
