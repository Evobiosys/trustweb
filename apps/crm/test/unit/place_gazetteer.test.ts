// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { centroidsOf } from '../../scripts/country_centroids.mjs'
import countries from '../../src/map/ne_110m_countries.json'
import centroids from '../../src/map/country_centroids.json'
import { approxOf, pinsOf } from '../../src/place_gazetteer'

describe('country centroids', () => {
  it('the committed table equals what the bundled outline yields', () => expect(centroids).toEqual(centroidsOf(countries)))
  it('a square polygon centres on itself; the biggest part of a multipolygon wins', () => {
    const sq = (x: number, s: number): number[][][] => [[[x, 0], [x + s, 0], [x + s, s], [x, s], [x, 0]]]
    const fc = { features: [{ properties: { NAME: 'A' }, geometry: { type: 'Polygon', coordinates: sq(10, 4) } }, { properties: { NAME: 'B' }, geometry: { type: 'MultiPolygon', coordinates: [sq(0, 1), sq(20, 6)] } }] }
    expect(centroidsOf(fc)).toEqual({ A: [2, 12], B: [3, 23] })
  })
})

describe('approxOf', () => {
  it('Wien, Vienna, Austria and Österreich share one centroid', () => {
    const at = approxOf('Austria')
    expect(at).not.toBeNull()
    for (const p of ['Wien', 'Vienna', 'Österreich', 'oesterreich', '  AUSTRIA ']) expect(approxOf(p)).toEqual(at)
    expect(at!.lat).toBeGreaterThan(46)
    expect(at!.lat).toBeLessThan(49)
    expect(at!.lon).toBeGreaterThan(9)
    expect(at!.lon).toBeLessThan(17.5)
  })
  it('takes a country or capital out of a longer text, the last part first', () => {
    expect(approxOf('Graz, Austria')).toEqual(approxOf('Wien'))
    expect(approxOf('Vienna, Austria')).toEqual(approxOf('Austria'))
    expect(approxOf('Berlin')).toEqual(approxOf('Deutschland'))
    expect(approxOf('Berlin')).not.toEqual(approxOf('Wien'))
  })
  it('unknown or empty is null', () => {
    expect(approxOf('Zorbonia')).toBeNull()
    expect(approxOf('')).toBeNull()
    expect(approxOf('   ')).toBeNull()
  })
})

describe('pinsOf', () => {
  const person = (id: string): { id: string; name: string; initials: string } => ({ id, name: id, initials: id.toUpperCase() })
  const groups = [
    { place: 'Wien', people: [person('a')] },
    { place: 'Vienna', people: [person('b'), person('c')] },
    { place: 'Graz', people: [person('d')] },
    { place: 'Zorbonia', people: [person('e'), person('f')] },
  ]
  it('approximate pins merge per centroid; the unmatched count people, not places', () => {
    const { pins, unplaced } = pinsOf(groups, {})
    expect(unplaced).toBe(2)
    expect(pins).toHaveLength(1)
    expect(pins[0]).toMatchObject({ approx: true, place: 'Wien, Vienna, Graz' })
    expect(pins[0].people.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd'])
  })
  it('a precise geocode replaces the approximate dot of that place only', () => {
    const { pins, unplaced } = pinsOf(groups, { wien: { lat: 48.2, lon: 16.37, at: 1 } })
    expect(unplaced).toBe(2)
    const precise = pins.find((p) => !p.approx)
    expect(precise).toMatchObject({ place: 'Wien', lat: 48.2, lon: 16.37 })
    expect(pins.find((p) => p.approx)?.people.map((p) => p.id)).toEqual(['b', 'c', 'd'])
  })
  it('a precise geocode places a name the gazetteer does not know', () => {
    const { pins, unplaced } = pinsOf(groups, { zorbonia: { lat: 1, lon: 2, at: 1 } })
    expect(unplaced).toBe(0)
    expect(pins.filter((p) => !p.approx).map((p) => p.place)).toEqual(['Zorbonia'])
  })
})
