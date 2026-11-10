// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40 hover-sources: how two of my contacts relate, and why we think so (pure derivation + confidence rules). */
import { CROWD, KINDS, LINE_DASH, WEIGHT, confidenceOf, relationIndex, setStated, clearStated } from '../../src/relations_model.ts'
import { SYNC_EXCLUDED } from '../../src/sync_core.ts'

const p = (id, extra = {}) => ({ id, name: id.toUpperCase(), context: '', ring: 'friend', lines: [], metAt: 0, ...extra })
const tag = (id, label, system = false) => ({ id, label, system })
const input = (people, extra = {}) => ({ me: { id: 'me' }, people, tags: [], ...extra })

describe('confidenceOf (noisy-or of the source weights, never 1 without my own statement)', () => {
  it('no source = 0, one source = its weight', () => {
    expect(confidenceOf([])).toBe(0)
    expect(confidenceOf([{ type: 'shared-tag', detail: 'x' }])).toBe(WEIGHT['shared-tag'])
  })
  it('more sources raise it, but stay under 0.95', () => {
    const one = confidenceOf([{ type: 'shared-tag', detail: 'a' }])
    const two = confidenceOf([{ type: 'shared-tag', detail: 'a' }, { type: 'co-presence-event', detail: 'b' }])
    expect(two).toBeGreaterThan(one)
    const many = confidenceOf(Array.from({ length: 12 }, () => ({ type: 'messenger-group', detail: 'g' })))
    expect(many).toBeLessThanOrEqual(0.95)
  })
  it('my own statement sets it to 1', () => {
    expect(confidenceOf([{ type: 'stated-by-me', detail: 'friends', date: '2026-11-10' }], 'friends')).toBe(1)
  })
  it('rounds to two decimals', () => {
    const c = confidenceOf([{ type: 'shared-tag', detail: 'a' }, { type: 'shared-import', detail: 'b' }])
    expect(c).toBe(Math.round(c * 100) / 100)
  })
})

describe('relationIndex.relation', () => {
  it('two people who know each other: unknown kind plus the ring guess, "we think"', () => {
    const idx = relationIndex(input([p('a', { knows: ['b'] }), p('b')]))
    const r = idx.relation('a', 'b')
    expect(r.a).toBe('a'); expect(r.b).toBe('b')
    expect(r.sources.map((s) => s.type)).toEqual(['stated-by-me', 'inferred'])
    expect(r.kind).toBe('friends')
    expect(r.confidence).toBeGreaterThan(0.7); expect(r.confidence).toBeLessThan(1)
  })
  it('is symmetric: the pair has one relation whichever order', () => {
    const idx = relationIndex(input([p('a', { knows: ['b'] }), p('b')]))
    expect(idx.relation('b', 'a')).toEqual(idx.relation('a', 'b'))
  })
  it('the weaker ring sets the guessed kind', () => {
    const k = (ra, rb) => relationIndex(input([p('a', { ring: ra, knows: ['b'] }), p('b', { ring: rb })])).relation('a', 'b').kind
    expect(k('close', 'closest')).toBe('close-friends')
    expect(k('close', 'friend')).toBe('friends')
    expect(k('friend', 'acquaintance')).toBe('acquainted')
    expect(k('close', 'intending')).toBe('unknown')
  })
  it('two family members: family', () => {
    expect(relationIndex(input([p('a', { ring: 'family', knows: ['b'] }), p('b', { ring: 'family' })])).relation('a', 'b').kind).toBe('family')
  })
  it('a shared tag names the tag; a system import tag is a shared-import with its date', () => {
    const tags = [tag('iyg', 'IYG 2026'), tag('import:2026-11-09-google', '#import:2026-11-09-google', true)]
    const f = { iyg: 'true', 'import:2026-11-09-google': 'true' }
    const r = relationIndex(input([p('a', { fields: f }), p('b', { fields: f })], { tags })).relation('a', 'b')
    expect(r.sources.find((s) => s.type === 'shared-tag')).toMatchObject({ detail: 'IYG 2026' })
    expect(r.sources.find((s) => s.type === 'shared-import')).toMatchObject({ detail: 'google', date: '2026-11-09' })
  })
  it('a shared event and a shared group are co-presence-event and messenger-group', () => {
    const events = [{ id: 'e1', name: 'Summer camp', from: '2026-08-01' }]
    const groups = [{ id: 'g1', name: 'Signal garden', tags: [], members: ['a', 'b'], updatedAt: Date.UTC(2026, 9, 1) }]
    const r = relationIndex(input([p('a', { events: ['e1'] }), p('b', { events: ['e1'] })], { events, groups })).relation('a', 'b')
    expect(r.sources).toEqual(expect.arrayContaining([
      { type: 'co-presence-event', detail: 'Summer camp', date: '2026-08-01' },
      { type: 'messenger-group', detail: 'Signal garden', date: '2026-10-01' },
    ]))
  })
  it('a pair with no evidence at all is no relation', () => {
    expect(relationIndex(input([p('a'), p('b')])).relation('a', 'b')).toBeNull()
    expect(relationIndex(input([p('a'), p('b')])).relation('a', 'zz')).toBeNull()
  })
  it('a crowd tag (more than CROWD holders) is only weak support, never evidence on its own', () => {
    const f = { big: 'true' }
    const people = Array.from({ length: CROWD + 3 }, (_, i) => p('p' + i, { fields: f, ...(i === 0 ? { knows: ['p1'] } : {}) }))
    const idx = relationIndex(input(people, { tags: [tag('big', 'Big list')] }))
    const small = relationIndex(input([p('p0', { knows: ['p1'] }), p('p1')])).relation('p0', 'p1').confidence
    const withCrowd = idx.relation('p0', 'p1')
    expect(withCrowd.sources.some((s) => s.type === 'shared-tag')).toBe(true)
    expect(withCrowd.confidence - small).toBeLessThan(WEIGHT['shared-tag'])
    expect(idx.relation('p2', 'p3')).toBeNull()
  })
})

