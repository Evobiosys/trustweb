// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 27 (map-view): place suggestions from the offline table (data/places.ts), a person's place, the map pins and the projection. Pure, no DOM. */
import { CITIES, COUNTRY_CENTROIDS, COUNTRY_NAMES } from './data/places'
import type { Person } from './model'

export const PLACE_SUGGEST_MAX = 6

export interface PlaceHit { name: string; lat: number; lon: number }
/** Person.place: where the owner put them on the map. Owner's own devices only. */
export type PersonPlace = PlaceHit & { source: 'gazetteer' }

/** Case, accents and umlaut spellings fold together ("Zürich" = "zurich" = "zuerich"). */
export function placeKey(s: string): string {
  return s.trim().toLocaleLowerCase().replace(/ß/g, 'ss').normalize('NFKD').replace(/\p{M}/gu, '').replace(/oe/g, 'o').replace(/ae/g, 'a').replace(/ue/g, 'u')
}

interface Entry extends PlaceHit { keys: string[]; city: boolean }

let index: Entry[] | null = null
function entries(): Entry[] {
  if (index) return index
  const list: Entry[] = CITIES.map(([lat, lon, name, ...more]) => ({ name, lat, lon, keys: [name, ...more].map(placeKey), city: true }))
  const aliases = new Map<string, string[]>()
  for (const line of COUNTRY_NAMES) { const [country, ...rest] = line.split('|'); aliases.set(country, rest) }
  for (const [name, [lat, lon]] of Object.entries(COUNTRY_CENTROIDS)) list.push({ name, lat, lon, keys: [name, ...(aliases.get(name) ?? [])].map(placeKey), city: false })
  index = list
  return list
}

/** Edit distance 1 (replace, add, drop) between the query and the same-length start of a name. */
function oneOff(q: string, k: string): boolean {
  const near = (a: string, b: string): boolean => {
    let i = 0
    while (i < a.length && a[i] === b[i]) i++
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
    return a.length === b.length + 1 && a.slice(i + 1) === b.slice(i)
  }
  return near(q, k.slice(0, q.length)) || near(q, k.slice(0, q.length - 1)) || near(k.slice(0, q.length + 1), q)
}

/** 0 exact, 1 prefix, 2 word prefix, 3 inside, 4 one typo (4+ letters), -1 no match. */
function score(q: string, keys: string[]): number {
  let best = -1
  const take = (n: number): void => { if (best < 0 || n < best) best = n }
  for (const k of keys) {
    if (k === q) return 0
    if (k.startsWith(q)) take(1)
    else if (k.split(/[\s,.-]+/).some((w) => w.startsWith(q))) take(2)
    else if (k.includes(q)) take(3)
    else if (q.length >= 4 && oneOff(q, k)) take(4)
  }
  return best
}

/** Up to six places for what was typed: best match first, a city before a country, each place once. */
export function placeSuggest(query: string): PlaceHit[] {
  const q = placeKey(query)
  if (!q) return []
  const hits: { e: Entry; s: number }[] = []
  for (const e of entries()) { const s = score(q, e.keys); if (s >= 0) hits.push({ e, s }) }
  hits.sort((a, b) => a.s - b.s || Number(b.e.city) - Number(a.e.city) || a.e.name.localeCompare(b.e.name))
  const seen = new Set<string>()
  const out: PlaceHit[] = []
  for (const { e } of hits) {
    if (seen.has(e.name)) continue
    seen.add(e.name)
    out.push({ name: e.name, lat: e.lat, lon: e.lon })
    if (out.length === PLACE_SUGGEST_MAX) break
  }
  return out
}

/** Writes (or, with undefined, removes) a person's place; returns the previous one so a caller can undo with setPlace(p, previous). */
export function setPlace(p: Pick<Person, 'place'>, to: PlaceHit | undefined): PersonPlace | undefined {
  const before = p.place
  if (to) p.place = { name: to.name, lat: to.lat, lon: to.lon, source: 'gazetteer' }
  else delete p.place
  return before
}

export const clearPlace = (p: Pick<Person, 'place'>): PersonPlace | undefined => setPlace(p, undefined)

export interface PinGroup { place: string; lat: number; lon: number; people: { id: string; name: string }[] }

/** People with a place, grouped by spot (same coordinates share one dot). */
export function pinGroups(people: readonly Pick<Person, 'id' | 'name' | 'place'>[]): PinGroup[] {
  const groups = new Map<string, PinGroup>()
  for (const { id, name, place } of people) {
    if (!place) continue
    const key = `${place.lat},${place.lon}`
    const g = groups.get(key)
    if (g) g.people.push({ id, name })
    else groups.set(key, { place: place.name, lat: place.lat, lon: place.lon, people: [{ id, name }] })
  }
  return [...groups.values()]
}

/** Equirectangular: longitude -180..180 to 0..w, latitude 90..-90 to 0..h. */
export function project(lat: number, lon: number, w: number, h: number): { x: number; y: number } {
  return { x: ((lon + 180) / 360) * w, y: ((90 - lat) / 180) * h }
}
