/**
 * Wave 6 (U1), the pure hop rules (src/hops.ts), table-driven: how far an ask
 * travels, who may pass it on, when each phone answers, what the hop fields of
 * a passed-on ask look like, cycles, repeats, old-build envelopes, direct asks,
 * and the "through <name>" marks on items that came back.
 */
import { decodeFromQr, encodeForQr } from '../../../demo/src/wire.ts'
import { HOP_CAP, HOPS_UNBOUNDED } from '../../../demo/src/types.ts'
import { mayPassOn, surfacesHere } from '../../src/direct_ask.ts'
import {
  askerOf, askFields, askReachOf, askTimeoutMs, askWaitMs, answerDelayMs, BASE_ASK_TIMEOUT_MS, cascadeFields, dedupeItems, doorAnswerDelayMs,
  doorFields, doorSlackMs, effectiveMaxHops, hopInfo, isReach, markThrough, mayCascade, mayForwardToOwner, REACH_CHOICES, ReachChoice,
  reachChoice, reachFor, readVia, RootMemory, sanitizeHopItems, seenHash, surfacesAt, throughOf,
} from '../../src/hops.ts'

const W = 30_000
const BASE = { v: 1, t: 'query', from: { id: 'ann', displayName: 'Ann' }, templateId: 'free', templateVersion: 1, qid: 'q1', issuedAt: 1, freeText: 'Who has a ladder?' }
const travelling = (extra = {}) => ({ ...BASE, maxHops: 2, hop: 0, root: 'rootABC123', seen: ['0123456789abcdef'], ...extra })

describe('reach: effective maxHops, stored values, the chooser', () => {
  it.each([
    [undefined, 1], [1, 1], [2, 2], [3, 3], [HOP_CAP, HOP_CAP], [HOP_CAP + 4, HOP_CAP], [HOPS_UNBOUNDED, HOP_CAP],
    [0, 1], [-5, 1], [1.5, 1], [NaN, 1], ['2', 1],
  ])('effectiveMaxHops(%s) = %s', (v, want) => expect(effectiveMaxHops(v)).toBe(want))

  it.each([[1, true], [HOP_CAP, true], [HOPS_UNBOUNDED, true], [0, false], [HOP_CAP + 1, false], [2.5, false], ['3', false], [null, false]])(
    'isReach(%s) = %s', (v, want) => expect(isReach(v)).toBe(want))

  it('askReachOf: absent = 1, a stored reach is used, "Ask only my direct contacts" always wins, junk = 1', () => {
    expect(askReachOf({})).toBe(1)
    expect(askReachOf({ askReach: 3 })).toBe(3)
    expect(askReachOf({ askReach: HOPS_UNBOUNDED })).toBe(HOPS_UNBOUNDED)
    expect(askReachOf({ askReach: 3, askDirectOnly: true })).toBe(1)
    expect(askReachOf({ askReach: 99 })).toBe(1)
  })

  it.each([
    [1, ReachChoice.Contacts], [2, ReachChoice.FriendsOfFriends], [3, ReachChoice.Three], [4, ReachChoice.Custom], [HOP_CAP, ReachChoice.Custom], [HOPS_UNBOUNDED, ReachChoice.NoLimit],
  ])('reachChoice(%s) = %s', (v, want) => expect(reachChoice(v)).toBe(want))

  it('reachFor round-trips every choice; Custom is clamped to 1..HOP_CAP', () => {
    expect(REACH_CHOICES).toEqual([ReachChoice.Contacts, ReachChoice.FriendsOfFriends, ReachChoice.Three, ReachChoice.Custom, ReachChoice.NoLimit])
    expect(reachFor(ReachChoice.Contacts, 9)).toBe(1)
    expect(reachFor(ReachChoice.FriendsOfFriends, 9)).toBe(2)
    expect(reachFor(ReachChoice.Three, 9)).toBe(3)
    expect(reachFor(ReachChoice.NoLimit, 9)).toBe(HOPS_UNBOUNDED)
    expect(reachFor(ReachChoice.Custom, 4)).toBe(4)
    expect(reachFor(ReachChoice.Custom, 99)).toBe(HOP_CAP)
    expect(reachFor(ReachChoice.Custom, -3)).toBe(1)
    expect(reachFor(ReachChoice.Custom, NaN)).toBe(1)
  })
})

