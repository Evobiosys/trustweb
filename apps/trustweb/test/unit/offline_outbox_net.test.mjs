// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 45 offline-outbox: a send the relay refuses waits in the outbox and goes out on the next flush (two real Nets over an in-memory relay). */
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

async function device(name, meId = randomId(12)) {
  const state = { v: 1, me: { id: meId, displayName: name }, peers: [], people: [], log: [], notificationsOn: false, inventory: [] }
  const p = { state, texts: [], connected: [], queued: [] }
  p.net = new Net({
    state: () => state, save: () => {}, onStatus: () => {}, onQueued: (x) => { p.queued.push(x.id) }, onAsk: () => {}, onPeerConnected: (x) => { p.connected.push(x) }, holdPeer: () => false,
    onPeerConfirmed: () => {}, ringForNewPeer: () => Ring.Friend, onLogChanged: () => {}, askScope: () => undefined,
    onText: (peer, text) => { p.texts.push({ from: peer.id, text }) }, mayPassOnFrom: () => true, samePerson: () => false, keepsUnmatched: () => true,
    onUnmatchedAsk: () => {}, onLateAnswersReleased: () => {}, mayReask: () => true,
  }, { answerWindowMs: 600, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}


describe('Net outbox', () => {
  it('a refused send is queued, kept in the record, toasted once, and delivered by flushOutbox; a chat-thread send (queue false) still throws', async () => {
    const a = await device('Ann')
    const b = await device('Ben')
    await a.net.completeConnect({ did: b.did, from: b.state.me }, Ring.Friend)
    await until(() => b.state.peers.some((x) => x.did === a.did))
    const peer = a.state.peers[0]
    const real = a.net.channel.send.bind(a.net.channel)
    a.net.channel.send = async () => { throw new Error('offline') }
    await expect(a.net.sendText(peer, 'thread', Date.now(), undefined, undefined, false)).rejects.toThrow('offline')
    expect(a.state.sendQueue ?? []).toHaveLength(0)
    await a.net.sendText(peer, 'hello later')
    expect(a.state.sendQueue).toHaveLength(1)
    expect(a.state.sendQueue[0]).toMatchObject({ peerId: peer.id, kind: 'text', state: 'waiting' })
    expect(a.queued).toEqual([peer.id])
    await a.net.flushOutbox() // still offline: backoff, nothing lost
    expect(a.state.sendQueue[0]).toMatchObject({ state: 'waiting', tries: 1 })
    a.net.channel.send = real
    a.state.sendQueue[0].nextAt = 0
    await a.net.flushOutbox()
    expect(a.state.sendQueue[0].state).toBe('sent')
    await until(() => b.texts.some((t) => t.text === 'hello later'))
  })
})
