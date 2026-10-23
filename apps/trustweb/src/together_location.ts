/**
 * Wave 16: where to play. The map is behind ONE interface so any library (or none) plugs in later: Jakob 2026-10-18 "I'm not super
 * happy with [the map libraries I used before], but I'd like to reuse the same code and then potentially just swap it out." No map code
 * exists in this repo or under SingularStructure yet, so the first picker is the text one: the person's words are the place, a radius
 * is the reach, and coordinates are optional. Only the label ever leaves the phone (together_request.ts).
 * Pure and DOM-free.
 */
export interface Place {
  /** What the person calls it; the only part an ask carries. */
  label: string
  /** Optional, for a picker that knows them; stay on this phone. */
  lat?: number
  lon?: number
}

/** Swap point: a map picker implements this and nothing else changes. */
export interface LocationPicker {
  /** Resolves the words of a request (or a tap on a map) to a place. Null: not found, the caller keeps the words. */
  pick(areaText: string): Promise<Place | null>
}

/** The dependency-free picker: the words are the place. */
export const textPicker: LocationPicker = {
  pick: async (areaText) => (areaText.trim() ? { label: areaText.trim() } : null),
}

const EARTH_KM = 6371

const isCoord = (p: Place): p is Place & { lat: number; lon: number } =>
  typeof p.lat === 'number' && typeof p.lon === 'number' && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180

/** Great-circle distance, or null when either place has no coordinates. */
export function distanceKm(a: Place, b: Place): number | null {
  if (!isCoord(a) || !isCoord(b)) return null
  const rad = (d: number) => (d * Math.PI) / 180
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1)

/**
 * Is `there` within `radiusKm` of `here`? With coordinates on both: distance. Without: the places count as near when they share a word
 * ("Wien 7" and "Wien" do; "Graz" and "Wien" do not), which errs towards asking rather than missing a game.
 */
export function isNear(here: Place, there: Place, radiusKm: number): boolean {
  const d = distanceKm(here, there)
  if (d !== null) return d <= radiusKm
  const a = new Set(words(here.label))
  return words(there.label).some((w) => a.has(w))
}
