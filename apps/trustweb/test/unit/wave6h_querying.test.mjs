/**
 * Wave 6h, THE ONE THING: a connected person's ask reaches me and I can answer. The pure rules (ask_window, late_answers, held_asks,
 * unmatched_asks, card_stack (6i, was ask_cards), wake_watch, the drain lock's lone tab) and the protocol end to end with real Net instances over an
 * in-memory RelayServer and a short window (tests only: NetOptions): the window travels on the ask, an undecided prompt answers
 * "nothing" at its moment, a later yes lands as a late answer held until the next open (and never from anyone else), a no after the
 * moment sends nothing, a prompt survives a "reload", an ask that arrives after its asker stopped waiting can still be answered late,
 * and the quiet "nothing matched" card for the asked person (with why) while the asker hears the same "nothing".
 */
import { RelayServer } from '../../../../packages/transport/src/relay_server.ts'
import { InMemoryRelayQueueStore } from '../../../../packages/transport/src/relay_queue_store.ts'
import { createIdentity, ecdhSharedSecret } from '../../../demo/src/did.ts'
import { createRelayChannel } from '../../../demo/src/relay.ts'
import { deriveEcdhPairKey, randomId } from '../../../demo/src/crypto.ts'
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { buildConnectAck } from '../../../demo/src/connect_link.ts'
import { interpret } from '../../../demo/src/gate.ts'
import { sealRelayAnswer } from '../../../demo/src/answer_key.ts'
import { Net } from '../../src/net.ts'
import { ANSWER_WINDOW_MS, LEGACY_WINDOW_MS, carriesWindow, passOnWindowFields, receivedWindowMs, windowFields } from '../../src/ask_window.ts'
import { LATE_ANSWERS_MAX, LATE_KEEP_MS, addLateAnswer, addSentAsk, dismissShownLateAnswers, liveLateAnswers, releaseLateAnswers, sentAskFor, shownLateAnswers } from '../../src/late_answers.ts'
import { HELD_ASKS_MAX, addHeldAsk, dropHeldAsk, liveHeldAsks } from '../../src/held_asks.ts'
import { addUnmatchedAsk, dismissUnmatchedAsk, liveUnmatchedAsks, showsUnmatched, unmatchedReason, withOnlyMeOpened } from '../../src/unmatched_asks.ts'
import { StackCardKind, stackCards } from '../../src/card_stack.ts'
import { SLEPT_MS, TICK_MS, watchWake } from '../../src/wake_watch.ts'
import { createDrainLock } from '../../src/drain_lock.ts'
import { Audience, LogOutcome, Ring, UnmatchedReason } from '../../src/model.ts'

const W = 600
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(fn, ms = 8000) {
  const t0 = Date.now()
  while (!(await fn())) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting')
    await sleep(20)
  }
}
const NOW = Date.UTC(2026, 9, 8, 22)

// ---------------------------------------------------------------------------
// pure rules
// ---------------------------------------------------------------------------

describe('the answer window (ask_window.ts)', () => {
  it('is two minutes, carried on the ask; an ask without one keeps the 30 s window of the builds before', () => {
    expect(ANSWER_WINDOW_MS).toBe(120_000)
    expect(LEGACY_WINDOW_MS).toBe(30_000)
    expect(windowFields(ANSWER_WINDOW_MS)).toEqual({ answerWindowMs: 120_000 })
    expect(carriesWindow({ answerWindowMs: 120_000 })).toBe(true)
    expect(carriesWindow({})).toBe(false)
    expect(receivedWindowMs({}, ANSWER_WINDOW_MS)).toBe(30_000)
    expect(receivedWindowMs({ answerWindowMs: 120_000 }, ANSWER_WINDOW_MS)).toBe(120_000)
  })
  it('a received window stays between 30 s and 120 s in production (nobody can make a phone answer at once, nor hold it for ten minutes)', () => {
    expect(receivedWindowMs({ answerWindowMs: 1 }, ANSWER_WINDOW_MS)).toBe(30_000)
    expect(receivedWindowMs({ answerWindowMs: 600_000 }, ANSWER_WINDOW_MS)).toBe(120_000)
    expect(receivedWindowMs({ answerWindowMs: 60_000 }, ANSWER_WINDOW_MS)).toBe(60_000)
    // tests run a short window: the floor goes down with it
    expect(receivedWindowMs({ answerWindowMs: W }, W)).toBe(W)
    expect(receivedWindowMs({}, W)).toBe(W)
  })
  it('a phone passing the ask on copies the window it received under; an ask without one stays without', () => {
    expect(passOnWindowFields({ answerWindowMs: 120_000 }, 120_000)).toEqual({ answerWindowMs: 120_000 })
    expect(passOnWindowFields({}, 30_000)).toEqual({})
  })
})

