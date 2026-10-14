/** "Close to me": a person is close when a chosen place field names one of my places. Text only, no geocoding, no network. Pure. */
import { valueText } from './fields'
import type { FieldValues } from './fields'

export interface Close {
  /** Each place is a country, region, city, or a corridor as ordered cities: "Vienna - Graz - Ljubljana". */
  places: string[]
  /** Place fields that count. */
  fields: string[]
}

/** Schema fields that name a place. "Location of Birth" is not in the Tana schema yet. */
export const PLACE_FIELDS: readonly { id: string; label: string; on: boolean }[] = [
  { id: 'xu0y_4Pu3sOL', label: 'Residing in', on: true },
  { id: 'Hy23JQYtvEKW', label: 'can host in', on: true },
]

export const emptyClose = (): Close => ({ places: [], fields: PLACE_FIELDS.filter((f) => f.on).map((f) => f.id) })

/** Jakob's own set, preloaded only with the dev record (prefs.svelte.ts); never a default. Corridors are Austrian railway stations. */
export const DEV_CLOSE: Close = {
  places: [
    'Vienna', 'Graz',
    'Südbahn: Wien - Mödling - Baden - Wiener Neustadt - Neunkirchen - Mürzzuschlag - Kapfenberg - Bruck an der Mur - Graz',
    'Thermenbahn: Wien - Wiener Neustadt - Aspang - Friedberg - Hartberg - Fürstenfeld - Fehring - Feldbach',
    'Ostbahn: Graz - Gleisdorf - Feldbach',
    'Vienna direct ≤1 h: St. Pölten, Tulln, Krems, Stockerau, Hollabrunn, Mödling, Baden, Wiener Neustadt, Bratislava',
  ],
  fields: emptyClose().fields,
}

/** A corridor's stops (an optional "Name:" label dropped; separated by spaced dashes, arrows or commas), or the one name of a plain place. */
export function stops(place: string): string[] {
  return place.replace(/^[^:]*:\s*/, '').split(/\s+[-–—>→]+\s+|\s*[→>,]\s*/).map((s) => s.trim().toLowerCase()).filter(Boolean)
}

export function isClose(values: FieldValues, close: Close): boolean {
  const names = close.places.flatMap(stops)
  return close.fields.some((k) => {
    const text = valueText(values[k]).toLowerCase()
    return text !== '' && names.some((n) => text.includes(n))
  })
}
