// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The CLI package's lint, dependency-free:
 *   1. every source, test and script file carries the SPDX licence header;
 *   2. no network: nothing the CLI runs (bin/, src/, and every module they import at runtime, the share sink included) names
 *      a network API;
 *   3. src/ stays pure: no console (output goes through Io), no clock or randomness of its own (the clock is passed in).
 * Usage: node scripts/lint.mjs [package-dir]. Exits 1 with one line per finding.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** The package to check: the argument (the tests point it at a fixture), else this package. */
const ROOT = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'))
const SPDX = '// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later'
const NETWORK = [/\bfetch\s*\(/, /\bWebSocket\b/, /\bXMLHttpRequest\b/, /\bEventSource\b/, /navigator\.sendBeacon/, /['"]node:(http|https|http2|net|dgram|tls|dns|child_process|worker_threads)['"]/, /['"](http|https|net|dgram|tls|dns)['"]/]
const IMPURE = [[/\bconsole\./, 'console (write through Io)'], [/\bDate\.now\s*\(/, 'Date.now (take the clock from Io)'], [/new Date\(\)/, 'new Date() (take the clock from Io)'], [/\bMath\.random\b/, 'Math.random']]

const findings = []
const files = (dir) => !existsSync(join(ROOT, dir)) ? [] : readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(ts|mjs)$/.test(e.name) ? [join(ROOT, dir, e.name)] : []))
const rel = (f) => relative(ROOT, f)

// 1. licence header (after a shebang, if any)
for (const f of ['src', 'bin', 'test', 'scripts'].flatMap(files)) {
  const lines = readFileSync(f, 'utf8').split('\n')
  if ((lines[0].startsWith('#!') ? lines[1] : lines[0]) !== SPDX) findings.push(`${rel(f)}: missing the SPDX header`)
}

// 2. no network, over the runtime import graph of bin/ and src/
const runtimeImports = (source) => [...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\sfrom\s+)?['"](\.{1,2}\/[^'"]+)['"]/gm), ...source.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => m[1])
const resolveSpec = (from, spec) => [spec, `${spec}.ts`].map((s) => resolve(dirname(from), s)).find((p) => existsSync(p) && /\.(ts|mjs|js)$/.test(p))
const seen = new Set()
const queue = [...files('bin'), ...files('src')]
while (queue.length) {
  const f = queue.shift()
  if (seen.has(f)) continue
  seen.add(f)
  const source = readFileSync(f, 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const re of NETWORK) if (re.test(code)) findings.push(`${rel(f)}: names a network API (${re})`)
  for (const spec of runtimeImports(source)) {
    const target = resolveSpec(f, spec)
    if (target) queue.push(target)
    else findings.push(`${rel(f)}: cannot resolve ${spec}`)
  }
}

// 3. src/ is pure
for (const f of files('src')) {
  const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  for (const [re, what] of IMPURE) if (re.test(code)) findings.push(`${rel(f)}: ${what}`)
}

if (findings.length) {
  process.stderr.write(`${findings.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write(`lint: ${seen.size} runtime modules checked, no network API; headers and purity ok\n`)
