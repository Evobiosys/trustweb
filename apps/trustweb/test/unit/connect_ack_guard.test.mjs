/**
 * Review 2026-10-19: the cleartext connect-ack (connect_link.ts) is the one wire the relay carries without a seal, and its outer `from`
 * is whatever the sender wrote. Real Nets over an in-memory RelayServer, plus a third identity that forges acks:
 *   - an ack naming a held connection's id (ids are public: every link carries one) must not take that record over or share its card;
 *   - an ack claiming a held connection's DID must not rename or re-id it (the name is told inside the sealed hello).
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { createIdentity } from '../../../demo/src/did.ts'
import { createRelayChannel } from '../../../demo/src/relay.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { encodeForQr } from '../../../demo/src/wire.ts'
import { Net } from '../../src/net.ts'
import { Ring } from '../../src/model.ts'

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

async function phone(name) {
  const state = { v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false, inventory: [] }
  const p = { name, state, connected: [] }
  p.net = new Net({
    state: () => state,
    save: () => {},
    onStatus: () => {},
    onAsk: () => {},
    onPeerConnected: (peer) => { p.connected.push(peer) },
    holdPeer: () => false,
    onPeerConfirmed: () => {},
    ringForNewPeer: () => Ring.Acquaintance,
    onLogChanged: () => {},
    askScope: () => undefined,
    onText: () => {},
    mayPassOnFrom: () => true,
    samePerson: () => false,
  }, { answerWindowMs: 600, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

/** A third party on the same relay that can write any outer `from`. */
async function forger() {
  const identity = createIdentity(relayOrigin + '/relay')
  const channel = createRelayChannel({ relayOrigin })
  await channel.connect(identity)
  raws.push(channel)
  return { identity, channel }
}

const ack = (from, did) => encodeForQr({ v: 1, t: 'connect-ack', from, did })

describe('a forged connect-ack cannot take a held connection over', () => {
  let A, B, M
  beforeAll(async () => {
    A = await phone('Ann')
    B = await phone('Ben')
    M = await forger()
    await A.net.completeConnect({ did: B.did, from: B.state.me }, Ring.Friend)
    await until(() => B.state.peers.some((x) => x.did === A.did))
  })

  it('an ack naming Ben\'s id under another DID adds a separate connection with an id of its own; Ben keeps his DID', async () => {
    const ben = A.state.peers.find((x) => x.did === B.did)
    await M.channel.sendRaw(A.did, ack({ id: ben.id, displayName: 'Mallory' }, M.identity.did))
    await until(() => A.state.peers.some((x) => x.did === M.identity.did))
    const mallory = A.state.peers.find((x) => x.did === M.identity.did)
    expect(mallory.id).not.toBe(ben.id)
    expect(A.state.peers.find((x) => x.id === ben.id).did).toBe(B.did)
    expect(A.connected.map((p) => p.did)).toEqual([M.identity.did])
  })

  it('an ack claiming Ben\'s DID with another name and id leaves Ben\'s record as it is', async () => {
    const before = { ...A.state.peers.find((x) => x.did === B.did) }
    await M.channel.sendRaw(A.did, ack({ id: 'zzz', displayName: 'Mallory' }, B.did))
    // the wire goes through the unsealed path: give the drain a moment, then look
    await sleep(300)
    const ben = A.state.peers.find((x) => x.did === B.did)
    expect(ben.id).toBe(before.id)
    expect(ben.displayName).toBe('Ben')
    expect(A.state.peers.filter((x) => x.did === B.did)).toHaveLength(1)
  })

  it('an ack whose did disagrees with the outer from is ignored', async () => {
    const count = A.state.peers.length
    await M.channel.sendRaw(A.did, ack({ id: randomId(12), displayName: 'Nobody' }, 'did:peer:2.' + randomId(40)))
    await sleep(300)
    expect(A.state.peers.length).toBe(count)
  })
})
