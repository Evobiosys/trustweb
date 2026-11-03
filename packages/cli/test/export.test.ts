// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** `trustweb export`: the record's canonical bytes, the relation store as JSONL (facts, or the effective store), Markdown pages, --out. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serializeRecord } from '../src/record.ts'
import { Zone, toJsonl } from '../src/sink.ts'
import { Cli, NOW, seeded, withRecord } from './helpers/run.ts'

const BY = 'device:laptop'

/** seeded() plus a tag rule (garden counts as friend), a removed tag, and bike shared to friend. */
async function fixture(): Promise<Cli> {
  const cli = await seeded()
  withRecord(cli, (r) => {
    r.tags.old = { label: 'old', addedAt: NOW, removedAt: NOW }
    r.tuples.push({ subject: 'tag:garden', relation: 'in_zone', object: 'zone:friend', since: NOW, by: BY })
    r.shares.push({ op: 'share', id: 'item:bike', seq: 1, scope: { zone: Zone.Friend, include: [], exclude: [] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep', ts: NOW })
  })
  return cli
}

const recordFile = (cli: Cli): string => join(cli.dir, '.trustweb', 'record.json')

describe('export json', () => {
  it('prints the canonical record bytes, the same with and without --json, and changes nothing', async () => {
    const cli = await fixture()
    const before = readFileSync(recordFile(cli), 'utf8')
    const plain = await cli.ok('export')
    assert.equal(plain, before)
    assert.equal(plain, serializeRecord(cli.record()))
    assert.equal(await cli.ok('export', '--json'), plain)
    assert.equal(await cli.ok('export', '--format', 'json'), plain)
    assert.equal(readFileSync(recordFile(cli), 'utf8'), before, 'export never writes the record')
    assert.equal(cli.record().log.length, 1, 'export writes no log line')
  })
  it('--effective is refused for json (it describes the record, not a store)', async () => {
    const r = await (await fixture()).run('export', '--effective')
    assert.equal(r.code, 2)
    assert.match(r.stderr, /--effective/)
  })
  it('an unknown --format is a usage error', async () => {
    const r = await (await fixture()).run('export', '--format', 'xml')
    assert.equal(r.code, 2)
    assert.match(r.stderr, /--format/)
  })
  it('without a record it exits 1 and says how to make one', async () => {
    const r = await new Cli().run('export')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /trustweb init/)
  })
})

describe('export jsonl', () => {
  it('is the relation store as kept: the facts only, one tuple per line', async () => {
    const cli = await fixture()
    const out = await cli.ok('export', '--format', 'jsonl')
    assert.equal(out, toJsonl(cli.record().tuples))
    assert.equal(out.trim().split('\n').length, 6)
    assert.ok(!out.includes('item:bike'), 'share scopes are not facts')
  })
  it('--effective adds the unfolded tag rules and the scope tuples of the latest shares', async () => {
    const cli = await fixture()
    const out = await cli.ok('export', '--format', 'jsonl', '--effective')
    const lines = out.trim().split('\n').map((l) => JSON.parse(l) as Record<string, string>)
    assert.ok(lines.some((t) => t.subject === 'person:bo' && t.relation === 'in_zone' && t.object === 'zone:friend' && t.tag === 'tag:garden'), 'bo through the garden rule')
    assert.ok(lines.some((t) => t.subject === 'person:cy' && t.object === 'zone:friend' && t.tag === 'tag:garden'), 'cy through roses nested in garden')
    assert.ok(lines.some((t) => t.subject === 'zone:friend' && t.relation === 'may_read' && t.object === 'item:bike'), 'the share scope')
  })
  it('--effective depends on the clock: before the rule began, nothing is unfolded', async () => {
    const cli = await fixture()
    const out = await cli.ok('export', '--format', 'jsonl', '--effective', '--now', '2026-01-01T00:00:00.000Z')
    assert.ok(!out.includes('"tag":"tag:garden"'))
    assert.ok(out.includes('item:bike'), 'share scopes are folded in whatever the clock says')
  })
})

describe('export markdown', () => {
  it('one page per known person and per live tag, in id order, separated by a blank line, on the effective store', async () => {
    const cli = await fixture()
    const out = await cli.ok('export', '--format', 'markdown')
    const heads = out.split('\n').filter((l) => l.startsWith('# '))
    assert.deepEqual(heads, ['# person:ada', '# person:bo', '# person:cy', '# tag:garden', '# tag:roses'])
    assert.ok(!out.includes('tag:old'), 'a removed tag has no page')
    assert.ok(out.includes('\n\n# person:bo\n'), 'pages are separated by a blank line')
    const bo = out.slice(out.indexOf('# person:bo'), out.indexOf('# person:cy'))
    assert.match(bo, /- zone: friend/, 'the garden rule counts (effective is implied)')
    assert.match(bo, /item:bike/)
    const garden = out.slice(out.indexOf('# tag:garden'), out.indexOf('# tag:roses'))
    assert.match(garden, /- person:bo/)
  })
  it('an archived zone counts for nothing: a person whose only zone it is reads as public', async () => {
    const cli = await fixture()
    withRecord(cli, (r) => {
      r.persons.di = { name: 'Di', addedAt: NOW }
      r.tuples.push({ subject: 'person:di', relation: 'in_zone', object: 'zone:community', since: NOW, by: BY })
    })
    const out = await cli.ok('export', '--format', 'markdown')
    const di = out.slice(out.indexOf('# person:di'), out.indexOf('# tag:garden'))
    assert.match(di, /- zone: public/)
  })
})

describe('export --out', () => {
  it('writes the file (making its directory), says how many bytes, and refuses to overwrite without --force', async () => {
    const cli = await fixture()
    const r = await cli.run('export', '--out', 'backup/web.json')
    assert.equal(r.code, 0, r.stderr)
    const file = join(cli.dir, 'backup', 'web.json')
    const bytes = readFileSync(file)
    assert.equal(bytes.toString('utf8'), serializeRecord(cli.record()))
    assert.equal(r.stdout, `wrote ${file} (${bytes.length} bytes)\n`)
    writeFileSync(file, 'mine\n')
    const again = await cli.run('export', '--out', 'backup/web.json')
    assert.equal(again.code, 1)
    assert.match(again.stderr, /already exists/)
    assert.match(again.stderr, /--force/)
    assert.equal(readFileSync(file, 'utf8'), 'mine\n')
    await cli.ok('export', '--out', 'backup/web.json', '--force')
    assert.equal(readFileSync(file, 'utf8'), serializeRecord(cli.record()))
  })
  it('--json with --out answers with the path, the byte count and the format', async () => {
    const cli = await fixture()
    const r = await cli.run('export', '--format', 'jsonl', '--out', 'store.jsonl', '--json')
    assert.equal(r.code, 0, r.stderr)
    const file = join(cli.dir, 'store.jsonl')
    assert.deepEqual(r.json(), { wrote: file, bytes: readFileSync(file).length, format: 'jsonl', effective: false })
    assert.ok(existsSync(file))
  })
})
