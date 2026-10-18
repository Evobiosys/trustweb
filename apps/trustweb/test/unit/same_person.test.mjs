/** "Same person" (src/same_person.ts): merge two persons into one, resolve and list duplicates. */
import { mergePersons, normName, possibleDuplicates, resolveSameAs } from '../../src/same_person.ts'

const line = (id, text = id) => ({ id, text, tag: 'note', audience: 'close', status: 'current', notedAt: 1, checkedAt: 1 })
const person = (id, name, extra = {}) => ({ id, name, context: '', ring: 'friend', metAt: 10, lines: [], ...extra })
const state = (people, extra = {}) => ({ v: 1, me: { name: 'J' }, people, peers: [], inventory: [], log: [], meetings: [], ...extra })

describe('mergePersons', () => {
  it('unites lines and events, fills missing fields, keeps the kept one\'s values, takes the earlier metAt', () => {
    const s = state([
      person('k', 'Ada', { lines: [line('l1')], events: ['e1'], channels: { signal: 'S' }, peerId: 'peerK', generalNote: 'one', ring: 'close', angle: 5 }),
      person('d', 'Ada L', { lines: [line('l1', 'dup'), line('l2')], events: ['e2'], channels: { signal: 'X', matrix: 'M' }, did: 'did:x', fediverse: { handle: 'a' }, metAt: 3, generalNote: 'two', ringSuggested: true, angle: 90, theirChannelsAt: 7, passOn: true }),
    ], { meetings: [{ id: 'm1', personId: 'd' }], demo: { people: ['d', 'k'], inventory: [] } })
    expect(mergePersons(s, 'k', 'd')).toBe(true)
    expect(s.people).toHaveLength(1)
    expect(s.people[0]).toMatchObject({
      id: 'k', name: 'Ada', metAt: 3, ring: 'close', angle: 5, peerId: 'peerK', did: 'did:x', passOn: true, theirChannelsAt: 7,
      channels: { signal: 'S', matrix: 'M' }, events: ['e1', 'e2'], generalNote: 'one\n\ntwo', fediverse: { handle: 'a' },
    })
    expect(s.people[0]).not.toHaveProperty('ringSuggested')
    expect(s.people[0].lines.map((l) => l.id)).toEqual(['l1', 'l2'])
    expect(s.sameAs).toEqual({ d: 'k' })
    expect(s.meetings[0].personId).toBe('k')
    expect(s.demo.people).toEqual(['k'])
  })
  it('two different connections: the kept one stays, the other is noted so nothing is lost; a second merge changes nothing', () => {
    const s = state([person('k', 'A', { peerId: 'peerKept' }), person('d', 'A', { peerId: 'abcdefghij' })])
    mergePersons(s, 'k', 'd')
    expect(s.people[0].peerId).toBe('peerKept')
    expect(s.people[0].generalNote).toBe('also connected as abcdefgh')
    expect(mergePersons(s, 'k', 'd')).toBe(false)
  })
  it('refuses a missing person or the same person twice', () => {
    const s = state([person('k', 'A')])
    expect(mergePersons(s, 'k', 'k')).toBe(false)
    expect(mergePersons(s, 'k', 'zz')).toBe(false)
  })
})

describe('resolve and duplicates', () => {
  it('follows chains (a->b, b->c gives c) and survives a cycle', () => {
    expect(resolveSameAs({ a: 'b', b: 'c' }, 'a')).toBe('c')
    expect(resolveSameAs({ a: 'b', b: 'a' }, 'a')).toBe('a')
    expect(resolveSameAs(undefined, 'a')).toBe('a')
    expect(resolveSameAs({}, 'constructor')).toBe('constructor')
  })
  it('pairs with equal names (case, spaces, accents ignored) and different ids', () => {
    expect(normName('  José  MÜLLER ')).toBe('jose muller')
    const pairs = possibleDuplicates([person('1', 'José Müller'), person('2', 'jose muller'), person('3', 'Other'), person('4', '')])
    expect(pairs.map(([a, b]) => [a.id, b.id])).toEqual([['1', '2']])
  })
})

describe('R2: merging keeps timeline, agreements and the newer profile', () => {
  const e = (at, summary = 's') => ({ at, channel: 'email', direction: 'in', summary, source: 'manual' })
  const ag = (id, status, expiresAt) => ({ id, text: id, at: 1, status, ...(expiresAt ? { expiresAt } : {}) })
  it('unions the timeline by entry and the agreements by id (further-along status, then newer expiry); nothing is dropped', () => {
    const s = state([
      person('k', 'Ada', { timeline: [e(1), e(2)], agreements: [ag('a', 'mine'), ag('b', 'mutual', 5), ag('c', 'proposed', 9)] }),
      person('d', 'Ada', { timeline: [e(2), e(3)], agreements: [ag('a', 'mutual'), ag('b', 'mutual', 8), ag('c', 'mine'), ag('d', 'incoming')] }),
    ])
    mergePersons(s, 'k', 'd')
    const p = s.people[0]
    expect(p.timeline.map((x) => x.at).sort()).toEqual([1, 2, 3])
    expect(Object.fromEntries(p.agreements.map((a) => [a.id, [a.status, a.expiresAt]]))).toEqual({ a: ['mutual', undefined], b: ['mutual', 8], c: ['proposed', 9], d: ['incoming', undefined] })
  })
  it('keeps the newer theirProfile and fills its missing fields from the older', () => {
    const s = state([
      person('k', 'Ada', { theirProfile: { norms: [], intro: 'old', favourite: 'call', at: 1 } }),
      person('d', 'Ada', { theirProfile: { norms: [], intro: 'new', at: 9 } }),
    ])
    mergePersons(s, 'k', 'd')
    expect(s.people[0].theirProfile).toEqual({ norms: [], intro: 'new', favourite: 'call', at: 9 })
  })
})
