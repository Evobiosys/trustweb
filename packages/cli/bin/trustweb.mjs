#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The `trustweb` command: wires the CLI (src/cli.ts) to this machine's files, stdin, stdout and clock. It imports node:fs and
 * node:path only; nothing here or in src/ opens a socket (scripts/lint.mjs checks that).
 */
import './ts-hooks.mjs'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const { run } = await import('../src/cli.ts')

/** archive/<name>.<UTC stamp>[.n] next to the file: moved, never deleted. */
function moveToArchive(path) {
  const dir = join(dirname(path), 'archive')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  let to = join(dir, `${basename(path)}.${stamp}`)
  for (let n = 2; existsSync(to); n++) to = join(dir, `${basename(path)}.${stamp}.${n}`)
  renameSync(path, to)
  return to
}

const io = {
  env: process.env,
  now: () => new Date(),
  exists: (p) => existsSync(p),
  readFile: (p) => readFileSync(p, 'utf8'),
  writeFile: (p, text) => writeFileSync(p, text),
  readStdin: () => readFileSync(0, 'utf8'),
  moveToArchive,
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
}

process.exitCode = run(process.argv.slice(2), io)
