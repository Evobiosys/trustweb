// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// City table for the Desk map: every Austrian city over 20,000 people plus the 60 biggest cities of the EU, as [lat, lon, name, ...aliases].
// Source: GeoNames cities1000 (https://download.geonames.org/export/dump/cities1000.zip), CC BY 4.0, https://www.geonames.org. Coordinates rounded to 2 decimals.
// Run once: node scripts/city_table.mjs cities1000.txt src/map/cities.json
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Austrian cities over 20,000 people (Statistik Austria 2024); the GeoNames population column is too stale to cut on (it lists Wels at 16,857). */
const AT = new Set(['Vienna', 'Graz', 'Linz', 'Salzburg', 'Innsbruck', 'Klagenfurt am Wörthersee', 'Villach', 'Wels', 'Sankt Pölten', 'Dornbirn', 'Wiener Neustadt', 'Steyr', 'Feldkirch', 'Bregenz', 'Leonding', 'Klosterneuburg', 'Baden', 'Wolfsberg', 'Leoben', 'Krems an der Donau', 'Traun', 'Amstetten', 'Lustenau', 'Kapfenberg', 'Mödling', 'Hallein', 'Kufstein', 'Traiskirchen', 'Schwechat'])
const EU = new Set('AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE'.split(' '))
/** German and English names the GeoNames primary name lacks, keyed by that primary name. */
const ALIASES = {
  Vienna: ['Wien'], Munich: ['München'], Cologne: ['Köln'], Prague: ['Prag'], Warsaw: ['Warschau'], Brussels: ['Brüssel'], Lisbon: ['Lissabon'],
  Copenhagen: ['Kopenhagen'], Athens: ['Athen'], Bucharest: ['Bukarest'], Rome: ['Rom', 'Roma'], Milan: ['Mailand', 'Milano'], Turin: ['Torino'],
  Köln: ['Cologne'], Sevilla: ['Seville'], Naples: ['Neapel', 'Napoli'],  Gothenburg: ['Göteborg'], Florence: ['Florenz', 'Firenze'], Venice: ['Venedig'],
  'Sankt Pölten': ['St. Pölten'], Genoa: ['Genua'], Nuremberg: ['Nürnberg'], Hanover: ['Hannover'], Antwerp: ['Antwerpen'], Gdańsk: ['Danzig'],
  Wrocław: ['Breslau'], Kraków: ['Krakau', 'Cracow'], Bratislava: ['Pressburg'], Ljubljana: ['Laibach'], Zagreb: ['Agram'],
  Luxembourg: ['Luxemburg'], Nicosia: ['Nikosia'], Bruges: ['Brügge'], 'The Hague': ['Den Haag'], 'Klagenfurt am Wörthersee': ['Klagenfurt'],
  'Frankfurt am Main': ['Frankfurt'],
}
const r2 = (n) => Math.round(n * 100) / 100

/** Rows of a GeoNames dump -> table sorted by population, biggest first (so the biggest wins a shared name). */
export function citiesOf(text) {
  const rows = text.split('\n').filter(Boolean).map((l) => l.split('\t')).filter((c) => EU.has(c[8]) && c[7] !== 'PPLX')
    .map((c) => ({ name: c[1], ascii: c[2], lat: +c[4], lon: +c[5], cc: c[8], pop: +c[14] }))
    .sort((a, b) => b.pop - a.pop)
  return rows.filter((c, i) => i < 60 || (c.cc === 'AT' && AT.has(c.name)))
    .map((c) => [r2(c.lat), r2(c.lon), c.name, ...new Set([c.ascii, ...(ALIASES[c.name] ?? [])].filter((a) => a !== c.name))])
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2)
  writeFileSync(out, JSON.stringify(citiesOf(readFileSync(src, 'utf8')), null, 0).replace(/\],\[/g, '],\n[') + '\n')
}
