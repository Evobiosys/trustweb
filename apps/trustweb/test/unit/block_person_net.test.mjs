/** Wave 15: a blocked person's ask is answered like no match (never shown), and nothing is sent to them (two real Nets over an in-memory relay). */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { Net } from '../../src/net.ts'
import { Audience, Ring } from '../../src/model.ts'

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

async function phone(name, items = []) {
  const state = {
    v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false,
    inventory: items.map((it) => ({ id: randomId(8), included: true, createdAt: Date.now(), audience: Audience.FriendsOfFriends, ...it })),
  }
  const p = { state, prompts: [], texts: [] }
  p.net = new Net({
    state: () => state, save: () => {}, onStatus: () => {}, onAsk: (a) => { p.prompts.push(a) }, onPeerConnected: () => {}, holdPeer: () => false,
    onPeerConfirmed: () => {}, ringForNewPeer: () => Ring.Friend, onLogChanged: () => {}, askScope: () => undefined,
    onText: (peer, text) => { p.texts.push(text) }, mayPassOnFrom: () => true, samePerson: () => false, keepsUnmatched: () => true,
    onUnmatchedAsk: () => {}, onLateAnswersReleased: () => {}, mayReask: () => true,
  }, { answerWindowMs: 600, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

describe('end to end: a blocked person', () => {
  it('their ask raises no prompt, nothing is sent to them, and after unblock (0) asks work again', async () => {
    const ada = await phone('Ada', [{ text: 'Spare room in Vienna' }])
    const bo = await phone('Bo')
    await bo.net.completeConnect({ did: ada.did, from: ada.state.me }, Ring.Friend)
    await until(() => ada.state.peers.some((x) => x.did === bo.did))
    const peer = ada.state.peers.find((x) => x.did === bo.did)
    ada.state.people.push({ id: 'bo', name: 'Bo', context: '', ring: Ring.Friend, metAt: 1, lines: [], peerId: peer.id, blocked: Date.now() })
    await bo.net.ask('spare room')
    expect(ada.prompts).toHaveLength(0)
    await expect(ada.net.sendText(peer, 'hello')).rejects.toThrow('blocked')
    ada.state.people[0].blocked = 0
    await bo.net.ask('spare room again')
    await until(() => ada.prompts.length === 1)
    await expect(ada.net.sendText(peer, 'hello')).resolves.toBeUndefined()
  })
})
