// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { centroidsOf } from '../../scripts/country_centroids.mjs'
import { citiesOf } from '../../scripts/city_table.mjs'
import cities from '../../src/map/cities.json'
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

describe('city table', () => {
  it('covers Austrian cities over 20,000 and the 60 biggest EU cities, each with lat/lon and a name', () => {
    expect(cities.length).toBeGreaterThanOrEqual(80)
    for (const [lat, lon, name] of cities) {
      expect(typeof name).toBe('string')
      expect(lat).toBeGreaterThan(34)
      expect(lat).toBeLessThan(70)
      expect(lon).toBeGreaterThan(-12)
      expect(lon).toBeLessThan(35)
    }
  })
  it('the generator keeps Austrian cities by name, the 60 biggest EU cities by population, and skips city districts', () => {
    const row = (name: string, cc: string, pop: number, code = 'PPL'): string => ['1', name, name, '', '48.123', '14.456', 'P', code, cc, '', '', '', '', '', pop].join('\t')
    const rows = [row('Vienna', 'AT', 1e6), row('Wels', 'AT', 5e4), row('Hinterdorf', 'AT', 3e4), row('Favoriten', 'AT', 2e5, 'PPLX'), row('Berlin', 'DE', 3e6), row('Springfield', 'US', 9e6)]
    for (let i = 0; i < 60; i++) rows.push(row(`Big${i}`, 'FR', 1e6 - i))
    const out = citiesOf(rows.join('\n'))
    const names = out.map((c) => c[2])
    expect(names).toContain('Wels')
    expect(names).toContain('Berlin')
    expect(names).toContain('Big56')
    expect(names).not.toContain('Hinterdorf')
    expect(names).not.toContain('Favoriten')
    expect(names).not.toContain('Springfield')
    expect(out.find((c) => c[2] === 'Vienna')).toEqual([48.12, 14.46, 'Vienna', 'Wien'])
  })
})

describe('approxOf', () => {
  it('Wien, Vienna, Austria and Österreich share one centroid', () => {
    const at = approxOf('Austria')
    expect(at).not.toBeNull()
    for (const p of ['Österreich', 'oesterreich', '  AUSTRIA ']) expect(approxOf(p)).toEqual(at)
    expect(at!.lat).toBeGreaterThan(46)
    expect(at!.lat).toBeLessThan(49)
    expect(at!.lon).toBeGreaterThan(9)
    expect(at!.lon).toBeLessThan(17.5)
  })
  it('takes a country or capital out of a longer text, the last part first', () => {
    expect(approxOf('Berlin, Deutschland')).toEqual(approxOf('Berlin'))
    expect(approxOf('Berlin')).not.toEqual(approxOf('Wien'))
    expect(approxOf('Tokio, Japan')).toEqual(approxOf('Japan'))
  })
  it('a city wins over its country, wherever it stands in the text', () => {
    const near = (p: string, lat: number, lon: number): void => {
      const at = approxOf(p)
      expect(at, p).not.toBeNull()
      expect(Math.abs(at!.lat - lat), p).toBeLessThan(0.1)
      expect(Math.abs(at!.lon - lon), p).toBeLessThan(0.1)
    }
    near('Linz', 48.31, 14.29)
    near('Linz, Austria', 48.31, 14.29)
    near('Austria / Linz', 48.31, 14.29)
    near('Graz', 47.07, 15.44)
    near('Salzburg, Österreich', 47.8, 13.04)
    near('Wels', 48.16, 14.03)
    near('Mödling', 48.09, 16.29)
    expect(approxOf('Linz')).not.toEqual(approxOf('Austria'))
  })
  it('English and German names, case and diacritics read alike', () => {
    for (const [a, b] of [['Wien', 'Vienna'], ['Wien', 'wien'], ['Muenchen', 'München'], ['Munich', 'MÜNCHEN'], ['Koeln', 'Köln'], ['Cologne', 'Köln'], ['Prag', 'Prague'], ['Lissabon', 'Lisbon'], ['Krakau', 'Krakow'], ['St. Pölten', 'Sankt Pölten'], ['Klagenfurt', 'Klagenfurt am Wörthersee']])
      expect(approxOf(a), `${a} / ${b}`).toEqual(approxOf(b))
    expect(approxOf('Wien')).not.toBeNull()
  })
  it('big EU cities not in Austria resolve to themselves, not to a country centroid', () => {
    for (const [city, country] of [['Marseille', 'France'], ['Barcelona', 'Spain'], ['Gdańsk', 'Poland'], ['Hamburg', 'Germany'], ['Milano', 'Italy']])
      expect(approxOf(city), city).not.toEqual(approxOf(country))
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
    { place: 'Graz, Austria', people: [person('d')] },
    { place: 'Zorbonia', people: [person('e'), person('f')] },
  ]
  it('approximate pins merge per centroid; the unmatched count people, not places', () => {
    const { pins, unplaced } = pinsOf(groups, {})
    expect(unplaced).toBe(2)
    expect(pins).toHaveLength(2)
    expect(pins[0]).toMatchObject({ approx: true, place: 'Wien, Vienna' })
    expect(pins[0].people.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(pins[1]).toMatchObject({ approx: true, place: 'Graz, Austria' })
  })
  it('a precise geocode replaces the approximate dot of that place only', () => {
    const { pins, unplaced } = pinsOf(groups, { wien: { lat: 48.2, lon: 16.37, at: 1 } })
    expect(unplaced).toBe(2)
    const precise = pins.find((p) => !p.approx)
    expect(precise).toMatchObject({ place: 'Wien', lat: 48.2, lon: 16.37 })
    expect(pins.find((p) => p.approx)?.people.map((p) => p.id)).toEqual(['b', 'c'])
  })
  it('a precise geocode places a name the gazetteer does not know', () => {
    const { pins, unplaced } = pinsOf(groups, { zorbonia: { lat: 1, lon: 2, at: 1 } })
    expect(unplaced).toBe(0)
    expect(pins.filter((p) => !p.approx).map((p) => p.place)).toEqual(['Zorbonia'])
  })
})
