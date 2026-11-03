#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The CLI's lint, dependency-free: every source, test and script file carries the licence header, and nothing in the
 * CLI can reach a network or a browser. Exit 1 with the file and the reason on the first miss. `pnpm lint` runs it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(import.meta.url), '..', '..')
const HEADER = '// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later'
/** Node modules and globals that would reach out of the machine or into a browser. */
const FORBIDDEN = [
  /from\s+['"]node:(http|https|net|dns|dgram|tls|http2)['"]/, /from\s+['"](http|https|net|dns|dgram|tls|http2)['"]/,
  /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\blocalStorage\b/, /\bwindow\./, /\bdocument\./,
]

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* files(p)
    else if (/\.(ts|mts|mjs)$/.test(name)) yield p
  }
}

let bad = 0
for (const dir of ['src', 'test', 'scripts', 'bin', 'types']) {
  for (const file of files(join(root, dir))) {
    const text = readFileSync(file, 'utf8')
    const rel = relative(root, file)
    const firstLines = text.split('\n').slice(0, 2)
    if (!firstLines.includes(HEADER)) { console.error(`${rel}: missing licence header "${HEADER}"`); bad++ }
    for (const re of FORBIDDEN) if (re.test(text)) { console.error(`${rel}: forbidden (network or browser) use: ${re}`); bad++ }
  }
}
if (bad) { console.error(`lint: ${bad} problem${bad === 1 ? '' : 's'}`); process.exit(1) }
console.log('lint: ok')
