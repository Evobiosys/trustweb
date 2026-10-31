// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// wave27 sovereign-switch: search_rank
import { rank, zoneRank, jaccard, tagsOfFields, RANK } from '../../src/search_rank.ts'
import { Ring } from '../../src/model'
import { ChatDirection } from '../../src/chat'
import { pinnedPeople, peopleByZone } from '../../src/people_list'
import { queueAsk } from '../../src/together_match.ts'

const DAY = 86_400_000
const NOW = 1_800_000_000_000
const c = (ring, extra = {}) => ({ ring, ...extra })
const ctx = (extra = {}) => ({ now: NOW, ...extra })
const score = (cand, x = ctx()) => rank([cand], x)[0].score

// Small seeded PRNG (mulberry32), so the property test is reproducible.
function prng(seed) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

describe('search_rank units', () => {
  it('weights sum to 1 and live in one object', () => {
    const w = RANK.w_zone + RANK.w_tag + RANK.w_recency + RANK.w_recip + RANK.w_text
    expect(Math.abs(w - 1)).toBeLessThan(1e-9)
    expect(RANK.recencyDays).toBe(90)
  })
  it('is monotone in the zone', () => {
    const order = [Ring.Closest, Ring.Close, Ring.Friend, Ring.Acquaintance, Ring.Intending, Ring.Unsorted]
    const s = order.map((r) => score(c(r)))
    for (let i = 1; i < s.length - 1; i++) expect(s[i - 1]).toBeGreaterThan(s[i])
    expect(zoneRank(c(Ring.None))).toBe(0)
    expect(zoneRank(c(Ring.Unsorted))).toBe(0)
  })
  it('family sits by its closeness', () => {
    expect(zoneRank(c(Ring.Family, { fields: { 'tw-closeness': 'friend' } }))).toBe(zoneRank(c(Ring.Friend)))
    expect(zoneRank(c(Ring.Family))).toBe(zoneRank(c(Ring.Close)))
  })
  it('tag overlap raises the score', () => {
    const x = ctx({ tags: ['a', 'b'] })
    const none = score(c(Ring.Friend), x), one = score(c(Ring.Friend, { fields: { a: 'true' } }), x), both = score(c(Ring.Friend, { fields: { a: 'true', b: 'true' } }), x)
    expect(one).toBeGreaterThan(none); expect(both).toBeGreaterThan(one)
    expect(tagsOfFields({ a: 'true', b: 'false', c: 'x' })).toEqual(['a'])
    expect(jaccard([], [])).toBe(0)
  })
  it('recency decays with days since contact', () => {
    const at = (d) => score(c(Ring.Friend, { lastContactAt: NOW - d * DAY }))
    expect(at(0)).toBeGreaterThan(at(30)); expect(at(30)).toBeGreaterThan(at(200))
    expect(rank([c(Ring.Friend, { lastContactAt: NOW - 90 * DAY })], ctx())[0].terms.recency).toBeCloseTo(Math.exp(-1), 6)
  })
  it('reciprocity is min/max of out and in, 0 without counts', () => {
    expect(rank([c(Ring.Friend, { outCount: 2, inCount: 4 })], ctx())[0].terms.recip).toBe(0.5)
    expect(rank([c(Ring.Friend)], ctx())[0].terms.recip).toBe(0)
    expect(rank([c(Ring.Friend, { outCount: 0, inCount: 0 })], ctx())[0].terms.recip).toBe(0)
  })
  it('text uses the fuzzy matcher (plural still counts)', () => {
    const t = (text) => rank([c(Ring.Friend, { text })], ctx({ query: 'bicycles' }))[0].terms.text
    expect(t('bicycle repair')).toBeGreaterThan(0.8); expect(t('piano')).toBe(0)
  })
  it('terms are raw parts and score is their weighted sum', () => {
    const r = rank([c(Ring.Close, { text: 'bike', lastContactAt: NOW - DAY, outCount: 1, inCount: 1, fields: { a: 'true' } })], ctx({ query: 'bike', tags: ['a'] }))[0]
    const sum = RANK.w_zone * r.terms.zone + RANK.w_tag * r.terms.tag + RANK.w_recency * r.terms.recency + RANK.w_recip * r.terms.recip + RANK.w_text * r.terms.text
    expect(r.score).toBeCloseTo(sum, 9)
  })
  it('ties keep the original order (stable)', () => {
    const a = [{ ring: Ring.Friend, id: 1 }, { ring: Ring.Friend, id: 2 }, { ring: Ring.Friend, id: 3 }]
    expect(rank(a, ctx()).map((r) => r.person.id)).toEqual([1, 2, 3])
  })
})

