/**
 * Scans built demo bundles for the owner's private inventory lines (digest
 * denylist, see test/helpers/private_line_guard.mjs for what it can and can not
 * catch). Build first, then:
 *   node apps/trustweb/test/scan_bundle_for_private_lines.mjs apps/trustweb/dist apps/demo/dist
 * Exit 0 = clean, 1 = a hit (the file and a digest prefix are printed, never the text), 2 = nothing scanned.
 */
import { existsSync } from 'node:fs'
import { scanDirectory } from './helpers/private_line_guard.mjs'

const dirs = process.argv.slice(2)
let files = 0
let dirty = false
for (const d of dirs) {
  if (!existsSync(d)) { console.error(`missing: ${d}`); process.exit(2) }
  const r = scanDirectory(d)
  files += r.files
  console.log(`${d}: ${r.files} text files scanned, ${r.hits.length} private-line hits`)
  for (const h of r.hits) { console.log(`  HIT ${h.file} digest ${h.digest}`); dirty = true }
}
if (files === 0) { console.error('nothing scanned'); process.exit(2) }
process.exit(dirty ? 1 : 0)
