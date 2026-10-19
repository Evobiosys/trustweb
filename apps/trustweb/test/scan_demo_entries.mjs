// The demo pages must never load the app's own entry chunk (main-*.js): it boots the whole app, finds no #app on a demo page and
// throws, so the page stays blank (live 2026-10-19: Rolldown had put a helper the walkthrough needs into main's chunk).
// Follows every static import from each demo page's scripts. CI runs it after the build:
//   node apps/trustweb/test/scan_demo_entries.mjs apps/trustweb/dist
import { readFileSync } from 'node:fs'
import path from 'node:path'

const dist = process.argv[2]
if (!dist) { console.error('usage: scan_demo_entries.mjs <dist>'); process.exit(2) }
const PAGES = ['demo/index.html', 'ea-demo/index.html', 'emergent-demo/index.html', 'solo.html']
const MAIN = /^main-[\w-]+\.js$/

/** Every chunk a page loads before its own code runs: its script and modulepreload tags, then their static imports. */
function loaded(page) {
  const html = readFileSync(path.join(dist, page), 'utf8')
  const todo = [...html.matchAll(/(?:src|href)="\/(?:[\w-]+\/)*assets\/([\w-]+\.js)"/g)].map((m) => m[1])
  const seen = new Set()
  while (todo.length) {
    const file = todo.pop()
    if (seen.has(file)) continue
    seen.add(file)
    const code = readFileSync(path.join(dist, 'assets', file), 'utf8')
    // Static imports only ("from" and bare): import("...") is lazy and runs nothing until called.
    for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*)["']\.\/([\w-]+\.js)["']/g)) todo.push(m[1])
  }
  return seen
}

let bad = 0
for (const page of PAGES) {
  const chunks = loaded(page)
  const main = [...chunks].filter((f) => MAIN.test(f))
  if (main.length || chunks.size === 0) bad++
  console.log(`${main.length || chunks.size === 0 ? 'FAIL' : 'ok  '}  ${page}: ${chunks.size} chunks${main.length ? ', loads the app entry ' + main.join(', ') : ''}`)
}
process.exit(bad ? 1 : 0)