describe('the wire (apps/demo wire.ts parseQuery)', () => {
  const base = { v: 1, t: 'query', from: { id: 'a', displayName: 'A' }, templateId: 't', templateVersion: 1, qid: 'q1234567', issuedAt: 1 }
  it('keeps a well-formed window, rejects a malformed one, and an ask without one parses as before', () => {
    expect(decodeFromQr(encodeForQr({ ...base, answerWindowMs: 120_000 }))?.answerWindowMs).toBe(120_000)
    expect(decodeFromQr(encodeForQr({ ...base, answerWindowMs: 'soon' }))).toBeNull()
    expect(decodeFromQr(encodeForQr({ ...base, answerWindowMs: 0 }))).toBeNull()
    expect(decodeFromQr(encodeForQr({ ...base, answerWindowMs: 600_001 }))).toBeNull()
    expect(decodeFromQr(encodeForQr(base))).toEqual(base)
  })
})

describe('late answers, the asker\'s side (late_answers.ts)', () => {
  const sent = { qid: 'q1', peerId: 'p1', text: 'tech setup', at: NOW }
  it('belong to the ask AND the connection it was sent to', () => {
    // review 6h: one entry per ask, with the qid it carried to each connection
    const ask = { id: 'r1', text: sent.text, at: NOW, to: [{ peerId: 'p1', qid: 'q1' }, { peerId: 'p2', qid: 'q2' }] }
    const list = addSentAsk([], ask, NOW)
    expect(sentAskFor(list, 'q1', 'p1', NOW)).toEqual(sent)
    expect(sentAskFor(list, 'q1', 'p2', NOW)).toBeUndefined()
    expect(sentAskFor(list, 'q1', 'p1', NOW + LATE_KEEP_MS + 1)).toBeUndefined()
    expect(addSentAsk(list, ask, NOW).length).toBe(1) // no double
  })
  it('are held until the next open, then released all at once; a held one never shows; one per ask', () => {
    let late = addLateAnswer([], sent, 'Ada', [{ text: 'Tech setup', when: 'this week', context: 'My Resources' }], NOW + 1000)
    late = addLateAnswer(late, sent, 'Ada', [{ text: 'other', when: '', context: '' }], NOW + 2000)
    expect(late.length).toBe(1)
    expect(shownLateAnswers(late, NOW + 3000)).toEqual([])
    const released = releaseLateAnswers(late, NOW + 9000)
    expect(shownLateAnswers(released, NOW + 9000).map((a) => [a.from, a.ask, a.releasedAt])).toEqual([['Ada', 'tech setup', NOW + 9000]])
    // one that arrives after the release waits for the NEXT open
    const after = addLateAnswer(released, { ...sent, qid: 'q9' }, 'Bo', [{ text: 'x', when: '', context: '' }], NOW + 10_000)
    expect(shownLateAnswers(after, NOW + 10_000).length).toBe(1)
    expect(dismissShownLateAnswers(after, NOW + 10_000).map((a) => a.id)).toEqual(['q9'])
  })
  it('bounded, sanitised, and a malformed record never throws', () => {
    let late = []
    for (let i = 0; i < LATE_ANSWERS_MAX + 5; i++) late = addLateAnswer(late, { ...sent, qid: `q${i}` }, 'Ada', [{ text: `‮line ${i}`, when: '', context: '' }], NOW + i)
    expect(late.length).toBe(LATE_ANSWERS_MAX)
    expect(late[0].items[0].text).toBe(`line ${LATE_ANSWERS_MAX + 4}`)
    expect(liveLateAnswers('nonsense', NOW)).toEqual([])
    expect(liveLateAnswers([null, { id: 1 }, { id: 'a', at: NOW, peerId: 'p', from: 'x', ask: 'y', items: 'no' }], NOW)).toEqual([])
    expect(sentAskFor({}, 'q', 'p', NOW)).toBeUndefined()
  })
})

