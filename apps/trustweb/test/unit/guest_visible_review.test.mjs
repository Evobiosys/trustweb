// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * hotfix guest-visible review (47h F1-F11, 2026-11-26): the link joiner lands in the host's Acquaintance zone and counts against the reach-out budget (F1/F4,
 * real Nets over an in-memory relay), the host is held by did first (F10), only a usable own code travels (F7), the code is the last thing a lean link drops (F8),
 * a guest copy names the original host (F9), the roster goes to who joined (F5), an unticked box sends nothing (F2). Invented names only.
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { connectLinkOf } from '../../src/add_by_code.ts'
import { CHAT_TEXT_MAX } from '../../src/chat.ts'
import { decodeEventLink, encodeEventLink, leanForLink, LINK_LEAN_MAX } from '../../src/event_link.ts'
import { byForLink, hostToReach, ownReachCode } from '../../src/event_reach.ts'
import { rosterAudience } from '../../src/event_roster.ts'
import { fittingInviteText, inviteText } from '../../src/ext/calendar/invitees.ts'
import { Net } from '../../src/net.ts'
import { Ring } from '../../src/model.ts'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting'); await sleep(20) } }
const inviteLen = (link) => inviteText(link, 'Gathering').length
const ORIGIN = 'https://app.trustweb.one'
const DID = 'did:peer:2' + 'z'.repeat(190)
const CODE = 'AbCdEfGhIjKlMnOpQrStUv'

let relay, relayOrigin
const nets = []
beforeAll(async () => {
  relay = new RelayServer({ queueStore: new InMemoryRelayQueueStore() })
  const { port } = await relay.listen(0, '127.0.0.1')
  relayOrigin = `http://127.0.0.1:${port}`
})
afterAll(async () => { for (const n of nets) n.stop(); await relay.close() })

