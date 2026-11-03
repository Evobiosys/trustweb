// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The option tokenizer: git-like `--opt value`, `--opt=value`, short aliases, `--` and errors that name the option. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parseArgs, UsageError, type Option } from '../src/args.ts'

const OPTIONS: Option[] = [
  { name: 'label', kind: 'string', placeholder: '<text>', help: 'A label' },
  { name: 'json', kind: 'flag', help: 'Machine output' },
  { name: 'also', kind: 'list', alias: 'a', placeholder: '<id>', help: 'Repeatable' },
  { name: 'force', kind: 'flag', alias: 'f', help: 'Short flag' },
]

describe('parseArgs', () => {
  it('separates positionals from options and reads both value spellings', () => {
    const p = parseArgs(['create', 'friend', '--label', 'Friends', '--json'], OPTIONS)
    assert.deepEqual(p.positionals, ['create', 'friend'])
    assert.equal(p.options.label, 'Friends')
    assert.equal(p.options.json, true)
    assert.equal(parseArgs(['--label=Close allies'], OPTIONS).options.label, 'Close allies')
  })
  it('accumulates a list option and accepts its short alias', () => {
    const p = parseArgs(['--also', 'tag:x', '-a', 'person:y', '-f'], OPTIONS)
    assert.deepEqual(p.options.also, ['tag:x', 'person:y'])
    assert.equal(p.options.force, true)
  })
  it('stops reading options after --', () => {
    const p = parseArgs(['--json', '--', '--label', '-f'], OPTIONS)
    assert.deepEqual(p.positionals, ['--label', '-f'])
    assert.equal(p.options.label, undefined)
  })
  it('refuses an unknown option, a flag with a value and a value option without one, naming the option', () => {
    assert.throws(() => parseArgs(['--colour', 'red'], OPTIONS), (e: unknown) => e instanceof UsageError && /--colour/.test(e.message))
    assert.throws(() => parseArgs(['--json=1'], OPTIONS), (e: unknown) => e instanceof UsageError && /--json/.test(e.message))
    assert.throws(() => parseArgs(['--label'], OPTIONS), (e: unknown) => e instanceof UsageError && /--label/.test(e.message))
    assert.throws(() => parseArgs(['-x'], OPTIONS), UsageError)
  })
  it('a lone - is a positional; a negative-looking value after a value option is taken as the value', () => {
    const p = parseArgs(['-', '--label', '-5'], OPTIONS)
    assert.deepEqual(p.positionals, ['-'])
    assert.equal(p.options.label, '-5')
  })
})
