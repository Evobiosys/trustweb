import { describe, expect, it } from 'vitest'
import { slimCountries } from '../../scripts/slim_countries.mjs'
import countries from '../../src/map/ne_110m_countries.json'
import { tilesOn } from '../../src/place_geo'
import { S } from '../../src/strings'

describe('map layer choice', () => {
  it('local unless the detailed map was chosen', () => {
    expect(tilesOn(undefined)).toBe(false)
    expect(tilesOn(false)).toBe(false)
    expect(tilesOn('true')).toBe(false)
    expect(tilesOn(true)).toBe(true)
  })
  it('the note names the mode, the detailed one names OpenStreetMap', () => {
    expect(S.desk.mapNote(false)).not.toMatch(/OpenStreetMap/)
    expect(S.desk.mapNote(true)).toMatch(/OpenStreetMap/)
  })
})

describe('slimCountries', () => {
  const fc = {
    type: 'FeatureCollection', name: 'x', features: [
      { type: 'Feature', properties: { NAME: 'A', POP: 1 }, bbox: [0, 0, 1, 1], geometry: { type: 'Polygon', coordinates: [[[1.23456, 2.3449], [3, 4.005], [1.23456, 2.3449]]] } },
      { type: 'Feature', properties: { NAME: 'B' }, geometry: { type: 'MultiPolygon', coordinates: [[[[10.111, 20.999]]]] } },
    ],
  }
  it('keeps only NAME and rounds to 2 decimals', () => {
    const out = slimCountries(fc)
    expect(out).toEqual({
      type: 'FeatureCollection', features: [
        { type: 'Feature', properties: { NAME: 'A' }, geometry: { type: 'Polygon', coordinates: [[[1.23, 2.34], [3, 4.01], [1.23, 2.34]]] } },
        { type: 'Feature', properties: { NAME: 'B' }, geometry: { type: 'MultiPolygon', coordinates: [[[[10.11, 21]]]] } },
      ],
    })
  })
  it('the bundled file is the slim one', () => {
    const fs = (countries as { features: { properties: Record<string, unknown>; geometry: { coordinates: unknown } }[] }).features
    expect(fs.length).toBeGreaterThan(150)
    expect(fs.every((f) => Object.keys(f.properties).join() === 'NAME')).toBe(true)
    const nums = JSON.stringify(fs.map((f) => f.geometry.coordinates)).match(/-?\d+(\.\d+)?/g) ?? []
    expect(nums.every((n) => !/\.\d{3}/.test(n))).toBe(true)
    expect(JSON.stringify(countries).length).toBeLessThan(200_000)
  })
})