describe('held prompts (held_asks.ts)', () => {
  const held = (qid, receivedAt) => ({ qid, peerId: 'p', text: 'drill', fromName: 'Bo', through: [], doorName: null, relayed: false, matches: [{ threadId: 'inv:1', text: 'Drill', context: 'My Resources', at: 1 }], receivedAt, deadline: receivedAt + 120_000, lateMode: true })
  it('kept oldest first, one per qid, bounded, dropped when decided; malformed never throws', () => {
    let list = []
    for (let i = 0; i < HELD_ASKS_MAX + 3; i++) list = addHeldAsk(list, held(`q${i}`, NOW + i), NOW + i)
    expect(list.length).toBe(HELD_ASKS_MAX)
    expect(list[0].qid).toBe('q3')
    expect(addHeldAsk(list, held('q5', NOW), NOW + 99).length).toBe(HELD_ASKS_MAX)
    expect(dropHeldAsk(list, 'q5', NOW + 99).some((h) => h.qid === 'q5')).toBe(false)
    expect(liveHeldAsks([{ qid: 'x' }, 7, held('ok', NOW)], NOW).map((h) => h.qid)).toEqual(['ok'])
    expect(liveHeldAsks([held('old', NOW)], NOW + LATE_KEEP_MS + 1)).toEqual([])
  })
})

describe('asks that matched nothing (unmatched_asks.ts)', () => {
  it('the reason, the switch and its default', () => {
    expect(unmatchedReason(true, false)).toBe(UnmatchedReason.WhoCanAsk)
    expect(unmatchedReason(false, true)).toBe(UnmatchedReason.OnlyMe)
    expect(unmatchedReason(false, false)).toBe(UnmatchedReason.Nothing)
    expect(showsUnmatched({}, false)).toBe(true)
    expect(showsUnmatched({}, true)).toBe(false)
    expect(showsUnmatched({ showUnmatchedAsks: false }, false)).toBe(false)
    expect(showsUnmatched({ showUnmatchedAsks: true }, true)).toBe(true)
  })
  it('one per ask, kept seven days at most, dismissable; a malformed entry is dropped', () => {
    const a = { id: 'q1', at: NOW, peerId: 'p', from: 'Bo', text: 'sailing boat', reason: UnmatchedReason.Nothing, ring: Ring.Acquaintance }
    const list = addUnmatchedAsk(addUnmatchedAsk([], a, NOW), a, NOW)
    expect(list.length).toBe(1)
    expect(dismissUnmatchedAsk(list, 'q1', NOW)).toEqual([])
    expect(liveUnmatchedAsks([{ ...a, reason: 'because' }, { ...a, ring: 'stranger' }], NOW)).toEqual([])
    expect(liveUnmatchedAsks(list, NOW + 8 * 86_400_000)).toEqual([])
  })
  it('opening Only-me lines is a copy for the reason only: the record is untouched', () => {
    const s = { inventory: [{ id: 'i', text: 'x', audience: Audience.OnlyMe, included: true, createdAt: 1 }], people: [] }
    expect(withOnlyMeOpened(s).inventory[0].audience).toBe(Audience.Close)
    expect(s.inventory[0].audience).toBe(Audience.OnlyMe)
  })
})

