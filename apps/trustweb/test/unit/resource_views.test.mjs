// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b resources-views: kinds, filters, sections, outliner/by-person grouping, protected items, recommender detection (src/resource_views.ts). */
import {
  RESOURCE_KINDS, kindOf, isProtected, filterResources, splitSections, groupOutliner, groupByPerson, selectableResources, copyAllText, canShareOn,
  detectRecommender, setKind, setRecommender, acceptRecommender, dismissRecommender, revealNext, listResources, PROTECTED_LINK_ONE_AT_A_TIME,
} from '../../src/resource_views.ts'

const it1 = (id, over = {}) => ({ id, text: `Item ${id}`, audience: 'friends', included: true, createdAt: 1, ...over })
const tags = [{ id: 'c1', colour: '#111', label: 'Forum', community: true }, { id: 'c2', colour: '#222', label: 'Closed', community: true, protected: true }]
const people = [{ id: 'a', name: 'Ada Lovelace' }, { id: 'b', name: 'Ben Huber' }, { id: 'c', name: 'Brené Brown' }]

describe('kind', () => {
  it('lists the kinds and old items are "other"', () => {
    expect(RESOURCE_KINDS).toEqual(['book', 'publication', 'reference', 'recording', 'link', 'other'])
    expect(kindOf(it1('x'))).toBe('other')
    expect(kindOf(it1('x', { kind: 'book' }))).toBe('book')
  })
})

describe('protected', () => {
  it('an item is protected by its own flag or by its community tag', () => {
    expect(isProtected(it1('x'), tags)).toBe(false)
    expect(isProtected(it1('x', { protected: true }), tags)).toBe(true)
    expect(isProtected(it1('x', { communityId: 'c2' }), tags)).toBe(true)
    expect(isProtected(it1('x', { communityId: 'c1' }), tags)).toBe(false)
  })
  it('cannot be shared on', () => {
    expect(canShareOn(it1('x', { protected: true }), tags)).toBe(false)
    expect(canShareOn(it1('y'), tags)).toBe(true)
  })
  it('selection model and copy-all leave protected items out', () => {
    const all = [it1('1'), it1('2', { protected: true }), it1('3', { communityId: 'c2' })]
    expect(selectableResources(all, tags).map((i) => i.id)).toEqual(['1'])
    expect(copyAllText(all, tags)).toBe('Item 1')
  })
  it('the link shows one item at a time', () => {
    expect(PROTECTED_LINK_ONE_AT_A_TIME).toBe(true)
    expect(revealNext(null, 'a')).toBe('a')
    expect(revealNext('a', 'b')).toBe('b')
    expect(revealNext('b', 'b')).toBeNull()
  })
})

describe('filters and sections', () => {
  const all = [
    it1('1', { kind: 'book', sharedBy: 'a', communityId: 'c1' }),
    it1('2', { kind: 'recording', communityId: 'c2' }),
    it1('3', { kind: 'book', recommendedBy: 'b' }),
    it1('4'),
  ]
  it('filters by kind, sharedBy and community; empty filter keeps all', () => {
    expect(filterResources(all, {}).length).toBe(4)
    expect(filterResources(all, { kind: 'book' }).map((i) => i.id)).toEqual(['1', '3'])
    expect(filterResources(all, { sharedBy: 'a' }).map((i) => i.id)).toEqual(['1'])
    expect(filterResources(all, { communityId: 'c2' }).map((i) => i.id)).toEqual(['2'])
    expect(filterResources(all, { kind: 'book', communityId: 'c1' }).map((i) => i.id)).toEqual(['1'])
  })
  it('My Resources vs Suggested by others', () => {
    const s = splitSections(all)
    expect(s.mine.map((i) => i.id)).toEqual(['2', '3', '4'])
    expect(s.suggested.map((i) => i.id)).toEqual(['1'])
  })
  it('outliner groups community > kind > item; no community last', () => {
    const g = groupOutliner(all, tags)
    expect(g.map((c) => c.label)).toEqual(['Forum', 'Closed', ''])
    expect(g[0].kinds[0]).toMatchObject({ kind: 'book' })
    expect(g[0].kinds[0].items.map((i) => i.id)).toEqual(['1'])
    expect(g[2].kinds.map((k) => k.kind)).toEqual(['book', 'other'])
  })
  it('by person groups on sharedBy, else recommendedBy, else nobody', () => {
    const g = groupByPerson(all)
    expect(g.map((x) => [x.person, x.items.map((i) => i.id)])).toEqual([['a', ['1']], ['b', ['3']], ['', ['2', '4']]])
  })
})

