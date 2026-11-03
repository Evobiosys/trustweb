// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The frame every command shares: help for every node of the tree, exit codes, --json, --now, record discovery, init. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { renderHelp, walk } from '../src/cli.ts'
import { ROOT, VERSION } from '../src/main.ts'
import { Cli, NOW } from './helpers/run.ts'

describe('help', () => {
  it('every command and subcommand answers --help with exit 0, a usage line that names it, and the global options', async () => {
    const cli = new Cli()
    for (const { path, command } of walk(ROOT)) {
      const r = await cli.run(...path, '--help')
      assert.equal(r.code, 0, `${path.join(' ')} --help exited ${r.code}: ${r.stderr}`)
      assert.ok(r.stdout.includes(`Usage: trustweb${path.length ? ' ' + path.join(' ') : ''}`), `${path.join(' ')}: usage line`)
      assert.ok(r.stdout.includes('--record <file>'), `${path.join(' ')}: global options`)
      assert.ok(r.stdout.startsWith(command.summary), `${path.join(' ')}: starts with its summary`)
      for (const s of command.subcommands ?? []) assert.ok(r.stdout.includes(s.name), `${path.join(' ')}: lists ${s.name}`)
    }
  })
  it('-h works too, and `trustweb` alone prints the root help with exit 2 (nothing was asked)', async () => {
    const cli = new Cli()
    assert.equal((await cli.run('-h')).code, 0)
    const bare = await cli.run()
    assert.equal(bare.code, 2)
    assert.ok(bare.stdout.includes('Usage: trustweb <command>'))
  })
  it('a group without a subcommand prints its help and exits 2; an unknown command is a usage error', async () => {
    const cli = new Cli()
    const groups = walk(ROOT).filter((n) => n.path.length && n.command.subcommands?.length)
    for (const { path } of groups) {
      const r = await cli.run(...path)
      assert.equal(r.code, 2, path.join(' '))
      assert.ok(r.stdout.includes('Commands:'), path.join(' '))
    }
    const r = await cli.run('dance')
    assert.equal(r.code, 2)
    assert.match(r.stderr, /unknown command "dance"/)
  })
  it('renderHelp lists arguments, options and examples', () => {
    const text = renderHelp(['x'], {
      name: 'x', summary: 'Sum', positionals: [{ name: 'id', help: 'The id' }, { name: 'more', help: 'More', optional: true, variadic: true }],
      options: [{ name: 'label', alias: 'l', kind: 'string', placeholder: '<text>', help: 'Label' }], examples: ['trustweb x a'],
    })
    assert.ok(text.includes('Usage: trustweb x <id> [more...] [options]'))
    assert.ok(text.includes('-l, --label <text>  Label'))
    assert.ok(text.includes('Examples:\n  trustweb x a'))
  })
})

describe('frame', () => {
  it('--version prints the version', async () => {
    const r = await new Cli().run('--version')
    assert.equal(r.code, 0)
    assert.equal(r.stdout, `trustweb ${VERSION}\n`)
  })
  it('an unknown option is a usage error (exit 2) that names it and points at --help', async () => {
    const r = await new Cli().run('init', '--colour', 'red')
    assert.equal(r.code, 2)
    assert.match(r.stderr, /unknown option --colour/)
    assert.match(r.stderr, /trustweb init --help/)
  })
  it('a bad --now is a usage error', async () => {
    const r = await new Cli().run('init', '--now', 'yesterday-ish')
    assert.equal(r.code, 2)
    assert.match(r.stderr, /--now/)
  })
  it('without a record, a command that needs one exits 1 and says how to make one', async () => {
    const cli = new Cli()
    const r = await cli.run('log')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /no record found/)
    assert.match(r.stderr, /trustweb init/)
  })
})

describe('init', () => {
  it('creates .trustweb/record.json with the device, pins the clock from --now / TRUSTWEB_NOW, and refuses to overwrite', async () => {
    const cli = new Cli()
    const r = await cli.run('init', '--device', 'laptop', '--json')
    assert.equal(r.code, 0, r.stderr)
    const file = join(cli.dir, '.trustweb', 'record.json')
    assert.deepEqual(r.json(), { record: file, device: 'device:laptop' })
    assert.ok(existsSync(file))
    const rec = cli.record()
    assert.equal(rec.device, 'device:laptop')
    assert.equal(rec.log[0].at, NOW)
    const again = await cli.run('init')
    assert.equal(again.code, 1)
    assert.match(again.stderr, /already exists/)
  })
  it('--record puts the record elsewhere, and later commands find it through --record or TRUSTWEB_RECORD, or up the tree', async () => {
    const cli = new Cli()
    const r = await cli.run('--record', 'web/r.json', 'init')
    assert.equal(r.code, 0, r.stderr)
    assert.ok(existsSync(join(cli.dir, 'web', 'r.json')))
    assert.equal((await cli.run('--record', 'web/r.json', 'log')).code, 0)
    const viaEnv = new Cli(cli.dir, { TRUSTWEB_RECORD: join(cli.dir, 'web', 'r.json') })
    assert.equal((await viaEnv.run('log')).code, 0)
    await cli.ok('init')
    const sub = join(cli.dir, 'deep', 'er')
    mkdirSync(sub, { recursive: true })
    assert.equal((await new Cli(sub).run('log')).code, 0)
  })
  it('a device name with a colon or a space is refused', async () => {
    const r = await new Cli().run('init', '--device', 'my laptop')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /device name/)
  })
})
