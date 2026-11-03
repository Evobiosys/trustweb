// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29 zone-tags: tags on a zone (src/zone_tags.ts): add, create on the fly, remove, autocomplete. Pure. */
import { addZoneTag, removeZoneTag, suggestZoneTags, zoneTagIds } from '../../src/zone_tags.ts'

const defined = () => [{ id: 'family', colour: '#7b1fa2', label: 'family' }, { id: 'club', colour: '#111111', label: 'Chess Club' }]

describe('zone tags', () => {
  it('absent = none', () => expect(zoneTagIds({}, 'friend')).toEqual([]))
  it('adds a defined tag by label, case-insensitive, with a stamp', () => {
    const rec = {}
    const out = addZoneTag(rec, defined(), 'friend', ' chess club ', 5)
    expect(out.created).toBe(false)
    expect(zoneTagIds(rec, 'friend')).toEqual(['club'])
    expect(rec.zoneTags.friend.stamp).toBe(5)
  })
  it('creates a new tag on the fly and adds it', () => {
    const rec = {}
    const out = addZoneTag(rec, defined(), 'friend', 'Book Group', 1)
    expect(out.created).toBe(true)
    expect(out.tags).toHaveLength(3)
    const t = out.tags[2]
    expect(t.label).toBe('Book Group')
    expect(t.colour).toMatch(/^#[0-9a-f]{6}$/i)
    expect(defined().some((d) => d.id === t.id)).toBe(false)
    expect(zoneTagIds(rec, 'friend')).toEqual([t.id])
  })
  it('does not add twice or add an empty name', () => {
    const rec = {}
    addZoneTag(rec, defined(), 'friend', 'family', 1)
    addZoneTag(rec, defined(), 'friend', 'Family', 2)
    expect(zoneTagIds(rec, 'friend')).toEqual(['family'])
    expect(addZoneTag(rec, defined(), 'friend', '   ', 3).tags).toEqual(defined())
  })
  it('zones keep separate sets', () => {
    const rec = {}
    addZoneTag(rec, defined(), 'friend', 'family', 1)
    expect(zoneTagIds(rec, 'close')).toEqual([])
  })
  it('remove drops the tag from the zone only; the tag stays defined', () => {
    const rec = {}
    addZoneTag(rec, defined(), 'friend', 'family', 1)
    addZoneTag(rec, defined(), 'close', 'family', 1)
    removeZoneTag(rec, 'friend', 'family', 9)
    expect(zoneTagIds(rec, 'friend')).toEqual([])
    expect(zoneTagIds(rec, 'close')).toEqual(['family'])
    expect(rec.zoneTags.friend.stamp).toBe(9)
  })
  it('autocomplete: unused defined tags matching the text, prefix first', () => {
    const rec = {}
    const tags = [...defined(), { id: 'cl', colour: '#222222', label: 'Acclaim' }]
    addZoneTag(rec, tags, 'friend', 'family', 1)
    expect(suggestZoneTags(rec, tags, 'friend', 'cl').map((t) => t.id)).toEqual(['club', 'cl'])
    expect(suggestZoneTags(rec, tags, 'friend', '').map((t) => t.id)).toEqual(['club', 'cl'])
    expect(suggestZoneTags(rec, tags, 'friend', 'fam')).toEqual([])
  })
})
