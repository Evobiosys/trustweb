// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: Person.links, the messenger links typed on the card (person_links.ts). */
import { LINK_KINDS, setLink, linkEntries } from '../../src/person_links.ts'

describe('person links', () => {
  it('stores a trimmed https link per kind and lists it', () => {
    const p = {}
    expect(setLink(p, 'signal', '  https://signal.me/#p/+4366012345  ')).toBe(true)
    expect(p.links).toEqual({ signal: 'https://signal.me/#p/+4366012345' })
    expect(linkEntries(p)).toEqual([{ kind: 'signal', url: 'https://signal.me/#p/+4366012345' }])
  })
  it('refuses what is not an http(s) link and keeps the old value', () => {
    const p = { links: { whatsapp: 'https://wa.me/4366012345' } }
    expect(setLink(p, 'whatsapp', 'javascript:alert(1)')).toBe(false)
    expect(setLink(p, 'other', 'not a link')).toBe(false)
    expect(p.links).toEqual({ whatsapp: 'https://wa.me/4366012345' })
  })
  it('an empty value clears only that field; the last one removes links', () => {
    const p = { links: { signal: 'https://signal.me/x', other: 'https://example.org/a' } }
    expect(setLink(p, 'signal', '')).toBe(true)
    expect(p.links).toEqual({ other: 'https://example.org/a' })
    setLink(p, 'other', ' ')
    expect('links' in p).toBe(false)
    expect(setLink(p, 'signal', '')).toBe(false)
  })
  it('knows three kinds', () => { expect(LINK_KINDS).toEqual(['signal', 'whatsapp', 'other']) })
})
