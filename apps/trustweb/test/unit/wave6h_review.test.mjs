/**
 * Review 6h (adversarial review + fix of wave 6h): the cases the builder's suite did not reach, end to end with real Net instances over
 * an in-memory RelayServer and a short window (tests only: NetOptions), the same harness as wave6h_querying.test.mjs.
 *   R1  a late yes that waited on the relay while the asker's app was CLOSED shows on the asker's very next open (not one open later)
 *   R2  a yes given before the moment survives the tab being closed right after it: it leaves at the moment, or late after it
 *   R3  a decision taken after the moment, before the (throttled) moment timer ran: the moment's "nothing" still leaves, first, so the
 *       asker never takes the late yes as an answer at the moment (no live timing)
 *   R4  a relay redelivery of a held ask never hides it: exactly one prompt after a reload
 *   R5  who shared at the moment is no longer waited for as a late answer; sentAsks keeps ONE entry per ask
 *   R6  pure rules: the open window, the Signal icon's host, the front door's matcher folds both sides
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { createIdentity, ecdhSharedSecret } from '../../../demo/src/did.ts'
import { createRelayChannel } from '../../../demo/src/relay.ts'
import { deriveEcdhPairKey, randomId } from '../../../demo/src/crypto.ts'
import { encodeForQr } from '../../../demo/src/wire.ts'
import { buildConnectAck } from '../../../demo/src/connect_link.ts'
import { interpret } from '../../../demo/src/gate.ts'
import { Net } from '../../src/net.ts'
import {
  OPEN_CONNECT_MAX_MS, OPEN_DRAIN_GRACE_MS, SENT_ASKS_MAX, addSentAsk, liveSentAsks, openWindowUntil, releaseLateAnswers, sentAskFor, shownLateAnswers,
} from '../../src/late_answers.ts'
import { Audience, Channel, LogOutcome, Ring } from '../../src/model.ts'

const W = 600
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(20)
  }
}
const NOW = Date.UTC(2026, 9, 9, 1)

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

/** One phone. `decide`: 'yes', 'no' or 'wait' (the prompt stays open; p.prompts holds it). */
async function phone(name, items = [], opts = {}) {
  const state = {
    v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false,
    inventory: items.map((it) => ({ id: randomId(8), included: true, createdAt: Date.now(), audience: Audience.FriendsOfFriends, ...it })),
  }
  const p = { name, state, prompts: [], released: 0, decide: opts.decide ?? 'wait' }
  p.hooks = {
    state: () => state,
    save: () => {},
    onStatus: () => {},
    onAsk: (ask) => { p.prompts.push(ask); if (p.decide !== 'wait') void ask.decide(p.decide === 'yes') },
    onPeerConnected: () => {},
    holdPeer: () => false,
    onPeerConfirmed: () => {},
    ringForNewPeer: () => Ring.Friend,
    onLogChanged: () => {},
    askScope: () => undefined,
    onText: () => {},
    mayPassOnFrom: () => true,
    samePerson: () => false,
    keepsUnmatched: () => true,
    onUnmatchedAsk: () => {},
    onLateAnswersReleased: () => { p.released++ },
  }
  p.net = new Net(p.hooks, { answerWindowMs: W, relayOrigin })
  nets.push(p.net)
  await p.net.start()
  p.did = state.identity.did
  return p
}

/** The app is closed: its Net stops (nothing drains for it; the relay keeps what comes). */
function close(p) {
  p.net.stop()
  p.prompts = []
}

/** The app is opened again, in main.ts's order (appOpened): release what is kept, mark the open, start the drain, restore prompts. */
async function open(p) {
  p.net = new Net(p.hooks, { answerWindowMs: W, relayOrigin })
  nets.push(p.net)
  p.state.lateAnswers = releaseLateAnswers(p.state.lateAnswers, Date.now())
  p.net.markOpened()
  await p.net.start()
  await p.net.restoreHeldAsks()
}

async function connect(asker, asked) {
  await asker.net.completeConnect({ did: asked.did, from: asked.state.me }, Ring.Friend)
  await until(() => asked.state.peers.some((x) => x.did === asker.did))
}

/** A bare relay client connected to `target` (it can resend one exact ask, as a relay redelivery would). */
async function rawAsker(name, target) {
  const identity = createIdentity(relayOrigin + '/relay')
  const me = { id: randomId(12), displayName: name }
  const channel = createRelayChannel({ relayOrigin })
  raws.push(channel)
  const key = deriveEcdhPairKey(ecdhSharedSecret(identity, target.did))
  const answers = []
  channel.onRawWire(() => true)
  channel.onEnvelope(async () => key, (env) => { if (env.t === 'answer') answers.push(env) })
  await channel.connect(identity)
  await channel.sendRaw(target.did, encodeForQr(buildConnectAck(me, identity)))
  await until(() => target.state.peers.some((x) => x.did === identity.did))
  return {
    answers, key,
    send: async (q) => channel.send(target.did, { v: 1, t: 'query', from: me, templateId: 'trustweb.ask', templateVersion: 1, ...q }, await key),
  }
}

