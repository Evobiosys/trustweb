// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-invite-link, wired (harness copied from handshake_net.test.mjs). Below: the original header.
 * Wave 44 handshake-crypto, wired: two real Nets over an in-memory RelayServer whose queue store is tapped (what the relay operator holds),
 * plus a third identity that writes raw wires. Fake names only.
 *   - QR connect: the relay holds only ciphertext (no name, no id), both sides mark the connection handshake 'qr';
 *   - a QR of an app before v2 (no k=) is refused before anything is added, with the notice hook;
 *   - a tampered sealed ack, a replayed one and a cleartext ack are refused on the shower: no peer added, a log line, the notice hook.
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { deserializeIdentity, signBytes, verifyDidSignature } from '../../../demo/src/did.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { connectLinkOf } from '../../src/add_by_code.ts'
import { Net } from '../../src/net.ts'
import { Ring } from '../../src/model.ts'
import { addInvite, createInvite, redeemInvite } from '../../src/invite_policy.ts'

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

beforeAll(async () => {
  tap = new TapStore()
  relay = new RelayServer({ queueStore: tap })
  const { port } = await relay.listen(0, '127.0.0.1')
  relayOrigin = `http://127.0.0.1:${port}`
})
afterAll(async () => {
  for (const n of nets) n.stop()
  await relay.close()
})

async function phone(name) {
  const state = { v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false, inventory: [] }
  const p = { name, state, connected: [], refused: [], joined: [], invites: [] }
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
    inviteVerdict: (inv, fromDid) => {
      const r = redeemInvite(p.invites, inv, { myDid: state.identity.did, fromDid, now: Date.now(), verify: (b, s) => verifyDidSignature(state.identity.did, b, s) })
      p.invites = r.ledger
      if (!r.ok) p.refused.push('invite:' + r.reason)
      return r.ok
    },
    onInviteAccepted: (peer, inv) => { p.joined.push({ did: peer.did, inv }) },
  }, { answerWindowMs: 600, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}


const linkOf = (p) => connectLinkOf(new URL(p.net.connectLink('https://app.example/')).search)

function invite(I, kind) {
  const id = deserializeIdentity(I.state.identity)
  const e = createInvite({ kind, tag: 'iyg', label: 'IYG', inviterDid: id.did, inviterName: I.name, id: randomId(16), now: Date.now(), sign: (b) => signBytes(id, b) })
  I.invites = addInvite(I.invites, e)
  return e.tok
}

describe('the invite token rides in the sealed connect-ack', () => {
  it('personal link: first recipient joins (no relay plaintext), a second recipient is refused and not added', async () => {
    const I = await phone('Ina Inviter')
    const A = await phone('Anna First')
    const B = await phone('Ben Second')
    const tok = invite(I, 'personal')
    const before = tap.seen.length
    await A.net.completeConnect(linkOf(I), Ring.Friend, false, tok)
    await until(() => I.joined.length === 1)
    expect(I.joined[0]).toEqual({ did: A.did, inv: tok })
    expect(I.state.peers.some((x) => x.did === A.did)).toBe(true)
    for (const w of tap.seen.slice(before).map((x) => x.wire)) expect(w).not.toContain(tok.slice(0, 24))
    expect(A.state.peers.find((x) => x.did === I.did)).toMatchObject({ inv: tok })
    await B.net.completeConnect(linkOf(I), Ring.Friend, false, tok)
    await until(() => I.refused.length === 1)
    expect(I.refused).toEqual(['invite:used'])
    expect(I.state.peers.some((x) => x.did === B.did)).toBe(false)
    expect(I.joined).toHaveLength(1)
  })

  it('a connect without a token is untouched by the invite hooks', async () => {
    const I = await phone('Ina Two')
    const A = await phone('Anna Plain')
    await A.net.completeConnect(linkOf(I), Ring.Friend)
    await until(() => I.state.peers.some((x) => x.did === A.did))
    expect(I.joined).toEqual([])
    expect(I.refused).toEqual([])
  })
})
