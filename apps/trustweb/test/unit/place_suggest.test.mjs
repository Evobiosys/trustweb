// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 map-view: place suggestions from the offline table, writing a person's place, the pins and the projection. */
import { PLACE_SUGGEST_MAX, clearPlace, pinGroups, placeSuggest, project, setPlace } from '../../src/place_suggest.ts'

describe('placeSuggest', () => {
  it('suggests by prefix, cities first', () => {
    const hits = placeSuggest('Lin')
    expect(hits[0].name).toBe('Linz')
    expect(hits[0].lat).toBeCloseTo(48.3, 0)
  })
  it('ignores case and accents, folds umlauts', () => {
    expect(placeSuggest('koln')[0].name).toBe('Köln')
    expect(placeSuggest('MUENCHEN')[0].name).toBe('Munich')
    expect(placeSuggest('osterreich')[0].name).toBe('Austria')
  })
  it('finds a country by its German name and a capital as its country', () => {
    expect(placeSuggest('Schweiz')[0].name).toBe('Switzerland')
  })
  it('caps at six and returns nothing for an empty or unknown query', () => {
    expect(PLACE_SUGGEST_MAX).toBe(6)
    expect(placeSuggest('a').length).toBeLessThanOrEqual(6)
    expect(placeSuggest('  ')).toEqual([])
    expect(placeSuggest('qqqzzz')).toEqual([])
  })
  it('forgives one typo from four letters', () => {
    expect(placeSuggest('Vienn').map((h) => h.name)).toContain('Vienna')
    expect(placeSuggest('Barcelnoa').length).toBe(0)
    expect(placeSuggest('Parsi').map((h) => h.name)).toContain('Paris')
  })
  it('lists a place once', () => {
    const names = placeSuggest('s').map((h) => h.name)
    expect(new Set(names).size).toBe(names.length)
  })
})

describe('setPlace / clearPlace', () => {
  const hit = { name: 'Linz', lat: 48.3, lon: 14.29 }
  it('writes the place with source gazetteer and returns the previous one for undo', () => {
    const p = { id: 'a' }
    expect(setPlace(p, hit)).toBeUndefined()
    expect(p.place).toEqual({ ...hit, source: 'gazetteer' })
    const before = setPlace(p, { name: 'Graz', lat: 47.07, lon: 15.44 })
    expect(before.name).toBe('Linz')
    setPlace(p, before)
    expect(p.place.name).toBe('Linz')
  })
  it('clears the place; setting undefined restores "no place"', () => {
    const p = { id: 'a', place: { ...hit, source: 'gazetteer' } }
    const before = clearPlace(p)
    expect('place' in p).toBe(false)
    setPlace(p, before)
    expect(p.place.name).toBe('Linz')
    setPlace(p, undefined)
    expect('place' in p).toBe(false)
  })
})

describe('pinGroups', () => {
  it('groups people at the same spot, skips people without a place', () => {
    const at = { name: 'Linz', lat: 48.3, lon: 14.29, source: 'gazetteer' }
    const g = pinGroups([{ id: 'a', name: 'Ann', place: at }, { id: 'b', name: 'Bo', place: at }, { id: 'c', name: 'Cy' }])
    expect(g).toHaveLength(1)
    expect(g[0].people.map((p) => p.id)).toEqual(['a', 'b'])
    expect(g[0].place).toBe('Linz')
  })
})

describe('project', () => {
  it('maps lon/lat equirectangular into the box', () => {
    expect(project(0, 0, 360, 180)).toEqual({ x: 180, y: 90 })
    expect(project(90, -180, 360, 180)).toEqual({ x: 0, y: 0 })
    expect(project(-90, 180, 360, 180)).toEqual({ x: 360, y: 180 })
  })
})