describe('the asker: one step sends exactly the ask of the build before', () => {
  it('maxHops 1 adds no field at all', () => {
    expect(askFields(1, 'rootABC123', 'aaaaaaaaaaaaaaaa')).toEqual({})
  })
  it('further: reach, hop 0, root, itself in seen', () => {
    expect(askFields(2, 'rootABC123', 'aaaaaaaaaaaaaaaa')).toEqual({ maxHops: 2, hop: 0, root: 'rootABC123', seen: ['aaaaaaaaaaaaaaaa'] })
    expect(askFields(HOPS_UNBOUNDED, 'rootABC123', 'aaaaaaaaaaaaaaaa').maxHops).toBe(HOPS_UNBOUNDED)
  })
  it('the wait and the timeout grow by one window per further step', () => {
    expect(askWaitMs(undefined, W)).toBe(W)
    expect(askWaitMs(2, W)).toBe(2 * W)
    expect(askWaitMs(HOPS_UNBOUNDED, W)).toBe(HOP_CAP * W)
    expect(askTimeoutMs(1, W)).toBe(BASE_ASK_TIMEOUT_MS)
    expect(askTimeoutMs(3, W)).toBe(BASE_ASK_TIMEOUT_MS + 2 * W)
  })
})

describe('who passes on, who is shown the ask (receiver at hop h passes on only if h + 1 < maxHops)', () => {
  // [description, envelope, travels, surfaces, phone may cascade, door may forward to owner, legacy mayPassOn]
  const rows = [
    ['old build: no hop fields', BASE, false, true, false, true, true],
    ['old build: relayed by an older front door', { ...BASE, relayed: true }, false, true, false, true, false],
    ['old build: direct', { ...BASE, direct: true }, false, true, false, false, false],
    ['old build: relayed although direct (forwarded against the asker)', { ...BASE, relayed: true, direct: true }, false, false, false, false, false],
    ['maxHops 1 sent explicitly: one step, like before', { ...BASE, maxHops: 1, hop: 0 }, false, true, false, true, true],
    ['maxHops 2 at B (hop 0): B passes on', travelling(), true, true, true, true, true],
    ['maxHops 2 at C (hop 1): C answers, does not pass on', travelling({ hop: 1, relayed: true }), true, true, false, true, false],
    ['maxHops 2 arriving at hop 2: further than allowed, never shown', travelling({ hop: 2, relayed: true }), true, false, false, false, false],
    ['maxHops 3 at C (hop 1): C passes on', travelling({ maxHops: 3, hop: 1, relayed: true }), true, true, true, true, true],
    ['no limit at hop HOP_CAP-2: still passes on', travelling({ maxHops: HOPS_UNBOUNDED, hop: HOP_CAP - 2, relayed: true }), true, true, true, true, true],
    ['no limit at hop HOP_CAP-1: the last step', travelling({ maxHops: HOPS_UNBOUNDED, hop: HOP_CAP - 1, relayed: true }), true, true, false, true, false],
    ['direct wins over any reach', travelling({ maxHops: 4, direct: true }), false, true, false, false, false],
    ['a travelling ask without a root never travels on', travelling({ root: undefined }), true, true, false, true, false],
  ]
  it.each(rows)('%s', (_name, q, travels, surfaces, cascade, door, legacy) => {
    expect(hopInfo(q).travels).toBe(travels)
    expect(surfacesAt(q)).toBe(surfaces)
    expect(surfacesHere(q)).toBe(surfaces)
    expect(mayCascade(q)).toBe(cascade)
    expect(mayForwardToOwner(q)).toBe(door)
    expect(mayPassOn(q)).toBe(legacy)
  })
})

