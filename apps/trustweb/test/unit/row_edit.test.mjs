// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { archiveOf, restoreOf, dropRing, dragMovedTo } from '../../src/row_edit.ts'

const zones = [
  { ring: 'closest', left: 0, top: 0, right: 100, bottom: 50 },
  { ring: 'close', left: 0, top: 50, right: 100, bottom: 120 },
]

describe('archive and restore (row_edit.ts)', () => {
  it('archives to Ring.None and remembers the ring', () => {
    const p = { ring: 'close' }
    archiveOf(p)
    expect(p).toEqual({ ring: 'none', prevRing: 'close' })
  })
  it('archiving twice keeps the first prevRing', () => {
    const p = { ring: 'none', prevRing: 'close' }
    archiveOf(p)
    expect(p.prevRing).toBe('close')
  })
  it('restores the ring, or Unsorted when none was kept', () => {
    const p = { ring: 'none', prevRing: 'friend' }
    restoreOf(p)
    expect(p).toEqual({ ring: 'friend' })
    const q = { ring: 'none' }
    restoreOf(q)
    expect(q.ring).toBe('unsorted')
  })
})

describe('which group is under the pointer (row_edit.ts)', () => {
  it('returns the ring of the box holding the point', () => {
    expect(dropRing(zones, 10, 10)).toBe('closest')
    expect(dropRing(zones, 10, 70)).toBe('close')
  })
  it('null outside every box', () => {
    expect(dropRing(zones, 500, 10)).toBeNull()
    expect(dropRing(zones, 10, 200)).toBeNull()
  })
})

describe('drag result (row_edit.ts)', () => {
  it('moves when the ring differs, null when the same or off target', () => {
    expect(dragMovedTo('closest', 'close')).toBe('close')
    expect(dragMovedTo('close', 'close')).toBeNull()
    expect(dragMovedTo('close', null)).toBeNull()
  })
})