describe('search_rank property (seeded)', () => {
  it('no NaN, scores in [0,1], total order, nothing lost', () => {
    const rnd = prng(27)
    const rings = Object.values(Ring)
    const words = ['bike', 'bicycle', 'tax', 'advisor', 'piano', 'cook', 'garden', '']
    const tagPool = ['a', 'b', 'c', 'd']
    for (let round = 0; round < 60; round++) {
      const n = Math.floor(rnd() * 25)
      const cands = Array.from({ length: n }, (_, i) => {
        const fields = {}
        for (const t of tagPool) if (rnd() < 0.4) fields[t] = rnd() < 0.8 ? 'true' : 'no'
        return {
          id: i, ring: rings[Math.floor(rnd() * rings.length)], fields,
          ...(rnd() < 0.7 ? { lastContactAt: NOW + (rnd() - 0.8) * 400 * DAY } : {}),
          ...(rnd() < 0.5 ? { outCount: Math.floor(rnd() * 6), inCount: Math.floor(rnd() * 6) } : {}),
          text: words[Math.floor(rnd() * words.length)] + ' ' + words[Math.floor(rnd() * words.length)],
        }
      })
      const x = ctx({ query: rnd() < 0.7 ? words[Math.floor(rnd() * words.length)] : '', tags: tagPool.filter(() => rnd() < 0.5) })
      const out = rank(cands, x)
      expect(out.length).toBe(n)
      expect(new Set(out.map((r) => r.person.id)).size).toBe(n)
      for (const r of out) {
        expect(Number.isFinite(r.score)).toBe(true)
        expect(r.score).toBeGreaterThanOrEqual(0); expect(r.score).toBeLessThanOrEqual(1)
        for (const v of Object.values(r.terms)) { expect(Number.isFinite(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1) }
      }
      for (let i = 1; i < out.length; i++) expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score)
      const again = rank(out.map((r) => r.person), x).map((r) => r.person.id)
      expect(again).toEqual(out.map((r) => r.person.id))
      expect(rank(cands, x).map((r) => r.person.id)).toEqual(out.map((r) => r.person.id))
    }
  })
})

describe('wiring', () => {
  const p = (id, name, ring, extra = {}) => ({ id, name, context: 'bike repair', ring, metAt: 1, lines: [], pinned: true, ...extra })
  it('people search: the closer person comes first on equal text match', () => {
    const people = [p('far', 'Far', Ring.Acquaintance), p('near', 'Near', Ring.Close)]
    expect(pinnedPeople({ people }, 'bike', NOW).map((x) => x.id)).toEqual(['near', 'far'])
  })
  it('people search without a query keeps the newest-contact order', () => {
    const people = [p('old', 'Old', Ring.Close, { metAt: 1 }), p('new', 'New', Ring.Acquaintance, { metAt: 9 })]
    expect(pinnedPeople({ people }, '', NOW).map((x) => x.id)).toEqual(['new', 'old'])
    expect(peopleByZone({ people: [{ ...people[0], pinned: false }] }, 'bike', NOW).length).toBe(1)
  })
  it('reciprocity comes from chat directions', () => {
    const msg = (dir, at) => ({ dir, at })
    const people = [p('mute', 'Mute', Ring.Close, { peerId: 'm' }), p('talk', 'Talk', Ring.Close, { peerId: 't' })]
    const chats = { m: { messages: [msg(ChatDirection.Out, NOW - DAY), msg(ChatDirection.Out, NOW - DAY)] }, t: { messages: [msg(ChatDirection.Out, NOW - DAY), msg(ChatDirection.In, NOW - DAY)] } }
    expect(pinnedPeople({ people, chats }, 'bike', NOW).map((x) => x.id)).toEqual(['talk', 'mute'])
  })
  it('together queue: among fitting asks the closer asker goes first, none passes a non-fitting one twice', () => {
    const q = []; const jumped = new WeakSet(); const fits = (a) => a.fit
    const rankOf = (a) => a.r
    queueAsk(q, { id: 'f-far', fit: true, r: 1 }, fits, jumped, rankOf)
    queueAsk(q, { id: 'f-near', fit: true, r: 5 }, fits, jumped, rankOf)
    queueAsk(q, { id: 'f-mid', fit: true, r: 3 }, fits, jumped, rankOf)
    queueAsk(q, { id: 'n1', fit: false, r: 9 }, fits, jumped, rankOf)
    expect(q.map((a) => a.id)).toEqual(['f-near', 'f-mid', 'f-far', 'n1'])
    // a fitting ask overtakes n1 once (jumped), the next one stays behind it even with a better rank
    queueAsk(q, { id: 'f-a', fit: true, r: 2 }, fits, jumped, rankOf)
    queueAsk(q, { id: 'f-b', fit: true, r: 6 }, fits, jumped, rankOf)
    expect(q.map((a) => a.id)).toEqual(['f-near', 'f-mid', 'f-a', 'f-far', 'n1', 'f-b'])
  })
})
