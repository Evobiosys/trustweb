// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 45 merge-events, wired: stock Nets over an in-memory relay (harness of a44d_event_joined_net.test.mjs). A host of both events merges at
 * once and the gone event's people re-point on their own devices; two hosts merge only when the other host accepts (sealed `merge` ask / yes / no);
 * a late `joined` record for the old id lands on the kept event and the joiner's device is told. Fake names only.
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
    recipients: (ev) => state.people.filter((x) => x.peerId && x.events?.includes(ev.id)).map((x) => state.peers.find((q) => q.id === x.peerId)).filter(Boolean),
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
/** Both sides connected and holding a card of the other; `events` = the other's card carries these event ids. */
async function pair(a, b, aSeesB = [], bSeesA = []) {
  await connect(a, b)
  const card = (p, other, events) => p.state.people.push({ id: randomId(8), name: other.name, context: '', ring: Ring.Friend, metAt: 0, lines: [], peerId: p.state.peers.find((x) => x.did === other.did).id, ...(events.length ? { events } : {}) })
  card(a, b, aSeesB); card(b, a, bSeesA)
}
const held = (ev) => { const l = encodeEventLink(ev, ORIGIN, 'peer'); const { kind: _k, ...linked } = decodeEventLink(l.slice(l.indexOf('#'))); return { ...linked, createdAt: 1, attended: true, fromLink: true } }
const ids = (p) => (p.state.events ?? []).map((e) => e.id).sort()

describe('wire: the merge envelope', () => {
  const env = (merge) => JSON.stringify({ v: 1, t: 'event', merge })
  it('ask and done carry the kept event as a link; yes and no carry only the two ids', () => {
    expect(parseEnvelope(env({ step: 'ask', keep: 'k1', gone: 'g1', link: 'https://x/#ev=abc' }))).toEqual({ v: 1, t: 'event', merge: { step: 'ask', keep: 'k1', gone: 'g1', link: 'https://x/#ev=abc' } })
    expect(parseEnvelope(env({ step: 'yes', keep: 'k1', gone: 'g1', extra: 1 }))).toEqual({ v: 1, t: 'event', merge: { step: 'yes', keep: 'k1', gone: 'g1' } })
  })
  it('refuses a bad step, bad or equal ids, a missing or oversized link, and mixing with want', () => {
    expect(parseEnvelope(env({ step: 'steal', keep: 'k1', gone: 'g1' }))).toBeNull()
    expect(parseEnvelope(env({ step: 'yes', keep: 'k 1', gone: 'g1' }))).toBeNull()
    expect(parseEnvelope(env({ step: 'yes', keep: 'k1', gone: 'k1' }))).toBeNull()
    expect(parseEnvelope(env({ step: 'done', keep: 'k1', gone: 'g1' }))).toBeNull()
    expect(parseEnvelope(env({ step: 'ask', keep: 'k1', gone: 'g1', link: 'x'.repeat(9000) }))).toBeNull()
    expect(parseEnvelope(JSON.stringify({ v: 1, t: 'event', want: 'k1', merge: { step: 'yes', keep: 'k1', gone: 'g1' } }))).toBeNull()
  })
})

describe('a host of both events merges at once', () => {
  it('the gone event\'s people re-point on their own devices, sealed; my record redirects the old id', async () => {
    const keep = newEvent({ name: 'Winter IYG', from: '2026-12-30', where: 'Alm', hosts: ['Hanna Both'] }, 'evkeep1', 5)
    const gone = newEvent({ name: 'IYG Winter', from: '2026-12-30', where: 'Hut', hosts: ['Hanna Both'] }, 'evgone1', 5)
    const H = await phone('Hanna Both', [keep, gone])
    const G = await phone('Gabi Guest', [held(gone)])
    await pair(H, G, ['evgone1'], [])
    G.state.people[0].lines = [{ id: 'l1', text: 'host of the hut', eventId: 'evgone1' }]
    expect(await H.env.merge.start('evkeep1', 'evgone1')).toBe('merged')
    expect(ids(H)).toEqual(['evkeep1'])
    expect(H.state.people[0].events).toEqual(['evkeep1'])
    expect(H.state.eventMerged).toEqual({ evgone1: 'evkeep1' })
    await until(() => ids(G).join() === 'evkeep1')
    expect(G.state.events[0]).toMatchObject({ name: 'Winter IYG', attended: true })
    expect(G.state.people[0].lines[0].eventId).toBe('evkeep1')
    expect(G.state.eventMerged).toEqual({ evgone1: 'evkeep1' })
    expect(wire.some((w) => w.includes('IYG'))).toBe(false)
  })
})