const sharedOf = (results) => results.flatMap((r) => (r.decoded?.outcome === 'shared' ? r.decoded.shared.items : []))

describe('R1: a late yes while the asker\'s app was closed', () => {
  it('shows on the very next open (it waited on the relay), all at once, and the hook draws it', async () => {
    const ada = await phone('Ada', [{ text: 'Cargo bike to lend' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    await bo.net.ask('cargo bike')
    close(bo) // Bo closes the app after his ask
    await ada.prompts[0].decide(true) // after the moment: a late yes, kept on the relay for Bo
    await until(() => (ada.state.heldAsks ?? []).length === 0)
    expect(bo.state.lateAnswers ?? []).toEqual([])
    await open(bo)
    await until(() => (bo.state.lateAnswers ?? []).length === 1)
    expect(shownLateAnswers(bo.state.lateAnswers, Date.now()).map((a) => a.from)).toEqual(['Ada'])
    expect(bo.released).toBe(1)
  })

  it('one that comes in later during the visit (not handed over with the open) is still held for the next open', async () => {
    const ada = await phone('Ada', [{ text: 'Projector' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    await bo.net.ask('projector')
    // Bo's app stays open; the open window of his start is long over by now in real time (made explicit here)
    bo.net.markOpened(Date.now() - 2 * OPEN_CONNECT_MAX_MS)
    await ada.prompts[0].decide(true)
    await until(() => (bo.state.lateAnswers ?? []).length === 1)
    expect(shownLateAnswers(bo.state.lateAnswers, Date.now())).toEqual([])
  })
})

describe('R2: a yes before the moment, then the tab is closed', () => {
  it('reopened before the moment: the yes leaves AT the moment, as an answer in time (no prompt again)', async () => {
    const ada = await phone('Ada', [{ text: 'Ladder' }])
    const raw = await rawAsker('Bo', ada)
    const windowMs = 4000 // long enough for the close and the reopen to happen well before the moment
    await raw.send({ qid: randomId(12), issuedAt: Date.now(), freeText: 'ladder', answerWindowMs: windowMs })
    await until(() => ada.prompts.length === 1)
    const { deadline } = ada.prompts[0]
    void ada.prompts[0].decide(true)
    expect(ada.state.heldAsks.map((h) => typeof h.yesAt)).toEqual(['number'])
    close(ada) // the tab goes away right after the yes
    await open(ada)
    expect(Date.now()).toBeLessThan(deadline)
    expect(ada.prompts).toEqual([])
    await until(() => raw.answers.length === 1, windowMs + 4000)
    expect(Date.now()).toBeGreaterThanOrEqual(deadline - 50)
    const decoded = await interpret(raw.answers[0], await raw.key)
    expect(decoded.outcome).toBe('shared')
    expect(decoded.shared.items.map((i) => i.text)).toEqual(['Ladder'])
    await until(() => (ada.state.heldAsks ?? []).length === 0)
    await sleep(300)
    expect(raw.answers.length).toBe(1) // once only
  })

  it('reopened after the moment: the moment\'s "nothing" goes first, then the yes as a late answer', async () => {
    const ada = await phone('Ada', [{ text: 'Tent' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    const asking = bo.net.ask('tent')
    await until(() => ada.prompts.length === 1)
    const { deadline } = ada.prompts[0]
    void ada.prompts[0].decide(true)
    close(ada)
    await sleep(deadline - Date.now() + 50)
    await open(ada)
    const results = await asking // Bo still waits (his timeout is longer than the moment): what comes first is the "nothing"
    expect(results.map((r) => r.decoded?.outcome)).toEqual(['nothing'])
    await until(() => (bo.state.lateAnswers ?? []).length === 1)
    expect(bo.state.lateAnswers[0].items.map((i) => i.text)).toEqual(['Tent'])
    expect(shownLateAnswers(bo.state.lateAnswers, Date.now())).toEqual([]) // never live
    await until(() => (ada.state.heldAsks ?? []).length === 0)
  })
})

describe('R3: decided after the moment before its (throttled) timer ran', () => {
  it('the moment\'s "nothing" leaves first; the yes lands as a late answer, never as an answer at the moment', async () => {
    const ada = await phone('Ada', [{ text: 'Sewing machine' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    const asking = bo.net.ask('sewing machine')
    await until(() => ada.prompts.length === 1)
    const prompt = ada.prompts[0]
    await sleep(Math.max(0, prompt.deadline - Date.now() - 40))
    // A background tab: the deadline passes while no timer runs; the person decides in that same turn of the event loop.
    while (Date.now() <= prompt.deadline + 5) { /* busy: the moment timer cannot run */ }
    void prompt.decide(true)
    const results = await asking
    expect(sharedOf(results)).toEqual([]) // the answer at the moment is "nothing"
    expect(results.every((r) => r.decoded?.outcome === 'nothing')).toBe(true)
    await until(() => (bo.state.lateAnswers ?? []).length === 1)
    expect(ada.state.log[0]).toMatchObject({ outcome: LogOutcome.Shared })
  })

  it('a no in that gap still sends the moment\'s "nothing" (a decline never reads as a phone that was off)', async () => {
    const ada = await phone('Ada', [{ text: 'Drill' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    const asking = bo.net.ask('drill')
    await until(() => ada.prompts.length === 1)
    const prompt = ada.prompts[0]
    await sleep(Math.max(0, prompt.deadline - Date.now() - 40))
    while (Date.now() <= prompt.deadline + 5) { /* busy */ }
    void prompt.decide(false)
    const results = await asking
    expect(results.map((r) => r.decoded?.outcome)).toEqual(['nothing'])
  })
})

describe('R4: a relay redelivery of a held ask', () => {
  it('after a reload the prompt shows exactly once, whichever comes first (the restore or the redelivery)', async () => {
    const ada = await phone('Ada', [{ text: 'Electric drill' }])
    const raw = await rawAsker('Bo', ada)
    const ask = { qid: randomId(12), issuedAt: Date.now(), freeText: 'drill', answerWindowMs: W * 4 }
    await raw.send(ask)
    await until(() => ada.prompts.length === 1)
    close(ada)
    await raw.send(ask) // the same ask again, queued for her while the tab is closed (a redelivery)
    await open(ada)
    await sleep(300)
    expect(ada.prompts.length).toBe(1)
    expect(ada.prompts[0]).toMatchObject({ qid: ask.qid, text: 'drill' })
  })
})

describe('R5: the asker remembers each ask once', () => {
  it('who shared at the moment is no longer waited for', async () => {
    const ada = await phone('Ada', [{ text: 'Camera' }], { decide: 'yes' })
    const bo = await phone('Bo')
    await connect(bo, ada)
    const results = await bo.net.ask('camera')
    expect(sharedOf(results).map((i) => i.text)).toEqual(['Camera'])
    const adaId = bo.state.peers.find((p) => p.did === ada.did).id
    expect((bo.state.sentAsks ?? []).some((a) => a.to.some((t) => t.peerId === adaId))).toBe(false)
  })

  it('one entry per ask, however many connections; bounded; a malformed or older-shaped entry is dropped', () => {
    const to = Array.from({ length: 60 }, (_, i) => ({ peerId: `p${i}`, qid: `q${i}` }))
    let list = []
    for (let i = 0; i < SENT_ASKS_MAX + 10; i++) list = addSentAsk(list, { id: `r${i}`, text: 'x'.repeat(400), at: NOW + i, to }, NOW + i)
    expect(list.length).toBe(SENT_ASKS_MAX)
    expect(list[0].text.length).toBe(300)
    expect(sentAskFor(list, 'q59', 'p59', NOW + SENT_ASKS_MAX)).toMatchObject({ qid: 'q59', peerId: 'p59' })
    expect(addSentAsk([], { id: 'r', text: 'x', at: NOW, to: [] }, NOW)).toEqual([])
    expect(liveSentAsks([{ qid: 'q', peerId: 'p', text: 't', at: NOW }, { id: 'r', text: 't', at: NOW, to: [{ peerId: 1 }] }, null, 'x'], NOW)).toEqual([])
  })
})

describe('R6: pure rules', () => {
  it('the open window: the relay hand-over right after an open counts; a connect long after the open does not', () => {
    expect(openWindowUntil(NOW, NOW + 800)).toBe(NOW + 800 + OPEN_DRAIN_GRACE_MS)
    expect(openWindowUntil(NOW, NOW + OPEN_CONNECT_MAX_MS + 1)).toBe(0)
    expect(openWindowUntil(NOW, NOW - 1)).toBe(0)
  })

  it('the Signal icon opens signal.me only', async () => {
    const { signalReachable } = await import('../../src/contact_share.ts')
    expect(signalReachable({ theirChannels: { [Channel.Signal]: 'https://signal.me/#eu/abc' } })?.link).toBe('https://signal.me/#eu/abc')
    expect(signalReachable({ channels: { [Channel.Signal]: 'https://example.com/#eu/abc' } })).toBeNull()
    expect(signalReachable({ theirChannels: { [Channel.Signal]: 'https://signal.me.example.com/x' } })).toBeNull()
  })

  it('the front door folds both sides like the phone: "Café" asked, "café" written', async () => {
    const { matchAsk } = await import('../../../../services/trustweb-peer/peer.ts')
    const { matchAsk: phoneMatch } = await import('../../src/net.ts')
    const { lineThread } = await import('../../src/model.ts')
    const threads = [lineThread('Ada', 'inv:1', 'Ein Tisch im Café für Treffen', 'My Resources', NOW)]
    expect(matchAsk('Café', threads).hits.length).toBe(1)
    expect(phoneMatch('Café', threads).hits.length).toBe(1)
    expect(matchAsk('cafe', threads).hits.length).toBe(1)
  })
})
