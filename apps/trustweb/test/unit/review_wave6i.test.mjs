/**
 * Review 6i (the adversarial review of wave 6i, fixed in the same pass):
 *   R1 a `reask` marker is read only from a connection this phone asked again (reask.ts acceptsReaskFrom): a forged one is an ordinary
 *      ask, logged and carded, and never takes a card away;
 *   R2 a late yes to the FIRST qid still lands after a re-ask (late_answers.ts findSent / forgetSentAsk), and the asked phone drops its
 *      held prompt for the first ask when the earlier one is shown (one ask, one prompt);
 *   R3 a re-ask that was not shown is not remembered as shown, so the Advanced button brings it back once a line matches; a re-ask the
 *      relay refused is undone (reask.ts undoReasked) and costs nothing of the per-ask budget;
 *   R4 the tappable "new message" notice never lies over the consent prompt or an open sheet's controls (card_stack.ts msgNoticePlace).
 * No guest names: Ada and Bo are the suite's own.
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { randomId } from '../../../demo/src/crypto.ts'
import { Net } from '../../src/net.ts'
import { windowFields } from '../../src/ask_window.ts'
import { NoticePlace, msgNoticePlace } from '../../src/card_stack.ts'
import { addSentAsk, askOfQid, forgetSentAsk, sentAskFor } from '../../src/late_answers.ts'
import { liveHeldAsks } from '../../src/held_asks.ts'
import { REASK_ACCEPT_MS, REASKS_PER_ASK, acceptsReaskFrom, noteReasked, reaskCandidates, undoReasked } from '../../src/reask.ts'
import { Audience, LogOutcome, Ring } from '../../src/model.ts'

const W = 600
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 9, 12)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(20)
  }
}

describe('R1 reask.ts acceptsReaskFrom', () => {
  it('reads a marker only within REASK_ACCEPT_MS of an ask-again this phone sent; never without one, never from the future', () => {
    expect(acceptsReaskFrom(undefined, NOW)).toBe(false)
    expect(acceptsReaskFrom('yesterday', NOW)).toBe(false)
    expect(acceptsReaskFrom(Number.NaN, NOW)).toBe(false)
    expect(acceptsReaskFrom(NOW - 1000, NOW)).toBe(true)
    expect(acceptsReaskFrom(NOW - REASK_ACCEPT_MS, NOW)).toBe(true)
    expect(acceptsReaskFrom(NOW - REASK_ACCEPT_MS - 1, NOW)).toBe(false)
    expect(acceptsReaskFrom(NOW + DAY, NOW)).toBe(false)
  })
})

describe('R2/R3 late_answers.ts and reask.ts: the first qid after a re-ask, and an undone re-ask', () => {
  const ask = { id: 'A1', text: 'spare room', at: NOW - DAY, to: [{ peerId: 'pA', qid: 'Q1' }, { peerId: 'pC', qid: 'Q9' }] }
  it('after a re-ask, a late yes to the first qid still finds the ask, and forgetting it by that qid forgets the connection', () => {
    let list = addSentAsk([], ask, NOW)
    list = noteReasked(list, 'A1', 'pA', 'Q2', NOW)
    expect(sentAskFor(list, 'Q2', 'pA', NOW)).toMatchObject({ qid: 'Q2', earlier: true, text: 'spare room' })
    expect(sentAskFor(list, 'Q1', 'pA', NOW)).toMatchObject({ qid: 'Q2', earlier: true })
    // another connection's qid never answers for this one
    expect(sentAskFor(list, 'Q1', 'pC', NOW)).toBeUndefined()
    expect(askOfQid(list, 'Q1', 'pA', NOW)).toEqual({ text: 'spare room', at: NOW - DAY })
    list = forgetSentAsk(list, 'Q1', NOW)
    expect(list[0].to.map((x) => x.peerId)).toEqual(['pC'])
  })
  it('a re-ask the relay refused is undone: the first qid again, no re-ask counted, still a candidate', () => {
    let list = addSentAsk([], ask, NOW)
    const [plan] = reaskCandidates(list, 'pA', NOW)
    expect(plan.prev).toEqual({ peerId: 'pA', qid: 'Q1' })
    list = noteReasked(list, 'A1', 'pA', 'Q2', NOW)
    list = undoReasked(list, 'A1', 'pA', plan.prev, NOW)
    expect(list[0].to).toEqual(ask.to)
    expect(reaskCandidates(list, 'pA', NOW)).toHaveLength(1)
    // the budget still holds for sends that left
    for (let i = 0; i < REASKS_PER_ASK; i++) list = noteReasked(list, 'A1', 'pA', 'Qx' + i, NOW)
    expect(reaskCandidates(list, 'pA', NOW)).toEqual([])
  })
})

describe('R4 card_stack.ts msgNoticePlace', () => {
  it('never over the consent prompt; over a sheet in the top strip; else above the tab bar', () => {
    expect(msgNoticePlace(true, false)).toBe(NoticePlace.None)
    expect(msgNoticePlace(true, true)).toBe(NoticePlace.None)
    expect(msgNoticePlace(false, true)).toBe(NoticePlace.Top)
    expect(msgNoticePlace(false, false)).toBe(NoticePlace.Bottom)
  })
})

// --- end to end over a real relay, with real Net instances (the same harness as wave6i_conversation.test.mjs) ---

let relay
let relayOrigin
const nets = []

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
  const p = { name, state, prompts: [], unmatched: 0, sends: [], refuse: null }
  p.hooks = {
    state: () => state,
    save: () => {},
    onStatus: () => {},
    onAsk: (ask) => { p.prompts.push(ask) },
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
    onUnmatchedAsk: () => { p.unmatched++ },
    onLateAnswersReleased: () => {},
    mayReask: () => true,
  }
  p.net = new Net(p.hooks, { answerWindowMs: W, relayOrigin })
  await p.net.start()
  const channel = p.net.channel
  const send = channel.send.bind(channel)
  channel.send = (to, env, key) => {
    if (p.refuse && p.refuse(env)) return Promise.reject(new Error('relay refused'))
    p.sends.push(env.t)
    return send(to, env, key)
  }
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

async function connect(asker, asked, ringAtAsked) {
  await asker.net.completeConnect({ did: asked.did, from: asked.state.me }, Ring.Friend)
  await until(() => asked.state.peers.some((x) => x.did === asker.did))
  asked.state.peers.find((x) => x.did === asker.did).ring = ringAtAsked
}
const peerOn = (holder, other) => holder.state.peers.find((x) => x.did === other.did)
/** Bo's phone sends an ask marked as earlier on its own, without any ask-again from Ada (a forged marker). */
const forged = (bo, ada, text, originalQid) =>
  bo.net.sendAsk(peerOn(bo, ada), text, { direct: true, reask: { originalQid, originalAt: Date.now() - DAY }, ...windowFields(W) }, 3 * W)

