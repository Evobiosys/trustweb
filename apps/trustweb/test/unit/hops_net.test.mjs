/**
 * Wave 6 (U1): the hop protocol end to end in net.ts, with real Net instances
 * (the class the app runs) over an in-memory RelayServer, a short answer
 * window (tests only: NetOptions) and no browser. Covers what the 3-phone
 * Playwright run cannot cover quickly: the friend-of-friend answer "through
 * B", maxHops 1, B's "pass their asks on" off, the answer moment not
 * revealing whether anything was passed on, cycles, the same ask by two
 * paths, a direct ask, and an old-build ask without the new fields.
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { createIdentity, ecdhSharedSecret } from '../../../demo/src/did.ts'
import { createRelayChannel } from '../../../demo/src/relay.ts'
import { deriveEcdhPairKey, randomId } from '../../../demo/src/crypto.ts'
import { encodeForQr } from '../../../demo/src/wire.ts'
import { buildConnectAck } from '../../../demo/src/connect_link.ts'
import { interpret } from '../../../demo/src/gate.ts'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Net } from '../../src/net.ts'
import { Audience, LogOutcome, Ring } from '../../src/model.ts'
import { passOnAllowed, samePersonTarget } from '../../src/one_jakob.ts'
import { startPeer } from '../../../../services/trustweb-peer/peer.ts'

const W = 600
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

/**
 * One phone: its record, the Net the app runs, and the person at it:
 * `share(ask)` says whether they tap "Share these" (default: yes).
 */