describe('timing: the answer moment depends on the envelope only', () => {
  const info = (extra) => hopInfo(travelling(extra))
  it.each([
    ['old build', hopInfo(BASE), W],
    ['maxHops 2, hop 0', info({}), 2 * W],
    ['maxHops 2, hop 1', info({ hop: 1 }), W],
    ['maxHops 3, hop 0', info({ maxHops: 3 }), 3 * W],
    ['door ask maxHops 2 hop 0 (owner keeps a slack)', info({ door: true }), 2 * W - doorSlackMs(W)],
  ])('%s', (_n, i, want) => expect(answerDelayMs(i, W)).toBe(want))

  it('every child answers before its parent, with room for the way back (all reaches and steps)', () => {
    const LATENCY = 2_000
    for (const maxHops of [2, 3, 4, 5, HOP_CAP, HOPS_UNBOUNDED]) {
      const m = effectiveMaxHops(maxHops)
      for (let hop = 0; hop + 1 < m; hop++) {
        const parent = answerDelayMs(hopInfo(travelling({ maxHops, hop })), W)
        const child = answerDelayMs(hopInfo(travelling({ maxHops, hop: hop + 1 })), W)
        expect(LATENCY + child + LATENCY).toBeLessThan(parent)
      }
    }
  })

  it('front door: at hop 0 its usual wait plus one window per further step; further out a phone\'s delay; the owner always answers it before', () => {
    const LATENCY = 2_000
    for (const forwardWait of [45_000, 120_000, 10_000]) {
      for (const maxHops of [2, 3, HOPS_UNBOUNDED]) {
        const m = effectiveMaxHops(maxHops)
        for (let hop = 0; hop < m; hop++) {
          const at = hopInfo(travelling({ maxHops, hop }))
          const door = doorAnswerDelayMs(at, W, forwardWait)
          const owner = answerDelayMs(hopInfo(travelling({ maxHops, hop, door: true })), W)
          expect(LATENCY + owner + LATENCY).toBeLessThan(door)
          if (hop > 0) expect(door).toBe(answerDelayMs(at, W))
          // and the door answers before the phone that asked it (the parent at hop - 1)
          if (hop > 0) expect(LATENCY + door + LATENCY).toBeLessThan(answerDelayMs(hopInfo(travelling({ maxHops, hop: hop - 1 })), W))
        }
      }
    }
    expect(doorAnswerDelayMs(hopInfo(BASE), W, 45_000)).toBe(45_000)
    expect(doorAnswerDelayMs(hopInfo(BASE), W, 10_000)).toBe(W)
    expect(doorAnswerDelayMs(hopInfo(travelling()), W, 45_000)).toBe(45_000 + W)
  })
})

describe('the ask a phone passes on, and the one a front door hands its owner', () => {
  it('cascadeFields: one step further, same reach and root, seen grows, the sender joins via, relayed for older builds', () => {
    const q = travelling({ via: [] })
    const out = cascadeFields(q, hopInfo(q), ['1111111111111111', '0123456789abcdef'], 'Ann')
    expect(out).toEqual({ relayed: true, maxHops: 2, hop: 1, root: 'rootABC123', seen: ['0123456789abcdef', '1111111111111111'], via: ['Ann'] })
    expect('direct' in out || 'door' in out).toBe(false)
  })
  it('the passed-on ask parses on the wire and keeps its fields (and an old build would ignore them)', () => {
    const q = travelling()
    const next = { ...BASE, qid: 'q2', from: { id: 'ben', displayName: 'Ben' }, ...cascadeFields(q, hopInfo(q), ['1111111111111111'], 'Ann') }
    const back = decodeFromQr(encodeForQr(next))
    expect(back).toMatchObject({ hop: 1, maxHops: 2, root: 'rootABC123', via: ['Ann'], relayed: true })
  })
  it('doorFields: the same step, door, the asker named in via; nothing for an ask that does not travel', () => {
    const q = travelling()
    expect(doorFields(q, hopInfo(q), ['2222222222222222'], 'Anna-demo')).toMatchObject({ door: true, hop: 0, maxHops: 2, via: ['Anna-demo'], root: 'rootABC123' })
    expect(doorFields(BASE, hopInfo(BASE), [], 'Anna-demo')).toEqual({})
  })
  it('askerOf / throughOf: "Ann asks, through Ben" at C; a direct ask names its sender only', () => {
    const atC = hopInfo(travelling({ hop: 1, via: ['Ann'] }))
    expect(askerOf(atC, 'Ben')).toBe('Ann')
    expect(throughOf(atC, 'Ben')).toEqual(['Ben'])
    const atD = hopInfo(travelling({ maxHops: 3, hop: 2, via: ['Ann', 'Ben'] }))
    expect(throughOf(atD, 'Cleo')).toEqual(['Ben', 'Cleo'])
    expect(askerOf(hopInfo(BASE), 'Ann')).toBe('Ann')
    expect(throughOf(hopInfo(BASE), 'Ann')).toEqual([])
  })
})

