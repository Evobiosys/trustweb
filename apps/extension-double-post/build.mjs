// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// node build.mjs [--out <dir>] [--test-host <match>] [--zip]
// Plain TS -> JS with the repo's vite (apps/demo), one self-contained script per entry. No new dependency.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
const out = resolve(arg('--out') ?? join(here, 'dist'))
const testHost = arg('--test-host')
const { build } = await import(pathToFileURL(join(here, '..', 'demo', 'node_modules', 'vite', 'dist', 'node', 'index.js')))

mkdirSync(out, { recursive: true })
for (const name of ['content', 'options']) {
  await build({
    configFile: false,
    logLevel: 'warn',
    root: here,
    build: {
      outDir: out,
      emptyOutDir: false,
      minify: false,
      target: 'es2020',
      lib: { entry: join(here, 'src', name + '.ts'), formats: ['iife'], name: 'dpx_' + name, fileName: () => name + '.js' },
    },
  })
}
copyFileSync(join(here, 'options.html'), join(out, 'options.html'))
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
if (testHost) manifest.content_scripts[0].matches.push(testHost) // tests only: fixture page, never in the shipped build
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
if (process.argv.includes('--zip')) {
  const zip = join(dirname(out), 'also-post-to-trustweb.zip')
  execFileSync('zip', ['-r', '-q', '-X', zip, '.'], { cwd: out })
  console.log('zip:', zip)
}
console.log('built:', out)