async function phone(name, over = {}) {
  const state = { v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false, inventory: [] }
  const p = { name, state, connected: [], refused: 0 }
  p.net = new Net({
    state: () => state, save: () => {}, onStatus: () => {}, onAsk: () => {},
    onPeerConnected: (peer) => { p.connected.push(peer) }, holdPeer: () => false, onPeerConfirmed: () => {},
    ringForNewPeer: () => Ring.Closest,   // the host's Meet-code placement
    onLogChanged: () => {}, askScope: () => undefined, onText: () => {}, mayPassOnFrom: () => true, samePerson: () => false,
    refuseReachOut: () => { p.refused++; return p.budgetOut === true },
    ...over,
  }, { answerWindowMs: 600, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}
const linkOf = (p) => connectLinkOf(new URL(p.net.connectLink('https://app.example/')).search)

describe('F1 a link joiner lands in the host Acquaintance zone, whatever the host placement is', () => {
  it('a plain scan goes to the placement (Closest); an event-link connect (ev) to Acquaintance', async () => {
    const host = await phone('Hanna')
    const scanner = await phone('Sam')
    const joiner = await phone('Jo')
    await scanner.net.completeConnect(linkOf(host), Ring.Acquaintance)
    await until(() => host.connected.length === 1)
    expect(host.connected[0].ring).toBe(Ring.Closest)
    await joiner.net.completeConnect(linkOf(host), Ring.Acquaintance, false, undefined, true)
    await until(() => host.connected.length === 2)
    expect(host.connected[1].ring).toBe(Ring.Acquaintance)
  })
})

describe('F4 event-link connects count against the reach-out budget (10 an hour, the one shared with reach-outs)', () => {
  it('a refused budget makes no card and no connected peer; a plain scan never asks the budget', async () => {
    const host = await phone('Hanna')
    host.budgetOut = true
    const scanner = await phone('Sam')
    const joiner = await phone('Jo')
    await joiner.net.completeConnect(linkOf(host), Ring.Acquaintance, false, undefined, true)
    await until(() => host.refused === 1)
    await sleep(300)
    expect(host.connected).toHaveLength(0)
    expect(host.state.peers).toHaveLength(0)
    await scanner.net.completeConnect(linkOf(host), Ring.Acquaintance)
    await until(() => host.connected.length === 1)
    expect(host.refused).toBe(1)
  })
})

describe('F10 the held host is matched by did first, alsoDids included', () => {
  const by = { name: 'Ana Example', did: DID, code: CODE }
  it('a connection that lists the did among its other devices counts as held, under any name', () => {
    expect(hostToReach(by, { people: [{ name: 'Someone', peerId: 'q1' }], peers: [{ id: 'q1', did: 'did:main', alsoDids: [DID] }] })).toBeNull()
  })
  it('a link with a did is not held by a same-name card of another did', () => {
    expect(hostToReach(by, { people: [{ name: 'Ana Example', peerId: 'q1' }], peers: [{ id: 'q1', did: 'did:other' }] })).toBe(DID)
  })
})

describe('F7 only a usable own code goes into a link', () => {
  it('a stale code, a code of another device, a malformed code: none', () => {
    expect(ownReachCode({ connectCode: { code: CODE } })).toBe(CODE)
    expect(ownReachCode({ connectCode: { code: CODE, stale: true } })).toBeUndefined()
    expect(ownReachCode({ connectCode: { code: CODE, owner: 'other' } })).toBeUndefined()
    expect(ownReachCode({ connectCode: { code: 'short' } })).toBeUndefined()
    expect(ownReachCode({})).toBeUndefined()
  })
})

describe('F8 the code is the last thing a lean link drops', () => {
  const ev = (extra = {}) => ({ id: 'e1gather', name: 'Gathering', from: '2027-01-08', where: 'Almhaus', createdAt: 1, attended: true, ...extra })
  const by = { name: 'Ana Example', did: DID, code: CODE }
  it('steps 1 to 4 keep the code, the last step drops it', () => {
    for (let l = 1; l <= 4; l++) expect(leanForLink(ev(), by, l).by.code).toBe(CODE)
    expect(leanForLink(ev(), by, LINK_LEAN_MAX).by).toEqual({ name: 'Ana Example' })
  })
  it('property: over generated events the invite fits one chat message or the too-long path (null) is taken, never a throw or an over-long text', () => {
    let seed = 7
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
    const word = (n) => 'w' + 'é'.repeat(rnd(n))
    for (let i = 0; i < 300; i++) {
      const e = ev({ name: word(60), where: word(120), conditions: word(400), organizer: word(200), themes: [word(80), word(80)], hosts: [word(30)] })
      const text = fittingInviteText(e.name, (lean) => { const l = leanForLink(e, { name: word(30), did: DID, code: CODE }, lean); return encodeEventLink(l.ev, ORIGIN, 'peer', l.by) })
      expect(text === null || text.length <= CHAT_TEXT_MAX).toBe(true)
    }
  })
  it('an invite that fitted before the code existed (no code, organizer line dropped) still fits: the last step is exactly that link', () => {
    const e = ev({ conditions: 'c'.repeat(300), organizer: 'o'.repeat(300), themes: ['t'.repeat(100)] })
    const at = (by) => (lean) => { const l = leanForLink(e, by, lean); return encodeEventLink(l.ev, ORIGIN, 'peer', l.by) }
    const before = at({ name: 'Ana' })(4)
    const text = fittingInviteText(e.name, at({ name: 'Ana', did: DID, code: CODE }), inviteLen(before))
    expect(text).not.toBeNull()
    expect(decodeEventLink(text.slice(text.indexOf('#'))).by).toEqual({ name: 'Ana' })
  })
})

describe('F9 a guest copy names the original host, never the forwarder as the host', () => {
  const mine = { name: 'Fia Forwarder', did: 'did:fia', code: 'FfFfFfFfFfFfFfFfFfFfFf' }
  const hostBy = { name: 'Ana Example', did: DID, code: CODE }
  it('a copy that holds the host reach carries it', () => {
    expect(byForLink({ fromLink: true, by: hostBy }, mine)).toEqual(hostBy)
  })
  it('a copy without it names me and carries no code', () => {
    expect(byForLink({ fromLink: true }, mine)).toEqual({ name: 'Fia Forwarder', did: 'did:fia' })
  })
  it('my own event names me with my code', () => {
    expect(byForLink({}, mine)).toEqual(mine)
  })
})

describe('F5 the roster goes to who joined', () => {
  it('an invitee who did not join never hears it', () => {
    const P = (id, over = {}) => ({ id, name: id, ring: 'friend', lines: [], metAt: 0, peerId: 'p' + id, ...over })
    const s = { people: [P('joined', { events: ['e1'] }), P('invitee'), P('other')] }
    expect(rosterAudience(s, { id: 'e1', people: ['invitee', 'joined'] }).map((p) => p.id)).toEqual(['joined'])
  })
})
