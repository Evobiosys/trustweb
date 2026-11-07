// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 33: "Ask for intros" (src/intro_ask.ts): who in my web is associated with a target, ranked by trust hop then association count. */
import { introMaxHop, introCandidates, introAskText, introTrustHop, parseIntroTarget } from '../../src/intro_ask.ts'
import { Ring } from '../../src/model.ts'

const p = (id, ring, extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), ring, peerId: 'peer-' + id, fields: {}, lines: [], context: '', ...extra })

describe('trust hop', () => {
  it('closest and close are one hop, friends two, acquaintances three, family by closeness', () => {
    expect(introTrustHop(p('a', Ring.Closest))).toBe(1)
    expect(introTrustHop(p('a', Ring.Close))).toBe(1)
    expect(introTrustHop(p('a', Ring.Friend))).toBe(2)
    expect(introTrustHop(p('a', Ring.Acquaintance))).toBe(3)
    expect(introTrustHop(p('a', Ring.Family, { fields: { 'tw-closeness': Ring.Friend } }))).toBeGreaterThan(0)
  })
})

it('How far? steps widen the hop by one tier, from Friends', () => {
  expect(introMaxHop(1)).toBe(2)
  expect(introMaxHop(2)).toBe(3)
})

describe('association with a person', () => {
  const target = p('tara', Ring.Acquaintance, { context: 'Permaculture Graz', events: ['e1'], knows: ['dora'] })
  const people = [
    target,
    p('dora', Ring.Friend),
    p('eli', Ring.Friend, { context: 'permaculture graz' }),
    p('fay', Ring.Close, { events: ['e1', 'e2'], lines: [{ id: 'l', text: 'Met Tara at the seed swap', context: '' }] }),
    p('gus', Ring.Closest, { knows: ['tara'] }),
    p('hal', Ring.Acquaintance),
    { ...p('ivy', Ring.Friend, { context: 'Permaculture Graz' }), peerId: undefined },
    p('jon', Ring.Friend, { context: 'Permaculture Graz', blocked: 1 }),
  ]

  it('counts direct connection, shared context, shared events and co-mentions; skips the target, the unconnected and the blocked', () => {
    const r = introCandidates(people, 'Tara', 3)
    expect(r.map((c) => c.person.id)).toEqual(['fay', 'gus', 'dora', 'eli'])
    expect(r.find((c) => c.person.id === 'fay')?.count).toBe(2)
    expect(r.find((c) => c.person.id === 'dora')?.reasons).toContain('knows')
  })

  it('ranks trust hop first, then association count', () => {
    const r = introCandidates(people, 'Tara', 3)
    expect(r.map((c) => c.hop)).toEqual([1, 1, 2, 2])
  })

  it('How far? caps the hop', () => {
    expect(introCandidates(people, 'Tara', 1).map((c) => c.person.id)).toEqual(['fay', 'gus'])
  })
})

describe('association with an organisation or topic typed in', () => {
  const people = [
    p('ann', Ring.Friend, { context: 'Dorfladen Leibnitz' }),
    p('bob', Ring.Friend, { lines: [{ id: 'l', text: 'works with the dorfladen on deliveries', context: '' }] }),
    p('cy', Ring.Close),
  ]
  it('matches context and note text, case-insensitive', () => {
    expect(introCandidates(people, 'Dorfladen', 3).map((c) => c.person.id).sort()).toEqual(['ann', 'bob'])
  })
  it('an empty target finds nobody', () => {
    expect(introCandidates(people, '  ', 3)).toEqual([])
  })
})

describe('the ask', () => {
  it('names the target in the text; the target is bounded and trimmed', () => {
    expect(introAskText('Tara')).toContain('Tara')
    expect(parseIntroTarget('  Tara  ')).toBe('Tara')
    expect(parseIntroTarget('x'.repeat(500))).toHaveLength(80)
    expect(parseIntroTarget('   ')).toBeUndefined()
    expect(parseIntroTarget(42)).toBeUndefined()
  })
})
