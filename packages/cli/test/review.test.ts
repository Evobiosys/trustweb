// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The first review's findings, each pinned by a test before it was fixed: a merge must never reopen what was closed,
 * revoked or forbidden; ids that are names of object properties are ordinary ids; a write cannot go back in time;
 * help and version are flags, not values; small frame corners.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Cli, NOW, seeded, withRecord } from './helpers/run.ts'

const LATER = '2026-11-03T12:00:00.000Z'
const MUCH_LATER = '2026-11-04T12:00:00.000Z'
const recordFile = (cli: Cli): string => join(cli.dir, '.trustweb', 'record.json')

describe('merge never reopens what is closed here', () => {
  it('a tuple closed here stays closed when an older copy that still has it open is merged in', async () => {
    const a = await seeded()
    await a.ok('export', '--out', 'old.json')
    await a.ok('zone', 'remove-person', 'friend', 'ada', `--now=${LATER}`)
    const r = await a.run('import', 'old.json', '--merge', `--now=${MUCH_LATER}`)
    assert.equal(r.code, 0, r.stderr)
    const rec = a.record()
    const adaFriend = rec.tuples.filter((t) => t.subject === 'person:ada' && t.relation === 'in_zone' && t.object === 'zone:friend')
    assert.equal(adaFriend.length, 1)
    assert.equal(adaFriend[0].until, LATER)
    assert.doesNotMatch((await a.ok('show', 'person', 'ada', `--now=${MUCH_LATER}`)), /zone: friend/)
  })
  it('a removed person gets nothing back: merged tuples naming them are closed at the removal', async () => {
    const a = await seeded()
    await a.ok('export', '--out', 'old.json')
    await a.ok('person', 'remove', 'ada', `--now=${LATER}`)
    await a.ok('import', 'old.json', '--merge', `--now=${MUCH_LATER}`)
    const rec = a.record()
    for (const t of rec.tuples.filter((t) => t.subject === 'person:ada')) assert.ok(t.until !== undefined && t.until <= LATER, JSON.stringify(t))
    assert.match(await a.ok('show', 'person', 'ada', `--now=${MUCH_LATER}`), /zone: public/)
  })
  it('a closure that only the other record has is taken over: closing wins on both sides', async () => {
    const a = await seeded()
    await a.ok('export', '--out', 'copy.json')
    const b = new Cli()
    await b.ok('--record', 'b.json', 'import', join(a.dir, 'copy.json'))
    await b.ok('--record', 'b.json', 'zone', 'remove-person', 'close', 'cy', `--now=${LATER}`)
    const r = await a.run('import', join(b.dir, 'b.json'), '--merge', `--now=${MUCH_LATER}`)
    assert.equal(r.code, 0, r.stderr)
    const cyClose = a.record().tuples.filter((t) => t.subject === 'person:cy' && t.object === 'zone:close')
    assert.equal(cyClose.length, 1)
    assert.equal(cyClose[0].until, LATER)
    assert.match(r.stdout, /1 tuple closed/)
  })
  it('an older share line from the other record does not come after our newer revoke', async () => {
    const a = await seeded()
    await a.ok('share', 'add', 'bike', '--zone', 'close')
    await a.ok('export', '--out', 'copy.json')
    const b = new Cli()
    await b.ok('--record', 'b.json', 'import', join(a.dir, 'copy.json'))
    await b.ok('--record', 'b.json', 'share', 'add', 'bike', '--zone', 'public', `--now=${LATER}`)
    await a.ok('share', 'revoke', 'bike', `--now=${MUCH_LATER}`)
    const r = await a.run('import', join(b.dir, 'b.json'), '--merge', `--now=${MUCH_LATER}`)
    assert.equal(r.code, 0, r.stderr)
    assert.match(await a.ok('show', 'item', 'bike', `--now=${MUCH_LATER}`), /not shared \(revoked/)
    assert.match(r.stdout, /superseded/)
  })
  it('a newer share line from the other record does come in and wins', async () => {
    const a = await seeded()
    await a.ok('share', 'add', 'bike', '--zone', 'close')
    await a.ok('export', '--out', 'copy.json')
    const b = new Cli()
    await b.ok('--record', 'b.json', 'import', join(a.dir, 'copy.json'))
    await b.ok('--record', 'b.json', 'share', 'add', 'bike', '--zone', 'friend', `--now=${LATER}`)
    await a.ok('import', join(b.dir, 'b.json'), '--merge', `--now=${MUCH_LATER}`)
    assert.match(await a.ok('show', 'item', 'bike', `--now=${MUCH_LATER}`), /zone: friend/)
  })
  it('a merge that would nest tags in a cycle is refused and writes nothing', async () => {
    const a = await seeded()
    await a.ok('tag', 'add', 'x')
    await a.ok('tag', 'add', 'y')
    await a.ok('export', '--out', 'copy.json')
    const b = new Cli()
    await b.ok('--record', 'b.json', 'import', join(a.dir, 'copy.json'))
    await a.ok('tag', 'nest', 'x', 'y')
    await b.ok('--record', 'b.json', 'tag', 'nest', 'y', 'x')
    const before = a.record()
    const r = await a.run('import', join(b.dir, 'b.json'), '--merge', `--now=${LATER}`)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /cycle/)
    assert.deepEqual(a.record(), before)
  })
})

