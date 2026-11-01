// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 share page: the page state, its share line, and the preview that equals enforcement (T12). */
import { DEFAULT_ZONE, ZONE_CHOICES, initial, withChip, withoutChip, suggest, candidates, storeOf, previewOf, shareItem, seenBy } from '../../src/share_page.ts'
import { canAccess } from '../../src/share_sink/check.ts'
import { Ring } from '../../src/model.ts'

const NOW = new Date('2026-10-31T10:00:00.000Z')
const P = (id, name, ring, fields) => ({ id, name, ring, ...(fields && { fields }) })
const tags = [{ id: 'garden', colour: '#00aa00', label: 'garden' }]
const basis = (shares) => ({
  people: [P('ada', 'Ada', Ring.Friend), P('bo', 'Bo', Ring.Acquaintance, { garden: 'true' }), P('cy', 'Cy', Ring.Close), P('di', 'Di', Ring.Friend)],
  tags,
  ...(shares && { shares }),
})

describe('page state', () => {
  it('defaults to Acquaintance; the ladder offers Public..Closest, not Self', () => {
    expect(DEFAULT_ZONE).toBe('acquaintance')
    expect(initial().zone).toBe('acquaintance')
    expect(ZONE_CHOICES.map(String)).toEqual(['public', 'intending', 'acquaintance', 'community', 'friend', 'close', 'closest'])
  })
  it('a chip sits in one row only: adding to Except takes it out of Also, no duplicates', () => {
    let s = withChip(initial(), 'include', 'person:ada')
    s = withChip(s, 'include', 'person:ada')
    expect(s.include).toEqual(['person:ada'])
    s = withChip(s, 'exclude', 'person:ada')
    expect(s).toMatchObject({ include: [], exclude: ['person:ada'] })
    expect(withoutChip(s, 'exclude', 'person:ada').exclude).toEqual([])
  })
})

describe('typeahead over people and tags (fuzzy)', () => {
  it('finds a tag by its plural, a tag by prefix and a person by name, never one already chosen', () => {
    const c = candidates(basis())
    expect(suggest('gardens', c, []).map((x) => x.id)).toContain('tag:garden')
    expect(suggest('ad', c, []).map((x) => x.id)).toContain('person:ada')
    expect(suggest('gard', c, []).map((x) => x.id)).toContain('tag:garden')
    expect(suggest('ada', c, ['person:ada']).map((x) => x.id)).not.toContain('person:ada')
  })
})

describe('selection -> share line, and the check decides (T1, T12)', () => {
  const pick = (zone, ex) => ({ zone, include: [], exclude: ex })
  it('Friend zone with one @person exclusion: exclusion beats zone, preview == enforcement', () => {
    const scope = pick('friend', ['person:ada'])
    const pv = previewOf(basis(), scope, 'bike', NOW)
    expect(pv.names).toEqual(['Cy', 'Di'])
    expect(pv.count).toBe(2)
    const shares = shareItem(basis(), 'bike', scope, NOW)
    expect(shares).toHaveLength(1)
    expect(shares[0]).toMatchObject({ op: 'share', id: 'item:bike', scope, terms: 'read-keep' })
    const store = storeOf(basis(shares))
    const enforced = ['ada', 'bo', 'cy', 'di'].filter((id) => canAccess(store, `person:${id}`, 'item:bike', NOW).allowed)
    expect(enforced).toEqual(['cy', 'di'])
    expect(enforced.length).toBe(pv.count)
  })
  it('inclusion beats zone: a tag lets Bo in below the zone, an exclusion still beats the inclusion', () => {
    expect(previewOf(basis(), { zone: 'friend', include: ['tag:garden'], exclude: [] }, 'bike', NOW).names).toEqual(['Ada', 'Bo', 'Cy', 'Di'])
    expect(previewOf(basis(), { zone: 'friend', include: ['tag:garden'], exclude: ['person:bo'] }, 'bike', NOW).names).toEqual(['Ada', 'Cy', 'Di'])
  })
  it('a second share of the same item replaces the first (latest line wins)', () => {
    const one = shareItem(basis(), 'bike', pick('close', []), NOW)
    const two = shareItem(basis(one), 'bike', pick('friend', []), NOW)
    expect(two).toHaveLength(2)
    expect(storeOf(basis(two)).filter((t) => t.relation === 'may_read' && t.object === 'item:bike').map((t) => t.subject)).toEqual(['zone:friend'])
  })
})

describe('person card line', () => {
  it('lists the shared things a person can see, by the same check', () => {
    const shares = shareItem(basis(), 'bike', { zone: 'friend', include: [], exclude: ['person:ada'] }, NOW)
    expect(seenBy(basis(shares), 'cy', NOW)).toEqual(['bike'])
    expect(seenBy(basis(shares), 'ada', NOW)).toEqual([])
  })
})
