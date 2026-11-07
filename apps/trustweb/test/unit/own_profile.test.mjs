// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { sectionsByZone } from '../../src/own_profile.ts'
import { setScope } from '../../src/profile.ts'

const NOW = new Date('2026-11-07T12:00:00Z')
const basis = { people: [], tags: [] }

describe('own profile page (own_profile.ts)', () => {
  it('lists, per trust zone, the sections that zone sees', () => {
    const p = { norms: [] }
    setScope(p, 'about', { zone: 'friend', include: [], exclude: [] })
    setScope(p, 'contact', { zone: 'close', include: [], exclude: [] })
    setScope(p, 'work', { zone: 'self', include: [], exclude: [] })
    const by = sectionsByZone(p, basis, NOW)
    expect(Object.keys(by)).toEqual(['close', 'friend', 'acquaintance', 'intending', 'public'])
    expect(by.close).toContain('contact')
    expect(by.close).toContain('about')
    expect(by.friend).toContain('about')
    expect(by.friend).not.toContain('contact')
    expect(by.public).not.toContain('about')
    for (const z of Object.keys(by)) expect(by[z]).not.toContain('work')
  })
  it('a closer zone never sees less than a farther one', () => {
    const by = sectionsByZone({ norms: [] }, basis, NOW)
    expect(by.public.every((k) => by.close.includes(k))).toBe(true)
  })
})
