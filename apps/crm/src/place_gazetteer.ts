// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Offline first placement for the Desk map: a place text that names a country or its capital (English or German) gets the centroid of that
 * country from the bundled Natural Earth outline, so dots show at once and nothing is sent. Precise geocodes (prefs.geo) replace them.
 */
import { norm } from './contacts'
import centroids from './map/country_centroids.json'
import { geoKey } from './place_geo'
import type { GeoCache } from './place_geo'
import type { Pin } from './place_map'

/** Natural Earth name | other names and capital, German and English. Matching ignores case and diacritics; "ö" also reads as "oe". */
const NAMES = [
  'Austria|Österreich|Wien|Vienna|Graz|Linz|Salzburg|Innsbruck',
  'Germany|Deutschland|Berlin|München|Munich|Hamburg|Köln|Cologne|Frankfurt',
  'Switzerland|Schweiz|Suisse|Bern|Zürich|Zurich|Genf|Geneva',
  'Italy|Italien|Italia|Rom|Rome|Roma|Mailand|Milan',
  'France|Frankreich|Paris',
  'Spain|Spanien|España|Madrid|Barcelona',
  'Portugal|Lissabon|Lisbon',
  'United Kingdom|UK|Great Britain|England|Scotland|Vereinigtes Königreich|Großbritannien|London',
  'Ireland|Irland|Dublin',
  'Netherlands|Niederlande|Holland|Amsterdam',
  'Belgium|Belgien|Brüssel|Brussels',
  'Luxembourg|Luxemburg',
  'Denmark|Dänemark|Kopenhagen|Copenhagen',
  'Sweden|Schweden|Stockholm',
  'Norway|Norwegen|Oslo',
  'Finland|Finnland|Helsinki',
  'Iceland|Island|Reykjavik',
  'Poland|Polen|Warschau|Warsaw',
  'Czechia|Czech Republic|Tschechien|Prag|Prague',
  'Slovakia|Slowakei|Bratislava|Pressburg',
  'Hungary|Ungarn|Budapest',
  'Slovenia|Slowenien|Ljubljana|Laibach',
  'Croatia|Kroatien|Zagreb',
  'Serbia|Serbien|Belgrad|Belgrade',
  'Bosnia and Herz.|Bosnia|Bosnien|Sarajevo',
  'Montenegro|Podgorica',
  'North Macedonia|Nordmazedonien|Macedonia|Skopje',
  'Albania|Albanien|Tirana',
  'Greece|Griechenland|Athen|Athens',
  'Bulgaria|Bulgarien|Sofia',
  'Romania|Rumänien|Bukarest|Bucharest',
  'Moldova|Moldawien|Chisinau',
  'Ukraine|Kiew|Kyiv|Kiev',
  'Belarus|Weißrussland|Belarus|Minsk',
  'Lithuania|Litauen|Vilnius',
  'Latvia|Lettland|Riga',
  'Estonia|Estland|Tallinn',
  'Russia|Russland|Moskau|Moscow',
  'Turkey|Türkei|Turkiye|Ankara|Istanbul',
  'Cyprus|Zypern|Nikosia|Nicosia',
  'United States of America|USA|US|United States|Vereinigte Staaten|Washington|New York',
  'Canada|Kanada|Ottawa|Toronto',
  'Mexico|Mexiko',
  'Brazil|Brasilien|Brasilia',
  'Argentina|Argentinien|Buenos Aires',
  'Chile|Santiago',
  'Colombia|Kolumbien|Bogota',
  'Peru|Lima',
  'China|Peking|Beijing',
  'Japan|Tokio|Tokyo',
  'South Korea|Südkorea|Korea|Seoul',
  'India|Indien|Neu-Delhi|New Delhi|Delhi',
  'Indonesia|Indonesien|Jakarta',
  'Thailand|Bangkok',
  'Vietnam|Hanoi',
  'Israel|Jerusalem|Tel Aviv',
  'Egypt|Ägypten|Kairo|Cairo',
  'Morocco|Marokko|Rabat',
  'South Africa|Südafrika|Kapstadt|Cape Town|Pretoria',
  'Kenya|Kenia|Nairobi',
  'Nigeria|Abuja|Lagos',
  'Australia|Australien|Canberra|Sydney',
  'New Zealand|Neuseeland|Wellington',
]

const ESZETT = /ß/g
const key = (s: string): string => norm(s.trim().replace(ESZETT, 'ss')).replace(/oe/g, 'o').replace(/ae/g, 'a').replace(/ue/g, 'u')

const CENTROID = centroids as unknown as Record<string, [number, number]>
const BY_NAME = new Map<string, readonly [number, number]>()
for (const name of Object.keys(centroids)) BY_NAME.set(key(name), CENTROID[name])
for (const line of NAMES) {
  const [country, ...names] = line.split('|')
  const at = CENTROID[country]
  for (const n of names) BY_NAME.set(key(n), at)
  BY_NAME.set(key(country), at)
}

/** Coarse position of a place text ("Wien", "Graz, Austria"): the last comma/slash part that names a known country or capital wins. */
export function approxOf(place: string): { lat: number; lon: number } | null {
  const whole = key(place)
  const parts = [whole, ...place.split(/[,/;(|]|\s-\s/).map(key).reverse()]
  for (const p of parts) {
    const at = p && BY_NAME.get(p.replace(/[)]/g, '').trim())
    if (at) return { lat: at[0], lon: at[1] }
  }
  return null
}

interface Person {
  id: string
  name: string
  initials: string
}

/** Precise pins (prefs.geo) first; every other group with a coarse match joins one approximate pin per centroid; the rest count as people not placed yet. */
export function pinsOf(groups: readonly { place: string; people: Person[] }[], geo: GeoCache): { pins: Pin[]; unplaced: number } {
  const pins: Pin[] = []
  const coarse = new Map<string, Pin>()
  let unplaced = 0
  for (const g of groups) {
    const precise = geo[geoKey(g.place)]
    const at = precise ?? approxOf(g.place)
    if (!at) { unplaced += g.people.length; continue }
    if (precise) { pins.push({ place: g.place, lat: at.lat, lon: at.lon, people: g.people }); continue }
    const id = `${at.lat},${at.lon}`
    const one = coarse.get(id)
    if (one) { one.place += `, ${g.place}`; one.people.push(...g.people) } else coarse.set(id, { place: g.place, lat: at.lat, lon: at.lon, people: [...g.people], approx: true })
  }
  return { pins: [...pins, ...coarse.values()], unplaced }
}
