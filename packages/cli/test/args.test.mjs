// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The small argv parser: long and short flags, repeatable lists, `--` and `-`, and usage errors (exit 2). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs } from '../src/args.ts'

const spec = { json: { kind: 'bool' }, level: { kind: 'string' }, include: { kind: 'list' }, n: { kind: 'string', short: 'n' }, help: { kind: 'bool', short: 'h' } }
const usageError = (pattern) => (e) => e.exitCode === 2 && pattern.test(e.message)

test('positionals and flags in any order; a string flag takes the next word or =value', () => {
  assert.deepEqual(parseArgs(['a', '--level', 'close', 'b', '--json', '--n=3'], spec), { positionals: ['a', 'b'], flags: { level: 'close', json: true, n: '3' } })
})

test('a list flag repeats; short flags work; `-` is a positional; `--` ends the flags', () => {
  assert.deepEqual(parseArgs(['--include', 'tag:a', '--include=person:b', '-n', '2', '-h', '-', '--', '--json'], spec), {
    positionals: ['-', '--json'], flags: { include: ['tag:a', 'person:b'], n: '2', help: true },
  })
})

test('unknown flags, missing values and values on a switch are usage errors', () => {
  assert.throws(() => parseArgs(['--nope'], spec), usageError(/unknown option --nope/))
  assert.throws(() => parseArgs(['-x'], spec), usageError(/unknown option -x/))
  assert.throws(() => parseArgs(['--constructor'], spec), usageError(/unknown option --constructor/))
  assert.throws(() => parseArgs(['--level'], spec), usageError(/--level needs a value/))
  assert.throws(() => parseArgs(['-n'], spec), usageError(/-n needs a value/))
  assert.throws(() => parseArgs(['--json=yes'], spec), usageError(/--json takes no value/))
  assert.throws(() => parseArgs(['--level', 'a', '--level', 'b'], spec), usageError(/--level given twice/))
})