describe('stating a relation', () => {
  it('Correct this: stated-by-me, confidence 1, kind as told, dated', () => {
    const s = { relations: undefined }
    setStated(s, 'b', 'a', 'close-friends', Date.UTC(2026, 10, 10))
    const r = relationIndex(input([p('a', { knows: ['b'] }), p('b')], { relations: s.relations })).relation('a', 'b')
    expect(r.kind).toBe('close-friends'); expect(r.confidence).toBe(1)
    expect(r.sources[0]).toEqual({ type: 'stated-by-me', detail: 'close-friends', date: '2026-11-10' })
  })
  it('a second statement replaces the first (one per pair)', () => {
    const s = {}
    setStated(s, 'a', 'b', 'friends', 1); setStated(s, 'b', 'a', 'acquainted', 2)
    expect(s.relations).toHaveLength(1)
    expect(s.relations[0].kind).toBe('acquainted')
  })
  it('a statement alone (no Knows entry) makes a relation', () => {
    const s = {}
    setStated(s, 'a', 'b', 'colleagues', Date.UTC(2026, 10, 10))
    expect(relationIndex(input([p('a'), p('b')], { relations: s.relations })).relation('a', 'b').kind).toBe('colleagues')
  })
  it('Not related removes the relation, the line and the person-card entry; clearStated brings the guess back', () => {
    const s = {}
    const people = [p('a', { knows: ['b'] }), p('b')]
    setStated(s, 'a', 'b', 'none', 1)
    let idx = relationIndex(input(people, { relations: s.relations }))
    expect(idx.relation('a', 'b')).toBeNull()
    expect(idx.pairs()).toEqual([])
    expect(idx.of('a')).toEqual([])
    clearStated(s, 'b', 'a')
    expect(s.relations).toBeUndefined()
    idx = relationIndex(input(people, { relations: s.relations }))
    expect(idx.pairs()).toEqual([['a', 'b']])
  })
})

describe('relationIndex.pairs (the dashed lines)', () => {
  it('Knows pairs plus stated pairs, once each, never touching me', () => {
    const s = {}
    setStated(s, 'a', 'c', 'friends', 1)
    const idx = relationIndex(input([p('a', { knows: ['b', 'me'] }), p('b', { knows: ['a'] }), p('c')], { relations: s.relations }))
    expect(idx.pairs()).toEqual([['a', 'b'], ['a', 'c']])
  })
})

describe('relationIndex.of (the person card)', () => {
  it('lists everyone this person relates to, strongest first, from knows, statements and small shared groups', () => {
    const tags = [tag('small', 'Choir')]
    const s = {}
    setStated(s, 'a', 'd', 'family', 1)
    const people = [p('a', { knows: ['b'], fields: { small: 'true' } }), p('b'), p('c', { fields: { small: 'true' } }), p('d'), p('e')]
    const list = relationIndex(input(people, { tags, relations: s.relations })).of('a')
    expect(list.map((r) => (r.a === 'a' ? r.b : r.a))).toEqual(['d', 'b', 'c'])
    expect(list[0].confidence).toBe(1)
  })
  it('a big group (more than CROWD holders) does not make everyone related', () => {
    const f = { big: 'true' }
    const people = Array.from({ length: CROWD + 2 }, (_, i) => p('p' + i, { fields: f }))
    expect(relationIndex(input(people, { tags: [tag('big', 'Big')] })).of('p0')).toEqual([])
  })
})

describe('line style by kind', () => {
  it('every kind has a stroke; close friends have the shortest dashes', () => {
    for (const k of KINDS) expect(LINE_DASH[k]).toMatch(/^\d/)
    const first = (k) => Number(LINE_DASH[k].split(' ')[0])
    for (const k of KINDS.filter((x) => x !== 'close-friends')) expect(first('close-friends')).toBeLessThanOrEqual(first(k))
  })
})

describe('privacy', () => {
  it('what I said about two contacts never syncs to another device (I1)', () => {
    expect(SYNC_EXCLUDED.has('relations')).toBe(true)
  })
})
