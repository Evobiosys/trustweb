// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43c sync-devices: my phone can message a person I connected with on my laptop, and their reply reaches both (three real Nets over an in-memory relay). */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { Net } from '../../src/net.ts'
import { Ring } from '../../src/model.ts'
import { syncPeer } from '../../src/sync_core.ts'

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
  const p = { state, texts: [], connected: [] }
  p.net = new Net({
    state: () => state, save: () => {}, onStatus: () => {}, onAsk: () => {}, onPeerConnected: (x) => { p.connected.push(x) }, holdPeer: () => false,
    onPeerConfirmed: () => {}, ringForNewPeer: () => Ring.Friend, onLogChanged: () => {}, askScope: () => undefined,
    onText: (peer, text) => { p.texts.push({ from: peer.id, text }) }, mayPassOnFrom: () => true, samePerson: () => false, keepsUnmatched: () => true,
    onUnmatchedAsk: () => {}, onLateAnswersReleased: () => {}, mayReask: () => true,
  }, { answerWindowMs: 600, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

describe('one person, two devices, one connection', () => {
  it('the laptop tells Other my phone; the phone (with the synced connection) messages Other; Other\'s reply reaches laptop and phone', async () => {
    const laptop = await device('Jakob')
    const phone = await device('Jakob')
    const other = await device('Other')
    await laptop.net.completeConnect({ did: other.did, from: other.state.me }, Ring.Friend)
    await until(() => other.state.peers.some((x) => x.did === laptop.did))
    // what the device sync brings to the phone (sync_core mergePeers)
    const onLaptop = laptop.state.peers.find((x) => x.did === other.did)
    phone.state.peers.push({ ...syncPeer(onLaptop), synced: true, heardAt: onLaptop.connectedAt })

    await laptop.net.tellDevices([phone.did])
    await until(() => other.state.peers.find((x) => x.did === laptop.did)?.alsoDids?.includes(phone.did))
    expect(laptop.state.peers[0].toldDevices).toBe(phone.did)
    // told once per set: a second call sends nothing new
    await laptop.net.tellDevices([phone.did])

    await phone.net.sendText(phone.state.peers[0], 'from the phone')
    await until(() => other.texts.length === 1)
    const meOnOther = other.state.peers.find((x) => x.did === laptop.did)
    expect(other.texts[0]).toEqual({ from: meOnOther.id, text: 'from the phone' })
    expect(other.state.peers).toHaveLength(1)
    expect(other.connected).toHaveLength(1)

    await other.net.sendText(meOnOther, 'reply')
    await until(() => laptop.texts.length === 1 && phone.texts.length === 1)
    expect(phone.texts[0].text).toBe('reply')
  })

  it('a synced connection is never told my devices by the device that only got it by sync', async () => {
    const phone = await device('Jakob')
    const other = await device('Other')
    phone.state.peers.push({ id: 'o', displayName: 'Other', did: other.did, ring: Ring.Friend, connectedAt: 1, synced: true, heardAt: 1 })
    await phone.net.tellDevices(['did:peer:2.' + 'x'.repeat(40)])
    expect(phone.state.peers[0].toldDevices).toBeUndefined()
  })
})
