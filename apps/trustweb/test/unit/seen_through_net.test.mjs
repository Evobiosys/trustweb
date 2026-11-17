// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c seen-through: three stock Nets (Anna asks, Lena knows, Omar is asked to be shown) end to end over a real relay (harness of ask_escalation_net.test.mjs). */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { createIdentity, ecdhSharedSecret } from '../../../demo/src/did.ts'
import { createRelayChannel } from '../../../demo/src/relay.ts'
import { deriveEcdhPairKey, randomId } from '../../../demo/src/crypto.ts'
import { encodeForQr } from '../../../demo/src/wire.ts'
import { buildConnectAck } from '../../../demo/src/connect_link.ts'
import { interpret } from '../../../demo/src/gate.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Net } from '../../src/net.ts'
import { Audience, LogOutcome, Ring } from '../../src/model.ts'
import { passOnAllowed, samePersonTarget } from '../../src/one_jakob.ts'

const W = 600
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(20)
  }
}

let relay
let relayOrigin
const nets = []
const raws = []

beforeAll(async () => {
  relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port } = await relay.listen(0, '127.0.0.1')
  relayOrigin = `http://127.0.0.1:${port}`
})
afterAll(async () => {
  for (const n of nets) n.stop()
  for (const r of raws) r.close()
  await relay.close()
})

/**
 * One phone: its record, the Net the app runs, and the person at it:
 * `share(ask)` says whether they tap "Share these" (default: yes).
 */
async function phone(name, items = [], opts = {}) {
  const state = {
    v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false,
    inventory: items.map((it) => ({ id: randomId(8), included: true, createdAt: Date.now(), audience: Audience.FriendsOfFriends, ...it })),
    ...opts.state,
  }
  const asks = []
  const p = { name, state, asks, note: opts.note, who: opts.who, passOn: opts.passOn ?? (() => true), share: opts.share ?? (() => true), samePerson: opts.samePerson ?? (() => false) }
  p.net = new Net({
    state: () => state,
    save: () => {},
    onStatus: () => {},
    onAsk: (ask) => { asks.push(ask); void ask.decide(p.share(ask), p.note?.(ask), p.who?.(ask)) },
    onPeerConnected: () => {},
    holdPeer: () => false,
    onPeerConfirmed: () => {},
    ringForNewPeer: () => Ring.Friend,
    onLogChanged: () => {},
    askScope: () => undefined,
    onText: () => {},
    mayPassOnFrom: (peer) => p.passOn(peer),
    samePerson: (target, sender) => p.samePerson(target, sender),
  }, { answerWindowMs: W, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

/** Connects two phones both ways (the one-scan ceremony) with the given rings. */
async function connect(a, b, ringOfBAtA = Ring.Friend, ringOfAAtB = Ring.Friend) {
  await a.net.completeConnect({ did: b.did, from: b.state.me }, ringOfBAtA)
  await until(() => b.state.peers.some((x) => x.did === a.did))
  b.state.peers.find((x) => x.did === a.did).ring = ringOfAAtB
}

const sharedOf = (results) => results.flatMap((r) => (r.decoded?.outcome === 'shared' ? r.decoded.shared.items : []))



const beyond = (p) => p.state.people.filter((x) => x.via)

describe('seen through: resource asks and intro asks', () => {
  let A, L, O
  beforeAll(async () => {
    A = await phone('Anna')
    O = await phone('Omar', [{ text: 'Ladder, 4 m' }])
    L = await phone('Lena', [], { note: () => 'Omar has one in his shed', who: (ask) => (ask.know || ask.intro ? 'Omar' : undefined) })
    await connect(A, L, Ring.Close, Ring.Friend)
    await connect(L, O, Ring.Close, Ring.Close)
    // The record's people for the connections (the app keeps one Person per peer).
    A.state.people.push({ id: 'p-lena', name: 'Lena', context: '', ring: Ring.Close, metAt: 1, lines: [], peerId: A.state.peers[0].id })
    L.state.people.push({ id: 'p-omar', name: 'Omar', context: '', ring: Ring.Close, metAt: 1, lines: [], peerId: L.state.peers.find((x) => x.did === O.did).id })
  })

  it('source 3: Omar says yes: Omar appears outside the rings via Lena, named, with the ask as resource', { timeout: 20000 }, async () => {
    O.share = (ask) => ask.show === 'Anna'
    await A.net.ask('Who has a ladder?', undefined, null, [], { know: true })
    await until(() => beyond(A).length > 0, 10000)
    const o = beyond(A)[0]
    expect(o).toMatchObject({ name: 'Omar', via: 'p-lena', seen: { source: 'ask', resource: 'Who has a ladder?' } })
    expect(o.anonymous).toBeUndefined()
    expect(O.asks.at(-1)).toMatchObject({ show: 'Anna', fromName: 'Lena' })
  })

  it('source 3: Omar says no: a nameless bubble via Lena, the name never left Lena', { timeout: 20000 }, async () => {
    A.state.people = A.state.people.filter((x) => !x.via)
    O.share = () => false
    const results = await A.net.ask('Who has a drill?', undefined, null, [], { know: true })
    await until(() => beyond(A).length > 0, 10000)
    expect(beyond(A)[0]).toMatchObject({ name: '', anonymous: true, via: 'p-lena', seen: { resource: 'Who has a drill?' } })
    expect(JSON.stringify(results)).not.toContain('"who"')
  })

  it('source 2: an intro ask answered by introducing Omar, with his yes', { timeout: 20000 }, async () => {
    A.state.people = A.state.people.filter((x) => !x.via)
    O.share = (ask) => ask.show === 'Anna'
    await A.net.askIntro(A.state.peers[0].id, 'Omar')
    await until(() => beyond(A).length > 0, 10000)
    expect(beyond(A)[0]).toMatchObject({ name: 'Omar', via: 'p-lena', seen: { source: 'intro' } })
  })

  it('askShow: true only on the person\'s yes', { timeout: 20000 }, async () => {
    const omarAtLena = L.state.peers.find((x) => x.did === O.did).id
    O.share = () => true
    expect(await L.net.askShow(omarAtLena, 'Anna', 'Who has a ladder?')).toBe(true)
    O.share = () => false
    expect(await L.net.askShow(omarAtLena, 'Anna', 'Who has a ladder?')).toBe(false)
  })
})
