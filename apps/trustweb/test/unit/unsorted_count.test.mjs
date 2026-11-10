// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { Ring } from '../../src/model.ts'
import { unsortedCount } from '../../src/unsorted_count.ts'

const p = (id, extra = {}) => ({ id, name: id, context: '', ring: Ring.Unsorted, metAt: 0, lines: [], ...extra })

describe('unsortedCount (item 8: are Tana #person imports listed?)', () => {
  it('lists Tana people on the Not yet sorted ring, with or without a suggested ring', () => {
    const s = { people: [p('tana-a'), p('tana-b', { ring: Ring.Friend, ringSuggested: true }), p('tana-c', { ring: Ring.Friend }), p('x1')] }
    const c = unsortedCount(s)
    expect(c).toMatchObject({ unsorted: 3, tana: 3, tanaUnsorted: 2 })
    expect(c.tanaLeftOut.otherRing).toBe(1)
  })
  it('names why a Tana person is left out: archived, hidden source, curator archive, expanse, blocked', () => {
    const s = {
      people: [p('tana-1', { ring: Ring.None }), p('tana-2'), p('tana-3'), p('tana-4'), p('tana-5', { blocked: 1 })],
      hiddenSources: [], expanse: ['tana-4'],
    }
    expect(unsortedCount(s, new Set(['tana-3'])).tanaLeftOut).toEqual({ archived: 1, blocked: 1, sourceHidden: 0, curatorArchive: 1, expanse: 1, otherRing: 0 })
    const hidden = unsortedCount({ people: [p('tana-1'), p('x')], hiddenSources: ['tana'] })
    expect(hidden).toMatchObject({ unsorted: 1, tana: 1, tanaUnsorted: 0 })
    expect(hidden.tanaLeftOut.sourceHidden).toBe(1)
  })
})