describe('the cards about asks (6i: card_stack.ts, which replaced ask_cards.ts)', () => {
  const kinds = (s, demo = false) => stackCards(s, NOW, demo, new Set(), () => true).map((c) => c.kind)
  it('late answers first, then nothing-matched (while its switch is on), then asked-while-away', () => {
    const late = releaseLateAnswers(addLateAnswer([], { qid: 'q', peerId: 'p', text: 't', at: NOW }, 'Ada', [{ text: 'x', when: '', context: '' }], NOW), NOW)
    const unmatched = [{ id: 'u', at: NOW, peerId: 'p', from: 'Bo', text: 'boat', reason: UnmatchedReason.Nothing }]
    const away = [{ id: 'a', at: NOW, peerId: 'p', from: 'Cy', text: 'drill' }]
    expect(kinds({ lateAnswers: late, unmatchedAsks: unmatched, awayAsks: away })).toEqual([StackCardKind.Late, StackCardKind.Unmatched, StackCardKind.Away])
    expect(kinds({ unmatchedAsks: unmatched, awayAsks: away })[0]).toBe(StackCardKind.Unmatched)
    expect(kinds({ unmatchedAsks: unmatched, awayAsks: away }, true)).toEqual([StackCardKind.Away])
    expect(kinds({ unmatchedAsks: unmatched, awayAsks: away, showUnmatchedAsks: false })).toEqual([StackCardKind.Away])
    expect(kinds({})).toEqual([])
    // a held (unreleased) late answer is not a card yet
    expect(kinds({ lateAnswers: addLateAnswer([], { qid: 'q', peerId: 'p', text: 't', at: NOW }, 'Ada', [{ text: 'x', when: '', context: '' }], NOW) })).toEqual([])
  })
})

describe('waking up (wake_watch.ts)', () => {
  it('a jump of the clock between two ticks (the machine slept) calls the hook; throttled ticks do not', () => {
    let now = 0
    let tick = () => {}
    let woke = 0
    const stop = watchWake(() => { woke++ }, { now: () => now, every: (fn) => { tick = fn; return 1 }, stop: () => {} })
    now += TICK_MS; tick()
    now += 70_000; tick() // a background tab ticks about once a minute
    expect(woke).toBe(0)
    now += SLEPT_MS + 1; tick()
    expect(woke).toBe(1)
    stop()
  })
})