describe('ids that are names of object properties', () => {
  it('toString is nobody until added; constructor can be added; renaming works', async () => {
    const a = await seeded()
    const r = await a.run('zone', 'add-person', 'friend', 'toString')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /person add toString/)
    assert.equal((await a.run('person', 'add', 'constructor')).code, 0)
    assert.equal((await a.run('person', 'rename', 'constructor', 'C')).code, 0)
    assert.equal(a.record().persons.constructor?.name, 'C')
    assert.equal((await a.run('tag', 'add', 'valueOf')).code, 0)
    assert.equal((await a.run('person', 'tag', 'constructor', 'valueOf')).code, 0)
    assert.doesNotMatch(await a.ok('show', 'item', 'bike'), /toString/)
  })
})

describe('a write cannot go back in time', () => {
  it('a --now earlier than the record\'s last change is refused for a write, allowed for a read', async () => {
    const a = await seeded()
    await a.ok('person', 'add', 'di', `--now=${LATER}`)
    const before = a.record()
    const r = await a.run('person', 'add', 'eve', '--now=2026-06-01T00:00:00.000Z')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /earlier than the record's last change/)
    assert.deepEqual(a.record(), before)
    assert.equal((await a.run('zone', 'list', '--now=2026-06-01T00:00:00.000Z')).code, 0)
  })
})

describe('removed persons and tags in a share scope', () => {
  it('a removed person named in --also no longer opens the item; show item and canAccess agree', async () => {
    const a = await seeded()
    await a.ok('share', 'add', 'seeds', '--zone', 'close', '--also', 'bo')
    assert.match(await a.ok('show', 'item', 'seeds'), /person:bo/)
    await a.ok('person', 'remove', 'bo', `--now=${LATER}`)
    const who = (await a.ok('show', 'item', 'seeds', `--now=${MUCH_LATER}`)).split('Who can see it now:')[1]
    assert.doesNotMatch(who, /person:bo/)
    assert.match(await a.ok('show', 'person', 'bo', `--now=${MUCH_LATER}`), /\(nothing\)/)
    assert.doesNotMatch(await a.ok('export', '--format', 'jsonl', '--effective', `--now=${MUCH_LATER}`), /person:bo","relation":"may_read"/)
  })
})

describe('frame corners', () => {
  it('--help and --version are flags, not values: a name of -V is a name, help after -- is an argument', async () => {
    const a = await seeded()
    const r = await a.run('person', 'add', 'di', '--name', '-V')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(a.record().persons.di?.name, '-V')
    const h = await a.run('zone', 'rename', 'friend', '--', '-h')
    assert.equal(h.code, 0, h.stderr)
    assert.equal(a.record().zones.friend?.label, '-h')
    assert.equal((await a.run('person', 'list', '-h')).code, 0)
    assert.match((await a.run('-V')).stdout, /^trustweb /)
  })
  it('log -n wants a count', async () => {
    const a = await seeded()
    const r = await a.run('log', '-n', 'abc')
    assert.equal(r.code, 2)
    assert.match(r.stderr, /-n/)
  })
  it('init honours TRUSTWEB_RECORD like every other command', async () => {
    const cli = new Cli()
    const file = join(cli.dir, 'elsewhere.json')
    const env = new Cli(cli.dir, { TRUSTWEB_RECORD: file })
    await env.ok('init')
    assert.ok(existsSync(file))
    assert.ok(!existsSync(recordFile(cli)))
    assert.equal((await env.run('zone', 'list')).code, 0)
  })
  it('a first import writes the canonical bytes and logs the import', async () => {
    const a = await seeded()
    const compact = JSON.stringify(a.record())
    const fresh = new Cli()
    writeFileSync(join(fresh.dir, 'compact.json'), compact)
    await fresh.ok('import', 'compact.json')
    const rec = fresh.record()
    assert.match(rec.log[rec.log.length - 1].text, /imported compact\.json/)
    assert.equal(rec.log[rec.log.length - 1].at, NOW)
    assert.ok(!(await fresh.ok('export')).startsWith(compact.slice(0, 20)))
  })
  it('stack traces point at TypeScript lines (source maps are on)', () => {
    assert.equal(process.sourceMapsEnabled, true)
  })
})

describe('tag rules are checked when they are written, for the whole future', () => {
  it('nesting that would be a cycle with a future-dated nesting is refused', async () => {
    const a = await seeded()
    await withRecord(a, (r) => r.tuples.push({ subject: 'tag:garden', relation: 'nested_in', object: 'tag:roses', since: MUCH_LATER, by: 'device:laptop' }))
    await a.ok('tag', 'unnest', 'roses', 'garden')
    const r = await a.run('tag', 'nest', 'roses', 'garden', `--now=${LATER}`)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /cycle/)
  })
})
