import { describe, expect, it } from 'vitest'
import { EUROPE, GEO_GAP_MS, centreOf, geocodeQueue, geocodeUrl, geoKey, parseHit, uncached } from '../../src/place_geo'

describe('place_geo cache', () => {
  const cache = { vienna: { lat: 48.2, lon: 16.37, at: 1 } }
  it('keys ignore case, accents and padding', () => expect(geoKey('  Wien ')).toBe(geoKey('wien')))
  it('hit and miss', () => {
    expect(uncached(cache, ['Vienna', 'Graz'])).toEqual(['Graz'])
  })
  it('never expires', () => expect(uncached({ vienna: { lat: 1, lon: 1, at: 0 } }, ['Vienna'])).toEqual([]))
})

describe('geocode request', () => {
  it('carries the place name only', () => {
    const u = new URL(geocodeUrl('Graz'))
    expect(u.origin).toBe('https://nominatim.openstreetmap.org')
    expect([...u.searchParams.keys()].sort()).toEqual(['format', 'limit', 'q'])
    expect(u.searchParams.get('q')).toBe('Graz')
  })
  it('parses the first hit, rejects junk', () => {
    expect(parseHit([{ lat: '47.07', lon: '15.44' }])).toEqual({ lat: 47.07, lon: 15.44 })
    expect(parseHit([])).toBeNull()
    expect(parseHit([{ lat: 'x', lon: '1' }])).toBeNull()
    expect(parseHit([{ lat: '95', lon: '1' }])).toBeNull()
    expect(parseHit(null)).toBeNull()
  })
})

describe('geocode queue: 1 request per second', () => {
  it('spaces back-to-back taps by the gap', async () => {
    let clock = 0
    const starts: number[] = []
    const q = geocodeQueue({
      now: () => clock,
      sleep: async (ms) => { clock += ms },
      lookup: async (p) => { starts.push(clock); return { lat: p.length, lon: 0 } },
    })
    const r = await Promise.all([q.add('a'), q.add('bb'), q.add('ccc')])
    expect(r.map((x) => x?.lat)).toEqual([1, 2, 3])
    expect(starts).toEqual([0, GEO_GAP_MS, 2 * GEO_GAP_MS])
  })
  it('a failing lookup yields null and does not stall the queue', async () => {
    const q = geocodeQueue({ now: () => 0, sleep: async () => {}, lookup: async (p) => { if (p === 'bad') throw new Error('x'); return { lat: 1, lon: 2 } } })
    expect(await Promise.all([q.add('bad'), q.add('ok')])).toEqual([null, { lat: 1, lon: 2 }])
  })
  it('cancel drops what waits', async () => {
    const q = geocodeQueue({ now: () => 0, sleep: async () => {}, lookup: async () => ({ lat: 1, lon: 1 }) })
    expect(await q.add('a')).toEqual({ lat: 1, lon: 1 })
    const waiting = q.add('b')
    q.cancel()
    expect(await waiting).toBeNull()
  })
})

describe('map centre rule', () => {
  const geo = { graz: { lat: 47, lon: 15, at: 1 } }
  it('own position first', () => expect(centreOf([{ at: 1, activity: 'x', lat: 1, lon: 2 }], geo, ['Graz'])).toEqual({ lat: 1, lon: 2, zoom: 10 }))
  it('else the first located place', () => expect(centreOf([], geo, ['Wien', 'Graz'])).toEqual({ lat: 47, lon: 15, zoom: 6 }))
  it('else Europe', () => expect(centreOf([], {}, ['Wien'])).toEqual(EUROPE))
  it('ignores prefs without coordinates', () => expect(centreOf([{ at: 1, activity: 'x' }], {}, [])).toEqual(EUROPE))
})
