// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { archivePerson, archivedPeople, restorePerson } from '../../src/archived_people.ts'

const p = (id, ring) => ({ id, name: id, ring })

describe('archived people', () => {
  it('archive sets Ring.None and remembers the ring', () => {
    const a = p('a', 'close')
    archivePerson(a)
    expect(a.ring).toBe('none')
    expect(a.prevRing).toBe('close')
  })
  it('archiving twice keeps the first previous ring', () => {
    const a = p('a', 'close')
    archivePerson(a); archivePerson(a)
    expect(a.prevRing).toBe('close')
  })
  it('restore puts them back and drops the memory', () => {
    const a = p('a', 'friend')
    archivePerson(a); restorePerson(a)
    expect(a.ring).toBe('friend')
    expect('prevRing' in a).toBe(false)
  })
  it('restore without a previous ring goes to Not yet sorted', () => {
    const a = p('a', 'none')
    restorePerson(a)
    expect(a.ring).toBe('unsorted')
  })
  it('lists only archived people', () => {
    expect(archivedPeople([p('a', 'none'), p('b', 'close')]).map((x) => x.id)).toEqual(['a'])
  })
})
