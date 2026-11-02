// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The package lint passes here, and catches what it is for (on throwaway fixture packages). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LINT = fileURLToPath(new URL('../scripts/lint.mjs', import.meta.url))
const HEADER = '// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later\n'
const lint = (...args) => spawnSync(process.execPath, [LINT, ...args], { encoding: 'utf8' })

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'trustweb-lint-'))
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

test('this package passes', () => {
  const r = lint()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /no network API/)
})

test('a clean fixture passes; comments may name anything', () => {
  const dir = fixture({ 'src/a.ts': `${HEADER}// fetch( in a comment is fine\nimport type { X } from './gone'\nexport const a = 1\n` })
  try { assert.equal(lint(dir).status, 0) } finally { rmSync(dir, { recursive: true }) }
})

test('it finds a missing header, network use (also one import away), impurity and a broken import', () => {
  const dir = fixture({
    'bin/x.mjs': `#!/usr/bin/env node\n${HEADER}import '../src/a.ts'\n`,
    'src/a.ts': `${HEADER}import { b } from './b'\nimport('./missing')\nexport const a = () => console.log(Date.now(), new Date(), Math.random(), b)\n`,
    'src/b.ts': `${HEADER}import http from 'node:http'\nexport const b = () => fetch('x')\n`,
    'test/t.mjs': 'no header\n',
  })
  try {
    const r = lint(dir)
    assert.equal(r.status, 1)
    for (const want of ['test/t.mjs: missing the SPDX header', 'src/b.ts: names a network API', 'src/a.ts: cannot resolve ./missing', 'src/a.ts: console', 'src/a.ts: Date.now', 'src/a.ts: new Date()', 'src/a.ts: Math.random']) {
      assert.ok(r.stderr.includes(want), want)
    }
  } finally { rmSync(dir, { recursive: true }) }
})
