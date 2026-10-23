/**
 * Places on the Desk map: the place names are looked up at OpenStreetMap (Nominatim) only when the owner taps Locate; the answer is
 * kept per place on this device (prefs.geo, no expiry). Pure and DOM-free: the network call is injected.
 */
import { norm } from './contacts'
import type { TogetherPref } from '../../trustweb/src/together_prefs'

export interface Geo {
  lat: number
  lon: number
  at: number
}
export type GeoCache = Record<string, Geo>
export interface View {
  lat: number
  lon: number
  zoom: number
}

/** Nominatim's usage policy: at most one request per second. */
export const GEO_GAP_MS = 1000
/** The detailed (OpenStreetMap tiles) layer only after an explicit choice; anything else = the bundled local outline. */
export const tilesOn = (saved: unknown): boolean => saved === true
export const EUROPE: View = { lat: 48, lon: 14, zoom: 4 }

export const geoKey = (place: string): string => norm(place.trim())

export const uncached = (cache: GeoCache, places: readonly string[]): string[] => places.filter((p) => !cache[geoKey(p)])

/** The place name alone: never a person name or any other field. */
export const geocodeUrl = (place: string): string => `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ format: 'jsonv2', limit: '1', q: place })}`

export function parseHit(json: unknown): { lat: number; lon: number } | null {
  const hit: unknown = Array.isArray(json) ? json[0] : null
  if (typeof hit !== 'object' || hit === null) return null
  const { lat, lon } = hit as Record<string, unknown>
  const la = Number(lat)
  const lo = Number(lon)
  return Number.isFinite(la) && Number.isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180 ? { lat: la, lon: lo } : null
}

export interface QueueDeps {
  now(): number
  sleep(ms: number): Promise<void>
  lookup(place: string): Promise<{ lat: number; lon: number } | null>
}

/** Taps queue up; lookups start at least GEO_GAP_MS apart. A failed lookup resolves null. `cancel` drops what still waits. */
export function geocodeQueue(d: QueueDeps): { add(place: string): Promise<{ lat: number; lon: number } | null>; cancel(): void } {
  let tail: Promise<unknown> = Promise.resolve()
  let lastStart = -Infinity
  let epoch = 0
  return {
    add(place) {
      const mine = epoch
      const run = async (): Promise<{ lat: number; lon: number } | null> => {
        if (mine !== epoch) return null
        const wait = lastStart + GEO_GAP_MS - d.now()
        if (wait > 0) await d.sleep(wait)
        if (mine !== epoch) return null
        lastStart = d.now()
        try { return await d.lookup(place) } catch { return null }
      }
      const result = tail.then(run)
      tail = result
      return result
    },
    cancel() { epoch++ },
  }
}

/** Own position (together prefs with coordinates) first, else the first located place, else Europe. */
export function centreOf(prefs: readonly TogetherPref[], geo: GeoCache, places: readonly string[]): View {
  const own = prefs.find((p) => p.lat !== undefined && p.lon !== undefined)
  if (own?.lat !== undefined && own.lon !== undefined) return { lat: own.lat, lon: own.lon, zoom: 10 }
  const first = places.map((p) => geo[geoKey(p)]).find(Boolean)
  return first ? { lat: first.lat, lon: first.lon, zoom: 6 } : EUROPE
}

/** One Nominatim lookup for a place name; null when nothing is found or the service refuses. */
export async function fetchPlace(place: string): Promise<{ lat: number; lon: number } | null> {
  const r = await fetch(geocodeUrl(place), { headers: { Accept: 'application/json' } })
  return r.ok ? parseHit(await r.json()) : null
}