async function phone(name, items = [], opts = {}) {
  const state = {
    v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false,
    inventory: items.map((it) => ({ id: randomId(8), included: true, createdAt: Date.now(), audience: Audience.FriendsOfFriends, ...it })),
    ...opts.state,
  }
  const asks = []
  const p = { name, state, asks, passOn: opts.passOn ?? (() => true), share: opts.share ?? (() => true), samePerson: opts.samePerson ?? (() => false) }
  p.net = new Net({
    state: () => state,
    save: () => {},
    onStatus: () => {},
    onAsk: (ask) => { asks.push(ask); if (p.share(ask) !== null) void ask.decide(p.share(ask)) },
    onPeerConnected: () => {},
    holdPeer: () => false,
    onPeerConfirmed: () => {},
    ringForNewPeer: () => Ring.Friend,
    onLogChanged: () => {},
    askScope: () => undefined,
    onText: () => {},
    mayPassOnFrom: (peer) => p.passOn(peer),
    samePerson: (target, sender) => p.samePerson(target, sender),
  }, { answerWindowMs: W, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

/** Connects two phones both ways (the one-scan ceremony) with the given rings. */
async function connect(a, b, ringOfBAtA = Ring.Friend, ringOfAAtB = Ring.Friend) {
  await a.net.completeConnect({ did: b.did, from: b.state.me }, ringOfBAtA)
  await until(() => b.state.peers.some((x) => x.did === a.did))
  b.state.peers.find((x) => x.did === a.did).ring = ringOfAAtB
}

const sharedOf = (results) => results.flatMap((r) => (r.decoded?.outcome === 'shared' ? r.decoded.shared.items : []))

describe('three phones: A asks, C\'s line comes back "through B"', () => {
  let A, B, C
  beforeAll(async () => {
    A = await phone('Ann')
    B = await phone('Ben')
    C = await phone('Cleo', [{ text: 'Ladder, 3 m, to lend' }, { text: 'Ladder for close friends only', audience: Audience.Close }])
    await connect(A, B)
    await connect(B, C, Ring.Friend, Ring.Acquaintance)
  })

  it('maxHops 2: C\'s acquaintances line (one degree onward) comes back through B; C was asked as "Ann, through Ben"', async () => {
    A.state.askReach = 2
    const t0 = Date.now()
    const results = await A.net.ask('Who has a ladder?')
    const items = sharedOf(results)
    expect(items.map((i) => i.text)).toEqual(['Ladder, 3 m, to lend'])
    expect(items[0].via).toEqual(['Ben'])
    expect(results[0].decoded.shared.from).toBe('Ben')
    // the answer comes at B's fixed moment (two windows), not before
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2 * W - 50)
    const atC = C.asks.at(-1)
    expect(atC.fromName).toBe('Ann')
    expect(atC.through).toEqual(['Ben'])
    expect(atC.relayed).toBe(false)
    expect(atC.matches.map((m) => m.text)).toEqual(['Ladder, 3 m, to lend'])
    // B's log says it passed the ask on and one line came back; B was never shown C's line
    await until(() => B.state.log[0]?.passedOn === 1)
    expect(B.state.log[0]).toMatchObject({ outcome: LogOutcome.NoMatch, passedOn: 1, cameBack: 1 })
    expect(B.asks.length).toBe(0)
  })

  it('maxHops 1 (the default): C is never asked, nothing comes back, the ask is the one of the build before', async () => {
    delete A.state.askReach
    const before = C.asks.length
    const results = await A.net.ask('Who has a ladder?')
    expect(sharedOf(results)).toEqual([])
    expect(C.asks.length).toBe(before)
  })

  it('B\'s "pass their asks on" off: nothing comes back, and the answer arrives at the same moment as with it on', async () => {
    A.state.askReach = 2
    const t0 = Date.now()
    await A.net.ask('Who has a ladder?')
    const withPassOn = Date.now() - t0
    B.passOn = () => false
    const before = C.asks.length
    const t1 = Date.now()
    const results = await A.net.ask('Who has a ladder?')
    const without = Date.now() - t1
    expect(sharedOf(results)).toEqual([])
    expect(C.asks.length).toBe(before)
    expect(Math.abs(without - withPassOn)).toBeLessThan(W / 2)
    B.passOn = () => true
  })

  it('C declines: the same nothing, at the same moment', async () => {
    C.share = () => false
    const t0 = Date.now()
    const results = await A.net.ask('Who has a ladder?')
    expect(sharedOf(results)).toEqual([])
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2 * W - 50)
    C.share = () => true
  })

  it('"Ask only my direct contacts" wins over any reach: nothing is passed on', async () => {
    A.state.askReach = 3
    A.state.askDirectOnly = true
    const before = C.asks.length
    const results = await A.net.ask('Who has a ladder?')
    expect(sharedOf(results)).toEqual([])
    expect(C.asks.length).toBe(before)
    delete A.state.askDirectOnly
  })
})

describe('cycles and two paths', () => {
  it('a triangle A-B-C asked with reach 3: A is never asked its own question, C answers once', async () => {
    const A = await phone('Ann')
    const B = await phone('Ben')
    const C = await phone('Cleo', [{ text: 'Tent for four people' }])
    await connect(A, B)
    await connect(B, C)
    await connect(C, A)
    A.state.askReach = 3
    const results = await A.net.ask('Anyone with a tent?')
    await sleep(W)
    expect(A.asks.length).toBe(0)
    expect(C.asks.length).toBe(1)
    const items = sharedOf(results)
    // directly from C, and C never answers the same ask twice (the copy through B is silent)
    expect(items.filter((i) => i.text === 'Tent for four people').length).toBe(1)
    expect(items[0].via).toBeUndefined()
  })
})

describe('older builds', () => {
  it('an ask without the new fields: answered at one window, never passed on', async () => {
    const B = await phone('Ben')
    const C = await phone('Cleo', [{ text: 'Ladder, 3 m, to lend' }])
    await connect(B, C)
    // a raw old-build phone: the envelope it sends has no hop field
    const identity = createIdentity(relayOrigin + '/relay')
    const me = { id: randomId(12), displayName: 'Olga' }
    const channel = createRelayChannel({ relayOrigin })
    raws.push(channel)
    const key = deriveEcdhPairKey(ecdhSharedSecret(identity, B.did))
    const answers = []
    channel.onRawWire(() => true)
    channel.onEnvelope(async () => key, (env) => { if (env.t === 'answer') answers.push({ env, at: Date.now() }) })
    await channel.connect(identity)
    await channel.sendRaw(B.did, encodeForQr(buildConnectAck(me, identity)))
    await until(() => B.state.peers.some((x) => x.did === identity.did))
    const t0 = Date.now()
    const q = { v: 1, t: 'query', from: me, templateId: 'free', templateVersion: 1, qid: randomId(12), issuedAt: t0, freeText: 'Who has a ladder?' }
    await channel.send(B.did, q, await key)
    await until(() => answers.length === 1)
    expect(answers[0].at - t0).toBeGreaterThanOrEqual(W - 50)
    expect(answers[0].at - t0).toBeLessThan(2 * W)
    expect((await interpret(answers[0].env, await key)).outcome).toBe('nothing')
    expect(C.asks.length).toBe(0)
  })
})

describe('liveness: one contact that never answers (a send that hangs) costs only its line', () => {
  it('B still answers at its moment with what the others shared', async () => {
    const A = await phone('Ann')
    const B = await phone('Ben')
    const C = await phone('Cleo', [{ text: 'Ladder, 3 m, to lend' }])
    const D = await phone('Dora')
    await connect(A, B)
    await connect(B, C)
    await connect(B, D)
    // Every send from B to Dora hangs forever (relay ingress has no timeout of its own).
    const channel = B.net.channel
    const send = channel.send.bind(channel)
    channel.send = (did, env, key) => (did === D.did ? new Promise(() => {}) : send(did, env, key))
    A.state.askReach = 2
    const t0 = Date.now()
    const results = await A.net.ask('Who has a ladder?')
    const ms = Date.now() - t0
    expect(sharedOf(results).map((i) => i.text)).toEqual(['Ladder, 3 m, to lend'])
    expect(ms).toBeGreaterThanOrEqual(2 * W - 50)
    expect(ms).toBeLessThan(3 * W)
    channel.send = send
  })
})

describe('through Jakob: a demo account asks his front door, his phone passes it on to his friend (real peer, real Nets)', () => {
  it('the friend sees "Anna-demo asks, through Jakob"; Anna gets the line marked "through Jakob"; his own door is never asked again', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-hops-door-'))
    const inv = path.join(dir, 'inv.json')
    writeFileSync(inv, JSON.stringify({ items: [{ text: 'Equal Earth map projection for global maps', audience: 'fof', preset: { by: 'Jakob', at: '2026-10-07' } }] }))
    const doorLog = []
    const door = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, claim: true, answerWindowMs: W, forwardWaitMs: 900, log: (l) => doorLog.push(l) })
    let J
    J = await phone('Jakob', [], {
      passOn: (peer) => passOnAllowed(J.state, peer, door.card.did),
      samePerson: (target, sender) => samePersonTarget(J.state, target, sender, door.card.did),
    })
    await J.net.completeConnect({ did: door.card.did, from: { id: door.card.id, displayName: door.card.name } }, Ring.Acquaintance)
    for (let i = 0; i < 100 && !door.status().owner; i++) await sleep(20)
    expect(door.status().owner).toBe(true)
    const F = await phone('Fritz', [{ text: 'Ladder, 3 m, to lend' }])
    await connect(J, F)
    const anna = await phone('Anna-demo')
    await anna.net.completeConnect({ did: door.card.did, from: { id: door.card.id, displayName: door.card.name } }, Ring.Acquaintance)
    await until(() => door.peerCount() === 1)
    anna.state.askReach = 2

    const results = await anna.net.ask('Who has a ladder?')
    const items = sharedOf(results)
    expect(items.map((i) => i.text)).toEqual(['Ladder, 3 m, to lend'])
    expect(items[0].via).toEqual(['Jakob'])
    const atF = F.asks.at(-1)
    expect(atF.fromName).toBe('Anna-demo')
    expect(atF.through).toEqual(['Jakob'])
    expect(atF.relayed).toBe(false)
    expect(J.asks.length).toBe(0)

    // Fritz asks through Jakob: Jakob's phone never passes it to his own front door (it would answer with his public lines "through Jakob").
    const asksAtDoor = doorLog.filter((l) => /^ask /.test(l)).length
    F.state.askReach = 2
    await F.net.ask('Which map projection do you use?')
    await sleep(W)
    expect(doorLog.filter((l) => /^ask /.test(l)).length).toBe(asksAtDoor)
    await door.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 30_000)
})

