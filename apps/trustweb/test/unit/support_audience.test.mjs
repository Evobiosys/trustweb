// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39: one audience control for "Ask for support": a zone or tag, Closest few always in, people filtered in and out. */
import { audience } from '../../src/support_ask.ts'
import { Ring } from '../../src/model.ts'

const p = (id, ring, extra = {}) => ({ id, name: id, ring, peerId: 'peer-' + id, fields: {}, ...extra })
const people = [p('a', Ring.Closest), p('b', Ring.Close), p('c', Ring.Friend), p('d', Ring.Acquaintance), p('e', Ring.Friend, { fields: { yoga: 'true' } }), p('f', Ring.Acquaintance, { fields: { yoga: 'true' } }), { id: 'g', name: 'g', ring: Ring.Closest, fields: {} }]
const ids = (l) => l.map((x) => x.id)

describe('audience', () => {
  it('Closest few is always in, whatever the zone', () => {
    expect(ids(audience(people, { zone: 'ring:close' }))).toEqual(['a', 'b'])
    expect(ids(audience(people, { zone: 'ring:closest' }))).toEqual(['a'])
    expect(ids(audience(people, { zone: 'ring:friend' }))).toEqual(['a', 'b', 'c', 'e'])
  })

  it('a tag adds its holders up to Friends, Closest few stay in', () => {
    expect(ids(audience(people, { zone: 'tag:yoga' }, (x, t) => x.fields?.[t] === 'true'))).toEqual(['a', 'e'])
  })

  it('"not Closest few" drops them, also from a wider zone, unless listed in include', () => {
    expect(ids(audience(people, { zone: 'ring:close', notClosest: true }))).toEqual(['b'])
    expect(ids(audience(people, { zone: 'tag:yoga', notClosest: true }, (x, t) => x.fields?.[t] === 'true'))).toEqual(['e'])
    expect(ids(audience(people, { zone: 'ring:close', notClosest: true, include: ['a'] }))).toEqual(['a', 'b'])
  })

  it('include adds any connected person; exclude wins over everything', () => {
    expect(ids(audience(people, { zone: 'ring:closest', include: ['d', 'g'] }))).toEqual(['a', 'd'])
    expect(ids(audience(people, { zone: 'ring:close', include: ['d'], exclude: ['a', 'd'] }))).toEqual(['b'])
  })

  it('an unknown zone falls back to Closest few only', () => {
    expect(ids(audience(people, { zone: 'everyone' }))).toEqual(['a'])
    expect(ids(audience(people, { zone: 'ring:acquaintance' }))).toEqual(['a'])
  })
})