describe('R1 end to end: a forged `reask` marker hides nothing', () => {
  it('a marked ask from a connection Ada never asked again is an ordinary ask: logged, carded, its earlier card kept', async () => {
    const ada = await phone('Ada', [{ text: 'Cargo bike', audience: Audience.Close }])
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Acquaintance)
    await bo.net.ask('cargo bike')
    await until(() => ada.unmatched === 1)
    const firstQid = ada.state.unmatchedAsks[0].id
    const rows = ada.state.log.length
    await forged(bo, ada, 'cargo bike please', firstQid)
    await until(() => ada.unmatched === 2)
    expect(ada.state.log.length).toBe(rows + 1)
    expect(ada.state.log[0]).toMatchObject({ text: 'cargo bike please', outcome: LogOutcome.NoMatch })
    expect(ada.state.unmatchedAsks.some((a) => a.id === firstQid)).toBe(true)
    expect(ada.state.reaskSeen ?? []).toEqual([])
  })
  it('a forged marker on an ask that matches is shown as a new ask, never as "Earlier ask"', async () => {
    const ada = await phone('Ada', [{ text: 'Ladder' }])
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Friend)
    await forged(bo, ada, 'ladder', 'Qforged000001')
    await until(() => ada.prompts.length === 1)
    expect(ada.prompts[0].earlier).toBeNull()
  })
})

describe('R2/R3 end to end', () => {
  it('a quiet re-ask is not remembered: after a matching line is added, the Advanced button at the same ring brings it as a prompt', async () => {
    const ada = await phone('Ada')
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Friend)
    await bo.net.ask('tandem bike')
    await sleep(2 * W)
    await ada.net.askAgain(peerOn(ada, bo))
    await until(() => bo.sends.filter((t) => t === 'query').length === 2, 10_000)
    await sleep(2 * W)
    expect(ada.prompts).toHaveLength(0)
    ada.state.inventory.push({ id: randomId(8), text: 'Tandem bike', included: true, createdAt: Date.now(), audience: Audience.Friends })
    bo.net.askAgainAt.clear() // Bo's own per-minute guard; a test does not wait a minute
    await ada.net.askAgain(peerOn(ada, bo))
    await until(() => ada.prompts.length === 1, 10_000)
    expect(ada.prompts[0].earlier).not.toBeNull()
  })

  it('the earlier prompt replaces the held prompt of the first ask on the asked phone', async () => {
    const ada = await phone('Ada', [{ text: 'Spare room in Vienna' }])
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Acquaintance)
    await bo.net.ask('spare room')
    await until(() => ada.prompts.length === 1)
    const firstQid = ada.prompts[0].qid
    expect(liveHeldAsks(ada.state.heldAsks, Date.now()).map((h) => h.qid)).toEqual([firstQid])
    await sleep(2 * W) // Bo stopped waiting; the prompt is held on Ada's phone
    peerOn(ada, bo).ring = Ring.Friend
    await ada.net.askAgain(peerOn(ada, bo))
    await until(() => ada.prompts.length === 2, 10_000)
    expect(ada.prompts[1].earlier).not.toBeNull()
    const held = liveHeldAsks(ada.state.heldAsks, Date.now()).map((h) => h.qid)
    expect(held).not.toContain(firstQid)
    expect(held).toContain(ada.prompts[1].qid)
  })

  it('a re-ask the relay refuses is undone on the asker\'s phone', async () => {
    const ada = await phone('Ada')
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Acquaintance)
    await bo.net.ask('drill')
    await sleep(2 * W)
    const before = structuredClone(bo.state.sentAsks[0].to)
    bo.refuse = (env) => env.t === 'query'
    peerOn(ada, bo).ring = Ring.Friend
    await ada.net.askAgain(peerOn(ada, bo))
    await until(() => !bo.net.reasking.has(peerOn(bo, ada).id) && bo.net.askAgainAt.size === 1, 10_000)
    await sleep(W)
    expect(bo.state.sentAsks[0].to).toEqual(before)
  })
})
