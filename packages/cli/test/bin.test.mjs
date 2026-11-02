// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The real command on a real (temporary) folder: files, stdin, exit codes, archive/ instead of overwrite. No network. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BIN = fileURLToPath(new URL('../bin/trustweb.mjs', import.meta.url))

function inTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'trustweb-cli-'))
  try { fn(dir) } finally { rmSync(dir, { recursive: true, force: true }) }
}

const tw = (dir, args, input) => {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: dir, input, encoding: 'utf8', env: { PATH: process.env.PATH } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}

test('the bin runs a whole session in a folder, with clean stderr', () => inTemp((dir) => {
  assert.deepEqual(tw(dir, ['init']), { code: 0, out: 'created trustweb-record.json with 7 built-in zones\n', err: '' })
  assert.equal(tw(dir, ['zone', 'create', 'crew', '--level', 'friend']).code, 0)
  assert.equal(tw(dir, ['zone', 'add', 'crew', 'person:fig']).code, 0)
  assert.equal(tw(dir, ['share', 'bike', '--zone', 'friend']).code, 0)
  const sees = tw(dir, ['sees', 'person:fig'])
  assert.equal(sees.out, 'person:fig can see 1 item\nitem:bike\n  because person:fig in_zone zone:friend (via crew)\n  because zone:friend may_read item:bike\n')
  assert.equal(sees.err, '')
  assert.equal(tw(dir, ['zone', 'archive', 'nope']).code, 1)
  assert.equal(tw(dir, ['nope']).code, 2)
}))

test('export to a file, import from stdin with --force: the old record lands in archive/', () => inTemp((dir) => {
  tw(dir, ['init'])
  tw(dir, ['tag', 'create', 'garden'])
  assert.equal(tw(dir, ['export', '--out', 'backup.json']).code, 0)
  const backup = readFileSync(join(dir, 'backup.json'), 'utf8')
  assert.equal(tw(dir, ['export', '--out', 'backup.json', '--force']).code, 0)
  assert.equal(readdirSync(join(dir, 'archive')).length, 1)
  const r = tw(dir, ['import', '-', '--force'], backup)
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /^moved the old record to archive[/\\]trustweb-record\.json\.\d{4}-.*\nimport: 7 zones, 0 people, 1 tags, 0 share lines from stdin\n$/)
  assert.equal(readdirSync(join(dir, 'archive')).length, 2)
  assert.ok(existsSync(join(dir, 'trustweb-record.json')))
}))

test('two archives in the same millisecond get distinct names', () => inTemp((dir) => {
  tw(dir, ['init'])
  for (let i = 0; i < 3; i++) assert.equal(tw(dir, ['init', '--force']).code, 0)
  assert.equal(readdirSync(join(dir, 'archive')).length, 3)
}))
