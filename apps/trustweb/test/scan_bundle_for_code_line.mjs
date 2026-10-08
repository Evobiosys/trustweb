/**
 * Proves the "You can read the open source code on GitHub." sentence is (or is not) in a built bundle (wave 6e, E2 S4).
 *   node apps/trustweb/test/scan_bundle_for_code_line.mjs <dist> [--expect-present]
 * Default: the sentence must be ABSENT (a build made without VITE_TW_CODE_PUBLIC=1). With --expect-present: it must be there (a build made
 * with VITE_TW_CODE_PUBLIC=1). The word "GitHub" alone is not the test: the demo inventory mentions it in an unrelated line.
 * Exit 0 = as expected, 1 = not as expected, 2 = nothing scanned.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const SENTENCE = 'You can read the open source code on GitHub.'
const [dir, flag] = process.argv.slice(2)
const expectPresent = flag === '--expect-present'

function* walk(d) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(js|html|css|json|txt|map)$/.test(f)) yield p
  }
}

if (!dir || !existsSync(dir)) { console.error(`missing: ${dir}`); process.exit(2) }
let files = 0
const hits = []
for (const f of walk(dir)) { files++; if (readFileSync(f, 'utf8').includes(SENTENCE)) hits.push(f) }
if (files === 0) { console.error('nothing scanned'); process.exit(2) }
const ok = expectPresent ? hits.length > 0 : hits.length === 0
console.log(`${dir}: ${files} files scanned, the sentence is in ${hits.length} of them; expected ${expectPresent ? 'present' : 'absent'}: ${ok ? 'OK' : 'NOT AS EXPECTED'}`)
process.exit(ok ? 0 : 1)