describe('forgiving matching on the REAL ask path (wave 6 U2 hook): a phone and a front door read an ask against their own lines', () => {
  const ASKS = [
    // [what the holder wrote, what the asker typed]
    ['Communityhof Nord: shared garden and workshop', 'Who knows a Community hof?'],
    ['Community hof Süd: open evenings for newcomers', 'Communityhof'],
    ['Bicycle repair stand in the courtyard', 'Who has bicycles?'],
    ['Bike pump and tools to lend', 'Does anyone have a bicycle?'],
    ['Tax advisor for small associations, first hour free', 'I need an accountant'],
    ['Steuerberater für kleine Vereine', 'accountant'],
  ]

  it('a Net answers each ask from the holder\'s line (the asker\'s "Communityhof" vs "Community hof", bicycles, accountant)', async () => {
    for (const [line, ask] of ASKS) {
      const holder = await phone('Holder', [{ text: line }])
      const asker = await phone('Asker')
      await connect(asker, holder)
      const results = await asker.net.ask(ask)
      expect(sharedOf(results).map((i) => i.text), `${ask} -> ${line}`).toEqual([line])
      expect(holder.asks.at(-1).matches.map((m) => m.text)).toEqual([line])
    }
  }, 30_000)

  it('a Net does not answer an ask that means something else (the widening is forgiving, not loose)', async () => {
    const holder = await phone('Holder', [{ text: 'Community garden plot, 10 m2' }, { text: 'Bicycle repair stand in the courtyard' }])
    const asker = await phone('Asker')
    await connect(asker, holder)
    expect(sharedOf(await asker.net.ask('Who has a piano?'))).toEqual([])
  })

  it('a front door (startPeer, preset lines) answers the same asks', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tw-forgiving-door-'))
    const inv = path.join(dir, 'inv.json')
    const preset = { by: 'Jakob', at: '2026-10-07' }
    writeFileSync(inv, JSON.stringify({ items: ASKS.map(([text]) => ({ text, audience: 'fof', preset })) }))
    const door = await startPeer({ stateDir: path.join(dir, 'state'), inventoryFile: inv, relayOrigin, healthPort: 0, answerWindowMs: W, forwardWaitMs: 900, log: () => {} })
    const asker = await phone('Anna-demo')
    await asker.net.completeConnect({ did: door.card.did, from: { id: door.card.id, displayName: door.card.name } }, Ring.Acquaintance)
    await until(() => door.peerCount() === 1)
    for (const [line, ask] of ASKS) {
      const texts = sharedOf(await asker.net.ask(ask)).map((i) => i.text)
      // the door holds all six lines: two of them say "accountant" (English and German), so either one answers that ask
      const ok = /accountant/.test(ask) ? ASKS.filter(([, a]) => /accountant/.test(a)).map(([l]) => l) : [line]
      expect(texts.some((t) => ok.includes(t)), `${ask} -> ${texts.join(' | ')}`).toBe(true)
    }
    await door.stop()
    rmSync(dir, { recursive: true, force: true })
  }, 60_000)
})