describe('cycles and repeats', () => {
  it('seenHash: 16 hex, stable per (root, id), different across roots (cannot be followed from ask to ask)', async () => {
    const a = await seenHash('rootABC123', 'ann')
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(await seenHash('rootABC123', 'ann')).toBe(a)
    expect(await seenHash('rootXYZ789', 'ann')).not.toBe(a)
    expect(await seenHash('rootABC123', 'ben')).not.toBe(a)
  })
  it('a phone listed in seen recognises itself (the cycle A -> B -> C -> A stops at A)', async () => {
    const ann = await seenHash('rootABC123', 'ann')
    const info = hopInfo(travelling({ maxHops: 3, hop: 2, seen: [ann, await seenHash('rootABC123', 'ben')] }))
    expect(info.seen.includes(await seenHash('rootABC123', 'ann'))).toBe(true)
    expect(info.seen.includes(await seenHash('rootABC123', 'dana'))).toBe(false)
  })
  it('RootMemory: the second arrival of one root is a repeat; no root never is; bounded', () => {
    const m = new RootMemory(3)
    expect(m.repeat('r1', 1)).toBe(false)
    expect(m.repeat('r1', 2)).toBe(true)
    expect(m.repeat(null, 3)).toBe(false)
    expect(m.repeat(null, 4)).toBe(false)
    for (const r of ['r2', 'r3', 'r4']) m.repeat(r, 5)
    expect(m.repeat('r1', 6)).toBe(false)
  })
})

describe('items that came back: "through <name>"', () => {
  it('readVia: names only, clipped, bounded; anything else is none', () => {
    expect(readVia(['Ben', '', 3, 'x'.repeat(60)])).toEqual(['Ben', 'x'.repeat(40)])
    expect(readVia('Ben')).toEqual([])
    expect(readVia(Array(20).fill('B'))).toHaveLength(HOP_CAP)
  })
  it('sanitizeHopItems: well-formed items only, bounded text, via kept', () => {
    const out = sanitizeHopItems([{ text: 'Ladder', when: 'mid October', context: 'What I have', via: ['Cleo'] }, { text: '' }, null, 'x', { text: 'y'.repeat(400), when: 3 }])
    expect(out).toEqual([{ text: 'Ladder', when: 'mid October', context: 'What I have', via: ['Cleo'] }, { text: 'y'.repeat(300), when: '', context: '' }])
    expect(sanitizeHopItems('nope')).toEqual([])
  })
  it('markThrough puts this phone first; dedupeItems keeps one of the same line', () => {
    expect(markThrough([{ text: 'Ladder', when: 'w', context: 'c' }, { text: 'Tent', when: 'w', context: 'c', via: ['Cleo'] }], 'Ben'))
      .toEqual([{ text: 'Ladder', when: 'w', context: 'c', via: ['Ben'] }, { text: 'Tent', when: 'w', context: 'c', via: ['Ben', 'Cleo'] }])
    expect(dedupeItems([{ text: 'Ladder', when: '', context: '' }, { text: ' ladder ', when: '', context: '', via: ['B'] }])).toHaveLength(1)
  })
})
