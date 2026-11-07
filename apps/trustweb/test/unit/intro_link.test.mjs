// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33: the dedicated intro link (src/intro_link.ts) and the receiver's intro card, shown even when nothing in the web matches. */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { Net } from '../../src/net.ts'
import { decodeIntroLink, encodeIntroLink, introDraft } from '../../src/intro_link.ts'
import { Ring } from '../../src/model.ts'

const ORIGIN = 'https://app.trustweb.one'

describe('intro link', () => {
  it('round-trips asker, target, why and connect link', () => {
    const link = { by: 'Ada', target: 'Dr. Weiss', why: 'about the grant', connect: 'https://app.trustweb.one/?c=1#k=abc' }
    const url = encodeIntroLink(ORIGIN, link)
    expect(url.startsWith(`${ORIGIN}/#intro=`)).toBe(true)
    expect(decodeIntroLink(new URL(url).hash)).toEqual(link)
  })
  it('why and connect are optional', () => {
    expect(decodeIntroLink(new URL(encodeIntroLink(ORIGIN, { by: 'Ada', target: 'Bo' })).hash)).toEqual({ by: 'Ada', target: 'Bo' })
  })
  it('rejects missing, mangled, oversized payloads and drops a non-http connect link', () => {
    expect(decodeIntroLink('')).toBeNull()
    expect(decodeIntroLink('#intro=!!!')).toBeNull()
    expect(decodeIntroLink('#ev=abc')).toBeNull()
    const bad = (o) => decodeIntroLink('#intro=' + Buffer.from(JSON.stringify(o)).toString('base64url'))
    expect(bad({ by: 'Ada' })).toBeNull()
    expect(bad({ by: '', target: 'x' })).toBeNull()
    expect(bad({ by: 'Ada', target: 'x', connect: 'javascript:alert(1)' })).toEqual({ by: 'Ada', target: 'x' })
    expect(decodeIntroLink('#intro=' + 'a'.repeat(7000))).toBeNull()
  })
  it('the draft names the asker and carries their connect link when there is one', () => {
    expect(introDraft({ by: 'Ada', target: 'Bo', connect: 'https://x/#k' })).toContain('https://x/#k')
    expect(introDraft({ by: 'Ada', target: 'Bo' })).toContain('Ada')
  })
})

describe('an intro ask over the wire reaches the receiver as an intro prompt without any match', () => {
  let relay
  let relayOrigin
  const nets = []
  beforeAll(async () => {
    relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
    const { port } = await relay.listen(0, '127.0.0.1')
    relayOrigin = `http://127.0.0.1:${port}`
  })
  afterAll(async () => { for (const n of nets) n.stop(); await relay.close() })

  async function phone(name) {
    const state = { v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false, inventory: [] }
    const p = { state, prompts: [] }
    p.hooks = {
      state: () => state, save: () => {}, onStatus: () => {}, onAsk: (a) => { p.prompts.push(a) }, onPeerConnected: () => {}, holdPeer: () => false,
      onPeerConfirmed: () => {}, ringForNewPeer: () => Ring.Friend, onLogChanged: () => {}, askScope: () => undefined, onText: () => {},
      mayPassOnFrom: () => true, samePerson: () => false, keepsUnmatched: () => true,
    }
    p.net = new Net(p.hooks, { answerWindowMs: 600, relayOrigin })
    await p.net.start()
    nets.push(p.net)
    p.did = state.identity.did
    return p
  }

  it('shows a prompt carrying the target although nothing matches', async () => {
    const ada = await phone('Ada')
    const bo = await phone('Bo')
    await ada.net.completeConnect({ did: bo.did, from: bo.state.me }, Ring.Friend)
    const t0 = Date.now()
    while (!bo.state.peers.some((x) => x.did === ada.did)) { if (Date.now() - t0 > 8000) throw new Error('no connect'); await new Promise((r) => setTimeout(r, 20)) }
    await ada.net.askIntro(ada.state.peers[0].id, 'Dr. Weiss')
    expect(bo.prompts.length).toBe(1)
    expect(bo.prompts[0]).toMatchObject({ fromName: 'Ada', intro: 'Dr. Weiss', matches: [] })
  })
})