describe('the drain lock: a lone tab not in front drains (Q1)', () => {
  it('a request without taking is granted at once when no other tab holds the drain', async () => {
    let held = false
    const locks = { request: (_name, opts, cb) => { if (held && !opts.steal) return new Promise(() => {}); held = true; return cb() } }
    let granted = 0
    const lock = createDrainLock('x', locks, { onGranted: () => { granted++ }, onLost: () => {} })
    lock.request(false)
    await sleep(0)
    expect(granted).toBe(1)
    expect(lock.held()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// the protocol, end to end
// ---------------------------------------------------------------------------

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

/** One phone. `decide`: what the person at it does with a prompt: 'yes', 'no' or 'wait' (the prompt stays open; p.prompts holds it). */
async function phone(name, items = [], opts = {}) {
  const state = {
    v: 1, me: { id: randomId(12), displayName: name }, peers: [], people: [], log: [], notificationsOn: false,
    inventory: items.map((it) => ({ id: randomId(8), included: true, createdAt: Date.now(), audience: Audience.FriendsOfFriends, ...it })),
    ...opts.state,
  }
  const p = { name, state, prompts: [], unmatched: 0, decide: opts.decide ?? 'wait' }
  p.hooks = {
    state: () => state,
    save: () => {},
    onStatus: () => {},
    onAsk: (ask) => { p.prompts.push(ask); if (p.decide !== 'wait') void ask.decide(p.decide === 'yes') },
    onPeerConnected: () => {},
    holdPeer: () => false,
    onPeerConfirmed: () => {},
    ringForNewPeer: () => opts.ringForNewPeer ?? Ring.Friend,
    onLogChanged: () => {},
    askScope: () => undefined,
    onText: () => {},
    mayPassOnFrom: () => true,
    samePerson: () => false,
    keepsUnmatched: () => opts.keepsUnmatched ?? true,
    onUnmatchedAsk: () => { p.unmatched++ },
  }
  p.net = new Net(p.hooks, { answerWindowMs: W, relayOrigin })
  await p.net.start()
  nets.push(p.net)
  p.did = state.identity.did
  return p
}

/** The page reloads: the old Net stops, a new one starts on the same record (what a reload or a new build does). */
async function reload(p) {
  p.net.stop()
  p.prompts = []
  p.net = new Net(p.hooks, { answerWindowMs: W, relayOrigin })
  nets.push(p.net)
  await p.net.start()
  await p.net.restoreHeldAsks()
}

async function connect(asker, asked, ringAtAsked = Ring.Friend) {
  await asker.net.completeConnect({ did: asked.did, from: asked.state.me }, Ring.Friend)
  await until(() => asked.state.peers.some((x) => x.did === asker.did))
  asked.state.peers.find((x) => x.did === asker.did).ring = ringAtAsked
}

const sharedOf = (results) => results.flatMap((r) => (r.decoded?.outcome === 'shared' ? r.decoded.shared.items : []))

describe('a direct ask, the prompt undecided at the moment, a yes later', () => {
  it('the asker hears "nothing" at the moment; the later yes is held silently and released on the next open', async () => {
    const ada = await phone('Ada', [{ text: 'Cargo bike to lend' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    const t0 = Date.now()
    const results = await bo.net.ask('cargo bike')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(W - 50)
    expect(sharedOf(results)).toEqual([])
    expect(ada.prompts.length).toBe(1)
    expect(ada.prompts[0]).toMatchObject({ lateMode: true, arrivedLate: false })
    // she says yes after the moment
    await ada.prompts[0].decide(true)
    await until(() => (bo.state.lateAnswers ?? []).length === 1)
    const late = bo.state.lateAnswers[0]
    expect(late).toMatchObject({ from: 'Ada', ask: 'cargo bike' })
    expect(late.items.map((i) => i.text)).toEqual(['Cargo bike to lend'])
    expect(late.releasedAt).toBeUndefined() // nothing shows live
    expect(shownLateAnswers(bo.state.lateAnswers, Date.now())).toEqual([])
    expect(shownLateAnswers(releaseLateAnswers(bo.state.lateAnswers, Date.now()), Date.now()).length).toBe(1)
    expect(ada.state.log[0]).toMatchObject({ outcome: LogOutcome.Shared })
    expect(ada.state.heldAsks ?? []).toEqual([])
  })

  it('a no after the moment sends nothing more', async () => {
    const ada = await phone('Ada', [{ text: 'Projector' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    await bo.net.ask('projector')
    await ada.prompts[0].decide(false)
    await sleep(3 * W)
    expect(bo.state.lateAnswers ?? []).toEqual([])
    expect(ada.state.log[0]).toMatchObject({ outcome: LogOutcome.Declined })
  })

  it('a yes before the moment arrives at the moment, as always (no late answer)', async () => {
    const ada = await phone('Ada', [{ text: 'Ladder' }], { decide: 'yes' })
    const bo = await phone('Bo')
    await connect(bo, ada)
    const t0 = Date.now()
    const results = await bo.net.ask('ladder')
    expect(Date.now() - t0).toBeGreaterThanOrEqual(W - 50)
    expect(sharedOf(results).map((i) => i.text)).toEqual(['Ladder'])
    await sleep(W)
    expect(bo.state.lateAnswers ?? []).toEqual([])
  })

  it('an answer for that qid from anyone else is never taken as a late answer', async () => {
    const ada = await phone('Ada', [{ text: 'Tent' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    await bo.net.ask('tent')
    const eve = await rawAsker('Eve', bo) // Eve is connected to Bo too
    const adaId = bo.state.peers.find((p) => p.did === ada.did).id
    const qidToAda = bo.state.sentAsks[0].to.find((x) => x.peerId === adaId).qid
    // Eve seals a "share" under her own pair key, with the qid of Bo's ask to Ada
    const env = await sealRelayAnswer(qidToAda, 'trustweb.ask', { from: 'Eve', templateId: 'trustweb.ask', items: [{ text: 'fake', when: '', context: '' }] }, { key: await eve.key, blocked: false })
    await eve.send(bo.did, env)
    await sleep(2 * W)
    expect(bo.state.lateAnswers ?? []).toEqual([])
    expect(sentAskFor(bo.state.sentAsks, qidToAda, adaId, Date.now())).toBeDefined()
  })
})

describe('a reload before deciding (Q5)', () => {
  it('the prompt shows again after the reload and a yes still reaches the asker, as a late answer', async () => {
    const ada = await phone('Ada', [{ text: 'Sewing machine' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    await bo.net.ask('sewing machine')
    expect(ada.prompts.length).toBe(1)
    await reload(ada)
    expect(ada.prompts.length).toBe(1)
    expect(ada.prompts[0]).toMatchObject({ text: 'sewing machine', fromName: 'Bo' })
    await ada.prompts[0].decide(true)
    await until(() => (bo.state.lateAnswers ?? []).length === 1)
    expect(ada.state.heldAsks).toEqual([])
  })
})

describe('an ask that reaches the phone after its asker stopped waiting', () => {
  it('carried its window: the prompt shows, marked late; a yes reaches the asker as a late answer; nothing at a moment', async () => {
    const ada = await phone('Ada', [{ text: 'Electric drill' }])
    const raw = await rawAsker('Bo', ada)
    const issuedAt = Date.now() - 40 * 60_000 // forty minutes ago (the laptop slept)
    await raw.ask({ freeText: 'drill', issuedAt, answerWindowMs: W })
    await until(() => ada.prompts.length === 1)
    expect(ada.prompts[0]).toMatchObject({ arrivedLate: true, lateMode: true })
    await sleep(2 * W)
    expect(raw.answers.length).toBe(0) // no answer at a moment for an asker long gone
    await ada.prompts[0].decide(true)
    await until(() => raw.answers.length === 1)
    expect((await interpret(raw.answers[0], await raw.key)).outcome).toBe('shared')
  })
  it('without a window (an older asker): the 6f away rule, no prompt', async () => {
    const ada = await phone('Ada', [{ text: 'Electric drill' }])
    const raw = await rawAsker('Bo', ada)
    await raw.ask({ freeText: 'drill', issuedAt: Date.now() - 40 * 60_000 })
    await until(() => ada.state.log.some((e) => e.away === true))
    await sleep(W)
    expect(ada.prompts.length).toBe(0)
    expect(raw.answers.length).toBe(0)
  })
})

describe('an ask that matched nothing (the asked person sees it, the asker hears the same "nothing")', () => {
  it('nothing at all: a card with reason Nothing', async () => {
    const ada = await phone('Ada', [{ text: 'Ladder' }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    const results = await bo.net.ask('sailing boat')
    expect(sharedOf(results)).toEqual([])
    expect(results[0].decoded.outcome).toBe('nothing')
    expect(ada.prompts.length).toBe(0)
    expect(ada.state.unmatchedAsks).toMatchObject([{ from: 'Bo', text: 'sailing boat', reason: UnmatchedReason.Nothing }])
    expect(ada.unmatched).toBe(1)
  })
  it('a line for friends, the asker an acquaintance (the default ring of someone who opened my link): reason WhoCanAsk', async () => {
    const ada = await phone('Ada', [{ text: 'Tax advisor in Vienna', audience: Audience.Friends }])
    const bo = await phone('Bo')
    await connect(bo, ada, Ring.Acquaintance)
    expect(sharedOf(await bo.net.ask('tax advisor'))).toEqual([])
    expect(ada.prompts.length).toBe(0)
    expect(ada.state.unmatchedAsks).toMatchObject([{ reason: UnmatchedReason.WhoCanAsk, ring: Ring.Acquaintance }])
  })
  it('a line set to Only me: reason OnlyMe', async () => {
    const ada = await phone('Ada', [{ text: 'Spare room in Vienna', audience: Audience.OnlyMe }])
    const bo = await phone('Bo')
    await connect(bo, ada)
    await bo.net.ask('spare room')
    expect(ada.state.unmatchedAsks).toMatchObject([{ reason: UnmatchedReason.OnlyMe }])
  })
  it('switch off: no card, the same answer', async () => {
    const ada = await phone('Ada', [{ text: 'Ladder' }], { keepsUnmatched: false })
    const bo = await phone('Bo')
    await connect(bo, ada)
    await bo.net.ask('sailing boat')
    expect(ada.state.unmatchedAsks ?? []).toEqual([])
  })
  it('an ask a friend passed on (not straight from its asker) leaves no card', async () => {
    const ann = await phone('Ann')
    const ben = await phone('Ben', [], { decide: 'no' })
    const cleo = await phone('Cleo', [{ text: 'Ladder' }])
    await connect(ann, ben)
    await connect(ben, cleo)
    ann.state.askReach = 2
    await ann.net.ask('sailing boat')
    expect(cleo.state.unmatchedAsks ?? []).toEqual([])
    expect(ben.state.unmatchedAsks).toMatchObject([{ from: 'Ann' }])
  })
})

describe('the window travels with the ask', () => {
  it('an asker on the 120 s build sends it; the passed-on ask carries it on', async () => {
    const ann = await phone('Ann')
    const ben = await phone('Ben')
    const cleo = await phone('Cleo', [{ text: 'Ladder' }], { decide: 'yes' })
    await connect(ann, ben)
    await connect(ben, cleo)
    ann.state.askReach = 2
    const t0 = Date.now()
    const results = await ann.net.ask('ladder')
    expect(sharedOf(results).map((i) => i.text)).toEqual(['Ladder'])
    expect(Date.now() - t0).toBeGreaterThanOrEqual(2 * W - 50)
    expect(cleo.prompts[0].lateMode).toBe(true)
  })
})

// --- helpers: a raw phone with its own relay channel, connected to `target`, to send an ask with a chosen issuedAt / window ---

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
    key, answers,
    send: async (to, env) => channel.send(to, env, await key),
    ask: async (fields) => channel.send(target.did, { v: 1, t: 'query', from: me, templateId: 'trustweb.ask', templateVersion: 1, qid: randomId(12), ...fields }, await key),
  }
}

describe('S2 and S3: the (i) copy and the Signal glyph', () => {
  it('the (i) explains who can ask and how far, with the tech-setup example', async () => {
    const { S } = await import('../../src/strings.ts')
    const text = S.cascadeInfo.join(' ')
    expect(S.cascadeInfoTitle).toBe('Who can ask, and how far')
    expect(text).toMatch(/Who can ask: which of your rings/)
    expect(text).toMatch(/How far: whether it may travel on/)
    expect(text).toMatch(/tech setup/)
    expect(text).toMatch(/home-office setup/)
    expect(text).not.toMatch(/—/)
  })
  it('signalReachable: a Signal link the owner typed wins over a shared one; only https links', async () => {
    const { signalReachable } = await import('../../src/contact_share.ts')
    const { Channel } = await import('../../src/model.ts')
    expect(signalReachable({})).toBeNull()
    expect(signalReachable({ theirChannels: { [Channel.Signal]: 'https://signal.me/#eu/abc' } })?.link).toBe('https://signal.me/#eu/abc')
    expect(signalReachable({ channels: { [Channel.Signal]: '+43123456789' }, theirChannels: { [Channel.Signal]: 'https://signal.me/#eu/abc' } })?.source).toBe('own')
    expect(signalReachable({ theirChannels: { [Channel.WhatsApp]: '+43123456789' } })).toBeNull()
  })
  it('the glyph is plain SVG markup: no script, no external reference, no colour of its own', async () => {
    const { ICONS } = await import('../../src/icons.ts')
    expect(ICONS.signal).toMatch(/^<svg viewBox="0 0 24 24">/)
    expect(ICONS.signal).not.toMatch(/script|href|url\(|on[a-z]+=|fill="#|stroke="#/i)
  })
})
