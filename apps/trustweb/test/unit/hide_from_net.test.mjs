// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b hide-from-crypto, wired: real Nets over an in-memory RelayServer (as handshake_net.test.mjs). A asks with reach 2 and hides D;
 * B is A's friend and knows C and D. Honest path: C is asked, D never; the relay sees no DID of D in clear. Tampering B (its sends change
 * the blob): C drops the ask, reports, B's own Net relays the report, A keeps a verified report. Fake names only.
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { Net } from '../../src/net.ts'
import { Audience, Ring } from '../../src/model.ts'

const W = 500
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

async function phone(name, items = []) {
  const state = {
    v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false,
    inventory: items.map((it) => ({ id: randomId(8), included: true, createdAt: Date.now(), audience: Audience.FriendsOfFriends, ...it })),
  }
  const p = { name, state, asks: [], queries: [], reports: [] }
  p.net = new Net({
    state: () => state, save: () => {}, onStatus: () => {},
    onAsk: (ask) => { p.asks.push(ask); void ask.decide(true) },
    onPeerConnected: () => {}, holdPeer: () => false, onPeerConfirmed: () => {}, ringForNewPeer: () => Ring.Friend, onLogChanged: () => {},
    askScope: () => undefined, onText: () => {}, mayPassOnFrom: () => true, samePerson: () => false,
    onHideReport: (e) => { p.reports.push(e) },
  }, { answerWindowMs: W, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  const handle = p.net.handleQuery.bind(p.net)
  p.net.handleQuery = (q, from) => { p.queries.push(q); return handle(q, from) }
  return p
}

async function connect(a, b) {
  await a.net.completeConnect({ did: b.did, from: b.state.me }, Ring.Friend)
  await until(() => b.state.peers.some((x) => x.did === a.did))
  b.state.peers.find((x) => x.did === a.did).ring = Ring.Friend
}

describe('the "Hide from" list travels sealed with the ask', () => {
  it('honest path: the friend-of-friend is asked and answers; the hidden person never receives the ask', async () => {
    const A = await phone('Asker One')
    const B = await phone('Bridge One')
    const C = await phone('Cleo One', [{ text: 'Ladder, 3 m, to lend' }])
    const D = await phone('Dana One', [{ text: 'Ladder, 4 m' }])
    await connect(A, B); await connect(B, C); await connect(B, D)
    A.state.askReach = 2
    const results = await A.net.ask('Who has a ladder?', undefined, null, [D.did])
    const items = results.flatMap((r) => (r.decoded?.outcome === 'shared' ? r.decoded.shared.items : []))
    expect(items.map((i) => i.text)).toEqual(['Ladder, 3 m, to lend'])
    expect(C.queries).toHaveLength(1)
    expect(C.queries[0].hx).toBeTruthy()
    expect(JSON.stringify(C.queries[0])).not.toContain(D.did)
    expect(D.queries).toHaveLength(0)
    expect(A.reports).toEqual([])
    expect(A.state.hideReports ?? []).toEqual([])
  })

  it('tampered mid-hop: the next device drops the ask and reports; the asker gets a verified report (step 2)', async () => {
    const A = await phone('Asker Two')
    const B = await phone('Bridge Two')
    const C = await phone('Cleo Two', [{ text: 'Ladder, 3 m, to lend' }])
    await connect(A, B); await connect(B, C)
    const send = B.net.channel.send.bind(B.net.channel)
    B.net.channel.send = (did, env, key) => {
      if (env.t === 'query' && env.hx) env = { ...env, hx: { ...env.hx, t: env.hx.t.map((l) => [...l.slice(1), 'AAAAAAAAAAAAAAAAAAAAAA']) } }
      return send(did, env, key)
    }
    A.state.askReach = 2
    const results = await A.net.ask('Who has a ladder?', undefined, null, [])
    expect(results.flatMap((r) => (r.decoded?.outcome === 'shared' ? r.decoded.shared.items : []))).toEqual([])
    expect(C.queries).toHaveLength(1)
    expect(C.asks).toHaveLength(0)
    await until(() => A.reports.length === 1)
    expect(A.reports[0]).toMatchObject({ step: 2, why: 'tampered', text: 'Who has a ladder?' })
    expect(A.state.hideReports).toHaveLength(1)
  })

  it('a report nobody can verify (made up by the friend) is ignored', async () => {
    const A = await phone('Asker Three')
    const B = await phone('Bridge Three')
    await connect(A, B)
    A.state.askReach = 2
    let qid = null
    const handle = B.net.handleQuery.bind(B.net)
    B.net.handleQuery = (q, from) => { qid = q.qid; return handle(q, from) }
    const asked = A.net.ask('Anyone with a drill?', undefined, null, [])
    await until(() => qid !== null)
    const rep = { v: 1, r: 'xx', hop: 1, h: 'h', why: 'tampered', d: B.did, n: 'AAAAAAAAAAAAAAAAAAAAAA', at: Date.now(), mac: 'AA', g: 'AA' }
    await B.net.channel.send(A.did, { v: 1, t: 'hide-report', qid, rep }, await B.net.keyFor(A.did))
    await asked
    await sleep(100)
    expect(A.reports).toEqual([])
  })
})
