// Natural Earth 110m countries (public domain) slimmed for the Desk's local map: NAME only, coordinates rounded to 2 decimals.
// Run once: node scripts/slim_countries.mjs <ne_110m_admin_0_countries.geojson> src/map/ne_110m_countries.json
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const round = (c) => Array.isArray(c) ? c.map(round) : Math.round(c * 100) / 100

export function slimCountries(fc) {
  return { type: 'FeatureCollection', features: fc.features.map((f) => ({ type: 'Feature', properties: { NAME: f.properties.NAME }, geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) } })) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2)
  writeFileSync(out, JSON.stringify(slimCountries(JSON.parse(readFileSync(src, 'utf8')))))
}
