// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Generates src/design/tokens.css from src/design/tokens.json: node scripts/build_tokens.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const decls = (map) => Object.entries(map).map(([k, v]) => `  --${k}:${v};`).join('\n')
const block = (selector, body) => `${selector}{\n${body}\n}`

export function renderTokensCss({ core, one, aliases }) {
  const refs = Object.fromEntries(Object.entries(aliases).map(([old, target]) => [old, `var(--${target})`]))
  const dark = decls(one.dark) + '\n  color-scheme:dark;'
  return [
    '/* SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later */',
    '/* generated from src/design/tokens.json by scripts/build_tokens.mjs, do not edit */',
    block(':root', `${decls(core)}\n${decls(one.light)}\n  color-scheme:light;`),
    block(':root[data-theme="dark"]', dark),
    block('@media (prefers-color-scheme:dark)', block(':root:not([data-theme="light"]):not([data-theme="dark"])', dark).replace(/^/gm, '  ')),
    '/* legacy aliases (old name -> token): may be retired from 2026-12-07 */',
    block(':root', decls(refs)),
  ].join('\n') + '\n'
}

if (process.argv[1]?.endsWith('build_tokens.mjs')) {
  const dir = new URL('../src/design/', import.meta.url)
  const tokens = JSON.parse(readFileSync(new URL('tokens.json', dir), 'utf8'))
  writeFileSync(new URL('tokens.css', dir), renderTokensCss(tokens))
}
