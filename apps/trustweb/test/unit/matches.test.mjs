// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Matches view (src/matches.ts): grouping by offer, the live merge of polled lines, the feedback line. */
import { groupMatches, mergeIncoming, parseLines, dismissMatch, matchKey } from '../../src/matches.ts'

const m = (over) => ({ personId: 'p1', offerId: 'o1', need: 'needs a space', pays: 'self', confidence: 0.5, next: 'Write', at: 1, ...over })

describe('matches', () => {
  it('groups by offer, highest confidence first, offers in catalogue order, unknown offers last', () => {
    const offers = [{ id: 'o1', title: 'Rooms' }, { id: 'o2', title: 'Tools' }]
    const g = groupMatches([m({ personId: 'a', confidence: 0.4 }), m({ personId: 'b', offerId: 'o2' }), m({ personId: 'c', confidence: 0.9 }), m({ personId: 'd', offerId: 'gone' })], offers)
    expect(g.map((x) => x.title)).toEqual(['Rooms', 'Tools', 'gone'])
    expect(g[0].items.map((i) => i.personId)).toEqual(['c', 'a'])
  })
  it('hides dismissed matches', () => {
    expect(groupMatches([m({ status: 'dismissed' })], [])).toEqual([])
  })
  it('merges incoming lines by person/community + offer, keeping the answered state, newer content wins', () => {
    const old = [m({ status: 'dismissed', confidence: 0.3 }), m({ personId: 'z' })]
    const r = mergeIncoming(old, [m({ confidence: 0.8, at: 5 }), m({ communityId: 'c1', personId: undefined })])
    expect(r.changed).toBe(true)
    expect(r.items).toHaveLength(3)
    const same = r.items.find((x) => matchKey(x) === 'p1|o1')
    expect(same).toMatchObject({ confidence: 0.8, at: 5, status: 'dismissed' })
  })
  it('reports no change when the lines are already known', () => {
    const old = [m()]
    const r = mergeIncoming(old, [m()])
    expect(r.changed).toBe(false)
    expect(r.items).toBe(old)
  })
  it('parses JSONL lines, skipping broken or incomplete ones', () => {
    expect(parseLines([JSON.stringify(m()), '{oops', JSON.stringify({ offerId: 'o1' }), JSON.stringify(m({ confidence: 7 }))])).toHaveLength(1)
  })
  it('dismissing sets the status and returns the feedback line', () => {
    const x = m()
    const fb = dismissMatch(x, 99)
    expect(x.status).toBe('dismissed')
    expect(fb).toEqual({ key: 'p1|o1', verdict: 'not_relevant', at: 99 })
  })
})
