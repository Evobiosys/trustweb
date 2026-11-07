// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The two bins shown while a dot is held (src/drag_bins.ts). */
import { binDrop, binAt } from '../../src/drag_bins.ts'

describe('drag bins', () => {
  it('archive files the person away and asks nothing', () => {
    expect(binDrop('archive', { id: 'a' })).toEqual({ do: 'archive', id: 'a' })
  })
  it('remove deletes at once (reversible for 30 days, so no question)', () => {
    expect(binDrop('remove', { id: 'a' })).toEqual({ do: 'remove', id: 'a' })
  })
  it('finds the bin under the pointer', () => {
    const boxes = [{ kind: 'archive', left: 0, top: 0, right: 44, bottom: 44 }, { kind: 'remove', left: 68, top: 0, right: 112, bottom: 44 }]
    expect(binAt(boxes, 80, 10)).toBe('remove')
    expect(binAt(boxes, 50, 10)).toBeNull()
  })
})
