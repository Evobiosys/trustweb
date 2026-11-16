// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 handshake-crypto, wired: two real Nets over an in-memory RelayServer whose queue store is tapped (what the relay operator holds),
 * plus a third identity that writes raw wires. Fake names only.
 *   - QR connect: the relay holds only ciphertext (no name, no id), both sides mark the connection handshake 'qr';
 *   - a QR of an app before v2 (no k=) is refused before anything is added, with the notice hook;
 *   - a tampered sealed ack, a replayed one and a cleartext ack are refused on the shower: no peer added, a log line, the notice hook.
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { createIdentity, deserializeIdentity } from '../../../demo/src/did.ts'
import { createRelayChannel } from '../../../demo/src/relay.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { encodeForQr } from '../../../demo/src/wire.ts'
import { connectLinkOf } from '../../src/add_by_code.ts'
import { Net } from '../../src/net.ts'
import { Ring } from '../../src/model.ts'
import { HandshakeError, sealConnectAck, qrSecretOf } from '../../src/handshake_crypto.ts'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) {
  const t0 = Date.now()
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(20)
  }
}

class TapStore extends InMemoryRelayQueueStore {
  constructor() { super(); this.seen = [] }
  enqueue(toDid, wire) { this.seen.push({ toDid, wire }); return super.enqueue(toDid, wire) }
}

let relay, relayOrigin, tap
const nets = []
const raws = []

beforeAll(async () => {
  tap = new TapStore()
  relay = new RelayServer({ queueStore: tap })
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
  const p = { name, state, connected: [], refused: [] }
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
    onHandshakeRefused: (reason) => { p.refused.push(reason) },
  }, { answerWindowMs: 600, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

async function forger() {
  const identity = createIdentity(relayOrigin + '/relay')
  const channel = createRelayChannel({ relayOrigin })
  await channel.connect(identity)
  raws.push(channel)
  return { identity, channel }
}

const linkOf = (p) => connectLinkOf(new URL(p.net.connectLink('https://app.example/')).search)

describe('the connect handshake is sealed with the QR key', () => {
  it('QR connect: the relay holds no name and no id; both sides record handshake qr', async () => {
    const A = await phone('Annika Shower')
    const B = await phone('Bertram Scanner')
    const link = linkOf(A)
    expect(link.qk).toBe(qrSecretOf(deserializeIdentity(A.state.identity)))
    const before = tap.seen.length
    await B.net.completeConnect(link, Ring.Friend)
    await until(() => A.state.peers.some((x) => x.did === B.did))
    const wires = tap.seen.slice(before).filter((w) => w.toDid === A.did).map((w) => w.wire)
    expect(wires.length).toBeGreaterThan(0)
    for (const w of wires) {
      expect(w).not.toContain('Bertram')
      expect(w).not.toContain(B.state.me.id)
      expect(w).not.toContain('"connect-ack"')
    }
    expect(A.state.peers.find((x) => x.did === B.did)).toMatchObject({ displayName: 'Bertram Scanner', handshake: 'qr' })
    expect(B.state.peers.find((x) => x.did === A.did)).toMatchObject({ handshake: 'qr' })
    expect(A.refused).toEqual([])
  })

  it('a QR of an app before v2 (no k=) is refused before anything is added', async () => {
    const A = await phone('Old Shower')
    const B = await phone('New Scanner')
    const link = { ...linkOf(A), qk: null }
    const err = await B.net.completeConnect(link, Ring.Friend).catch((e) => e)
    expect(err).toBeInstanceOf(HandshakeError)
    expect(err.reason).toBe('unsupported')
    expect(B.state.peers).toEqual([])
    expect(B.refused).toEqual(['unsupported'])
    expect(B.state.handshakeLog?.[0]).toMatchObject({ reason: 'unsupported' })
  })

  it('a tampered sealed ack, a replay and a cleartext ack are refused on the shower: nothing added, logged, notice', async () => {
    const A = await phone('Shower Three')
    const M = await forger()
    const ack = { v: 1, t: 'connect-ack', from: { id: randomId(12), displayName: 'Mallory' }, did: M.identity.did }
    const good = await sealConnectAck(ack, M.identity, A.did, linkOf(A).qk)
    const w = JSON.parse(good)
    const c = w.c.slice(0, 5) + (w.c[5] === 'A' ? 'B' : 'A') + w.c.slice(6)
    await M.channel.sendRaw(A.did, JSON.stringify({ ...w, c }))
    await until(() => A.refused.length === 1)
    expect(A.refused).toEqual(['tampered'])
    expect(A.state.peers).toEqual([])
    await M.channel.sendRaw(A.did, encodeForQr(ack))
    await until(() => A.refused.length === 2)
    expect(A.refused[1]).toBe('unsupported')
    expect(A.state.peers).toEqual([])
    // the genuine one connects; the same bytes again are a replay and change nothing
    await M.channel.sendRaw(A.did, good)
    await until(() => A.state.peers.length === 1)
    await M.channel.sendRaw(A.did, good)
    await until(() => (A.state.handshakeLog ?? []).some((e) => e.reason === 'replay'))
    expect(A.state.peers).toHaveLength(1)
    expect(A.state.handshakeLog.map((e) => e.reason)).toEqual(['replay', 'unsupported', 'tampered'])
    expect(JSON.stringify(A.state.handshakeLog)).not.toContain('Mallory')
  })
})
