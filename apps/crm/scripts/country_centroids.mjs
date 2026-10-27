// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Centroid [lat, lon] per country of the bundled Natural Earth outline: the centroid of its largest polygon's outer ring (mainland, not overseas parts).
// Run once: node scripts/country_centroids.mjs src/map/ne_110m_countries.json src/map/country_centroids.json
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const round = (n) => Math.round(n * 10) / 10

/** Shoelace area (signed) and centroid of one ring of [lon, lat] points. */
function ring(r) {
  let a = 0, x = 0, y = 0
  for (let i = 0; i < r.length - 1; i++) {
    const [x0, y0] = r[i], [x1, y1] = r[i + 1]
    const c = x0 * y1 - x1 * y0
    a += c; x += (x0 + x1) * c; y += (y0 + y1) * c
  }
  return a === 0 ? { area: 0, lon: r[0][0], lat: r[0][1] } : { area: Math.abs(a / 2), lon: x / (3 * a), lat: y / (3 * a) }
}

export function centroidsOf(fc) {
  const out = {}
  for (const f of fc.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    const big = polys.map((p) => ring(p[0])).sort((a, b) => b.area - a.area)[0]
    out[f.properties.NAME] = [round(big.lat), round(big.lon)]
  }
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [src, out] = process.argv.slice(2)
  writeFileSync(out, JSON.stringify(centroidsOf(JSON.parse(readFileSync(src, 'utf8')))))
}