describe('two hosts: the other host accepts', () => {
  async function setup() {
    const keep = newEvent({ name: 'Open Space', from: '2026-12-01', where: 'Hall', hosts: ['Anna Keep'] }, 'evkeep2', 5)
    const gone = newEvent({ name: 'Open Spaces', from: '2026-12-01', where: 'Hall B', hosts: ['Bea Gone'] }, 'evgone2', 5)
    const A = await phone('Anna Keep', [keep, held(gone)])
    const B = await phone('Bea Gone', [gone])
    const C = await phone('Carl Comer', [held(gone)])
    await pair(A, B)
    await pair(B, C, ['evgone2'], [])
    return { A, B, C }
  }
  it('A asks B; B sees the ask; on yes both merge and B\'s guests re-point', async () => {
    const { A, B, C } = await setup()
    expect(await A.env.merge.start('evkeep2', 'evgone2')).toBe('asked')
    expect(ids(A)).toEqual(['evgone2', 'evkeep2'])
    expect(A.state.eventMergeAsks).toEqual([expect.objectContaining({ dir: 'out', keep: 'evkeep2', gone: 'evgone2' })])
    await until(() => B.state.eventMergeAsks?.length === 1)
    expect(B.state.eventMergeAsks[0]).toMatchObject({ dir: 'in', keep: 'evkeep2', gone: 'evgone2', from: 'Anna Keep' })
    expect(B.state.notifInbox?.[0]).toMatchObject({ id: 'merge:evkeep2:evgone2', kind: 'event', eventId: 'evgone2' })
    expect(await B.env.merge.answer('evkeep2', 'evgone2', true)).toBe(true)
    expect(ids(B)).toEqual(['evkeep2'])
    expect(B.state.people.find((p) => p.name === 'Carl Comer').events).toEqual(['evkeep2'])
    expect(B.state.eventMergeAsks).toBeUndefined()
    await until(() => ids(A).join() === 'evkeep2')
    expect(A.state.eventMergeAsks).toBeUndefined()
    expect(A.state.events[0].hosts).toEqual(['Anna Keep', 'Bea Gone'])
    await until(() => ids(C).join() === 'evkeep2')
    expect(C.state.eventMerged).toEqual({ evgone2: 'evkeep2' })
  })
  it('on no nothing merges and A\'s ask ends', async () => {
    const { A, B } = await setup()
    await A.env.merge.start('evkeep2', 'evgone2')
    await until(() => B.state.eventMergeAsks?.length === 1)
    expect(await B.env.merge.answer('evkeep2', 'evgone2', false)).toBe(true)
    await until(() => !A.state.eventMergeAsks)
    expect(ids(A)).toEqual(['evgone2', 'evkeep2'])
    expect(ids(B)).toEqual(['evgone2'])
  })
  it('nobody but a named host is heard: a stranger\'s ask, a guest\'s done and an unasked yes change nothing', async () => {
    const { A, B, C } = await setup()
    const peerOf = (p, other) => p.state.peers.find((x) => x.did === other.did)
    const fake = encodeEventLink(newEvent({ name: 'Fake', from: '2026-12-01', where: 'X', hosts: ['Anna Keep'] }, 'evfake2', 5), ORIGIN, 'peer')
    await C.net.sendEvent(peerOf(C, B), { v: 1, t: 'event', merge: { step: 'ask', keep: 'evfake2', gone: 'evgone2', link: fake } })
    await B.net.sendEvent(peerOf(B, A), { v: 1, t: 'event', merge: { step: 'yes', keep: 'evkeep2', gone: 'evgone2' } })
    await C.net.sendEvent(peerOf(C, B), { v: 1, t: 'event', merge: { step: 'done', keep: 'evfake2', gone: 'evgone2', link: fake } })
    await sleep(600)
    expect(B.state.eventMergeAsks).toBeUndefined()
    expect(ids(A)).toEqual(['evgone2', 'evkeep2'])
    expect(ids(B)).toEqual(['evgone2'])
  })
  it('without a connected host of the other event there is nobody to ask', async () => {
    const keep = newEvent({ name: 'Solo', from: '2026-12-01', where: 'Hall', hosts: ['Sam Solo'] }, 'evkeep3', 5)
    const other = held(newEvent({ name: 'Elsewhere', from: '2026-12-01', where: 'Far', hosts: ['Unknown Host'] }, 'evgone3', 5))
    const S = await phone('Sam Solo', [keep, other])
    expect(await S.env.merge.start('evkeep3', 'evgone3')).toBe('no-host')
    expect(await S.env.merge.start('evgone3', 'evkeep3')).toBe('no')
  })
})

describe('a late joined record for the old id', () => {
  it('lands on the kept event, and the joiner\'s device is told to re-point', async () => {
    const keep = newEvent({ name: 'Summer IYG', from: '2027-06-01', where: 'Lake', hosts: ['Hugo Host'] }, 'evkeep4', 5)
    const gone = newEvent({ name: 'IYG Summer', from: '2027-06-01', where: 'Shore', hosts: ['Hugo Host'] }, 'evgone4', 5)
    const H = await phone('Hugo Host', [keep, gone])
    const J = await phone('Jo Late', [held(gone)])
    await pair(H, J)
    expect(await H.env.merge.start('evkeep4', 'evgone4')).toBe('merged')
    await J.env.joined(J.state.events[0], { name: 'Hugo Host' })
    await until(() => H.state.people.find((p) => p.name === 'Jo Late').events?.includes('evkeep4'))
    await until(() => ids(J).join() === 'evkeep4')
  })
})
