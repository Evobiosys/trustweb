// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-ask-escalation: asked names and the know-someone round end to end in net.ts (same harness as hops_net.test.mjs). */
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
  const p = { name, state, asks, note: opts.note, passOn: opts.passOn ?? (() => true), share: opts.share ?? (() => true), samePerson: opts.samePerson ?? (() => false) }
  p.net = new Net({
    state: () => state,
    save: () => {},
    onStatus: () => {},
    onAsk: (ask) => { asks.push(ask); void ask.decide(p.share(ask), p.note?.(ask)) },
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


describe('who was asked, and the second round', () => {
  let A, B, C, D
  beforeAll(async () => {
    A = await phone('Ann')
    B = await phone('Ben', [{ text: 'Ladder, 3 m' }])
    C = await phone('Cleo', [{ text: 'Ladder, 2 m' }], { note: () => '  Ask Dora, dora@example.org  ' })
    D = await phone('Dan', [{ text: 'Ladder, 4 m' }])
    await connect(A, B, Ring.Closest, Ring.Friend)
    await connect(A, C, Ring.Close, Ring.Friend)
    await connect(A, D, Ring.Friend, Ring.Friend)
  })

  it('Closest few and Close see who was asked, a Friend does not', async () => {
    await A.net.ask('Who has a ladder?')
    await until(() => [B, C, D].every((p) => p.asks.length > 0))
    expect(B.asks.at(-1).askedNames.sort()).toEqual(['Ben', 'Cleo', 'Dan'])
    expect(C.asks.at(-1).askedNames).toHaveLength(3)
    expect(D.asks.at(-1).askedNames).toBeUndefined()
  })

  it('the asker can switch it off: nobody sees names', async () => {
    A.state.askShowAsked = false
    const before = B.asks.length
    await A.net.ask('Who has a ladder?')
    await until(() => B.asks.length > before)
    expect(B.asks.at(-1).askedNames).toBeUndefined()
    delete A.state.askShowAsked
  })

  it('know: everybody asked gets the card, a tip comes back as one item, a no stays a plain nothing', async () => {
    const before = [B, C, D].map((p) => p.asks.length)
    D.share = () => false
    B.share = () => false
    const results = await A.net.ask('Who has a drill?', undefined, [C.state.peers[0].id, B.state.peers[0].id, D.state.peers[0].id].length ? undefined : undefined, { know: true })
    expect([B, C, D].map((p, i) => p.asks.length - before[i])).toEqual([1, 1, 1])
    for (const p of [B, C, D]) expect(p.asks.at(-1)).toMatchObject({ know: true, matches: [] })
    const items = sharedOf(results)
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('Ask Dora, dora@example.org')
    expect(results.filter((r) => r.decoded?.outcome !== 'shared')).toHaveLength(2)
  })
})
