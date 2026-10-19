/** Wave 16 visitor flow: the host side of a reach-out is unchanged by the visitor's add sheet (two real Nets over an in-memory relay). */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { Net } from '../../src/net.ts'
import { Ring } from '../../src/model.ts'

let relay
let relayOrigin
const nets = []
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(20)
  }
}
beforeAll(async () => {
  relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port } = await relay.listen(0, '127.0.0.1')
  relayOrigin = `http://127.0.0.1:${port}`
})
afterAll(async () => {
  for (const n of nets) n.stop()
  await relay.close()
})

async function phone(name) {
  const state = { v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], inventory: [], log: [], notificationsOn: false }
  const p = { state, connected: [] }
  p.net = new Net({
    state: () => state, save: () => {}, onStatus: () => {}, onAsk: () => {}, onPeerConnected: (peer) => { p.connected.push(peer) }, holdPeer: () => false,
    onPeerConfirmed: () => {}, ringForNewPeer: () => Ring.Acquaintance, onLogChanged: () => {}, askScope: () => undefined,
    onText: () => {}, mayPassOnFrom: () => true, samePerson: () => false, keepsUnmatched: () => true,
    onUnmatchedAsk: () => {}, onLateAnswersReleased: () => {}, mayReask: () => true, refuseReachOut: () => false,
  }, { answerWindowMs: 600, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

describe('visitor flow: the host side of a reach-out', () => {
  it('nothing reaches the host before Add; after Add (any ring picked) it arrives as a reach-out on the intending ring', async () => {
    const host = await phone('Jakob')
    const visitor = await phone('Vera')
    await sleep(300)
    expect(host.connected).toHaveLength(0)
    await visitor.net.completeConnect({ did: host.did, from: host.state.me }, Ring.Friend, true)
    await until(() => host.connected.length === 1)
    expect(host.connected[0]).toMatchObject({ did: visitor.did, ring: Ring.Intending, reachOut: true })
    expect(visitor.state.peers[0]).toMatchObject({ did: host.did, ring: Ring.Friend, reachOut: true })
  })
})