describe('detectRecommender', () => {
  const d = (t, author) => detectRecommender(t, people, author)?.personId ?? null
  it('en', () => { expect(d('Cosmos, recommended by Ada Lovelace')).toBe('a'); expect(d('Dune by Ben Huber')).toBe('b') })
  it('de', () => { expect(d('Momo, empfohlen von Ben Huber')).toBe('b'); expect(d('Buch von Ada Lovelace')).toBe('a') })
  it('fr', () => { expect(d('Le Petit Prince, recommandé par Ada Lovelace')).toBe('a'); expect(d('Livre par Ben Huber')).toBe('b') })
  it('es', () => { expect(d('Rayuela, recomendado por Ben Huber')).toBe('b'); expect(d('Libro por Ada Lovelace')).toBe('a') })
  it('it', () => { expect(d('Il nome della rosa, consigliato da Ada Lovelace')).toBe('a'); expect(d('Libro raccomandato da Ben Huber')).toBe('b') })
  it('pt', () => { expect(d('Ensaio sobre a cegueira, recomendado por Ada Lovelace')).toBe('a'); expect(d('Livro indicado por Ben Huber')).toBe('b') })
  it('is case and accent tolerant', () => { expect(d('x EMPFOHLEN VON ben huber')).toBe('b'); expect(d('x by brene brown')).toBe('c') })
  it('matches a first name only when it is unique', () => {
    expect(d('Momo, empfohlen von Ada')).toBe('a')
    expect(detectRecommender('x by Ben', [...people, { id: 'z', name: 'Ben Other' }])).toBeNull()
  })
  it('no suggestion when the match is the author', () => {
    expect(d('Braving the Wilderness by Brené Brown', 'Brené Brown')).toBeNull()
    expect(d('Braving the Wilderness, recommended by Ada Lovelace', 'Brené Brown')).toBe('a')
  })
  it('no suggestion without a known person or a preposition', () => {
    expect(d('Dune by Frank Herbert')).toBeNull()
    expect(d('Ada Lovelace wrote notes')).toBeNull()
  })
  it('prefers the explicit "recommended" wording over a bare "by"', () => {
    expect(detectRecommender('Dune by Ben Huber, recommended by Ada Lovelace', people)).toMatchObject({ personId: 'a', explicit: true })
  })
  it('returns the name for the chip', () => { expect(detectRecommender('x by Ben Huber', people)).toMatchObject({ personId: 'b', name: 'Ben Huber', explicit: false }) })
})

describe('record changes', () => {
  it('setKind / setRecommender / accept / dismiss', () => {
    const rec = { inventory: [it1('1', { text: 'Dune, recommended by Ada Lovelace' })] }
    expect(setKind(rec, '1', 'book')).toBe(true)
    expect(rec.inventory[0].kind).toBe('book')
    expect(() => setKind(rec, '1', 'nope')).toThrow(/kind/)
    expect(() => setKind(rec, 'zz', 'book')).toThrow(/no resource/)
    expect(setRecommender(rec, '1', 'b')).toBe(true)
    expect(rec.inventory[0].recommendedBy).toBe('b')
    expect(setRecommender(rec, '1', '')).toBe(true)
    expect(rec.inventory[0].recommendedBy).toBeUndefined()
    expect(acceptRecommender(rec, '1', people)).toBe('a')
    expect(rec.inventory[0].recommendedBy).toBe('a')
    const r2 = { inventory: [it1('2', { text: 'Dune by Ben Huber' })] }
    expect(dismissRecommender(r2, '2')).toBe(true)
    expect(r2.inventory[0].recommenderDismissed).toBe(true)
  })
})

describe('listResources (MCP)', () => {
  const all = [it1('1', { kind: 'book', sharedBy: 'a', communityId: 'c1', protected: true, link: 'https://x.org' }), it1('2', { kind: 'recording' })]
  it('flat list with filters; protected items never carry their link', () => {
    const out = listResources(all, tags, { kind: 'book' })
    expect(out.items.map((i) => i.id)).toEqual(['1'])
    expect(out.items[0]).toMatchObject({ protected: true, kind: 'book' })
    expect(out.items[0].link).toBeUndefined()
    expect(listResources(all, tags, { sharedBy: 'a' }).items.length).toBe(1)
  })
  it('view: outliner and person return groups', () => {
    expect(listResources(all, tags, { view: 'outliner' }).groups[0]).toHaveProperty('label')
    expect(listResources(all, tags, { view: 'person' }).groups[0]).toHaveProperty('person')
    expect(() => listResources(all, tags, { view: 'x' })).toThrow(/view/)
  })
})
