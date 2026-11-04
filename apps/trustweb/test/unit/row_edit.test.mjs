// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { dropRing, dragMovedTo } from '../../src/row_edit.ts'
import { archivePerson, archivedPeople, restorePerson } from '../../src/archived_people.ts'

const zones = [
  { ring: 'closest', left: 0, top: 0, right: 100, bottom: 50 },
  { ring: 'close', left: 0, top: 50, right: 100, bottom: 120 },
]

describe('archive from a People row (archived_people.ts)', () => {
  it('a row archive lands in the Settings list and restores', () => {
    const p = { id: 'a', name: 'a', ring: 'close' }
    archivePerson(p)
    expect(archivedPeople([p])).toEqual([p])
    restorePerson(p)
    expect(p).toEqual({ id: 'a', name: 'a', ring: 'close' })
    expect(archivedPeople([p])).toEqual([])
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
