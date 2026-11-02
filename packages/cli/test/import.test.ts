// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** `trustweb import`: a record file into a fresh place (a copy), over ours (--replace), or into ours (--merge); --dry-run. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ShareLine } from '../src/sink.ts'
import { Zone } from '../src/sink.ts'
import { Cli, NOW, seeded, withRecord } from './helpers/run.ts'

const EARLIER = '2026-10-01T09:00:00.000Z'
const recordFile = (cli: Cli): string => join(cli.dir, '.trustweb', 'record.json')
const share = (id: string, seq: number, zone: Zone, ts: string): ShareLine =>
  ({ op: 'share', id, seq, scope: { zone, include: [], exclude: [] }, cutoff: seq, to: `zone:${zone}`, terms: 'read-keep', ts })

/** seeded() (device:laptop) with bike shared to friend. */
async function ours(): Promise<Cli> {
  const cli = await seeded()
  withRecord(cli, (r) => r.shares.push(share('item:bike', 1, Zone.Friend, NOW)))
  return cli
}

/**
 * Another device's record (device:phone, begun earlier): closest and friend set up, ada (also ours) and di (new), tag choir (new),
 * one tuple ours has too, two new ones, and two share lines: seeds to close, then a revoke of seeds.
 */
async function theirs(): Promise<string> {
  const cli = new Cli()
  await cli.ok('init', '--device', 'phone', '--now', EARLIER)
  withRecord(cli, (r) => {
    r.zones.closest = { label: 'Inner', createdAt: EARLIER }
    r.zones.friend = { label: 'Pals', createdAt: EARLIER }
    r.persons.ada = { name: 'Ada L', addedAt: EARLIER }
    r.persons.di = { name: 'Di', addedAt: EARLIER }
    r.tags.choir = { label: 'choir', addedAt: EARLIER }
    r.tuples.push(
      { subject: 'person:ada', relation: 'in_zone', object: 'zone:friend', since: NOW, by: 'device:laptop' },
      { subject: 'person:di', relation: 'in_zone', object: 'zone:closest', since: EARLIER, by: 'device:phone' },
      { subject: 'person:di', relation: 'has_tag', object: 'tag:choir', since: EARLIER, by: 'device:phone' },
    )
    r.shares.push(share('item:seeds', 1, Zone.Close, EARLIER), { op: 'revoke', id: 'item:seeds', seq: 2, target: 'item:seeds', at: 2, ts: EARLIER })
  })
  return recordFile(cli)
}

describe('import into a place without a record', () => {
  it('round trip: export, import into a fresh directory, and export again gives the same bytes', async () => {
    const a = await ours()
    await a.ok('export', '--out', 'web.json')
    const fresh = new Cli()
    const r = await fresh.run('import', join(a.dir, 'web.json'))
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /new record/)
    assert.equal(await fresh.ok('export'), await a.ok('export'))
  })
  it('--record puts the new record there', async () => {
    const file = await theirs()
    const fresh = new Cli()
    await fresh.ok('--record', 'web/r.json', 'import', file)
    assert.ok(existsSync(join(fresh.dir, 'web', 'r.json')))
    assert.ok(!existsSync(join(fresh.dir, '.trustweb')))
  })
  it('a file that is not a record is refused, naming the file and the problem, and nothing is written', async () => {
    const fresh = new Cli()
    writeFileSync(join(fresh.dir, 'bad.json'), '{"kind":"something-else"}')
    const r = await fresh.run('import', 'bad.json')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /bad\.json/)
    assert.match(r.stderr, /kind must be/)
    assert.ok(!existsSync(join(fresh.dir, '.trustweb')))
    writeFileSync(join(fresh.dir, 'torn.json'), '{"kind":')
    const torn = await fresh.run('import', 'torn.json')
    assert.equal(torn.code, 1)
    assert.match(torn.stderr, /torn\.json: not valid JSON/)
    const missing = await fresh.run('import', 'nowhere.json')
    assert.equal(missing.code, 1)
    assert.match(missing.stderr, /cannot read nowhere\.json/)
    assert.ok(!existsSync(join(fresh.dir, '.trustweb')))
  })
  it('--dry-run says what it would do and writes nothing', async () => {
    const file = await theirs()
    const fresh = new Cli()
    const r = await fresh.run('import', file, '--dry-run', '--json')
    assert.equal(r.code, 0, r.stderr)
    const s = r.json<{ mode: string; dryRun: boolean; added: Record<string, number> }>()
    assert.equal(s.mode, 'new')
    assert.equal(s.dryRun, true)
    assert.deepEqual(s.added, { zones: 2, persons: 2, tags: 1, tuples: 3, shares: 2 })
    assert.ok(!existsSync(join(fresh.dir, '.trustweb')))
  })
})

describe('import over an existing record', () => {
  it('without --replace or --merge it refuses and says to choose; both at once is a usage error', async () => {
    const a = await ours()
    const before = readFileSync(recordFile(a), 'utf8')
    const r = await a.run('import', await theirs())
    assert.equal(r.code, 1)
    assert.match(r.stderr, /--replace/)
    assert.match(r.stderr, /--merge/)
    const both = await a.run('import', await theirs(), '--replace', '--merge')
    assert.equal(both.code, 2)
    assert.equal(readFileSync(recordFile(a), 'utf8'), before)
  })
  it('an invalid file leaves our record as it was', async () => {
    const a = await ours()
    const before = readFileSync(recordFile(a), 'utf8')
    writeFileSync(join(a.dir, 'bad.json'), '{"kind":"trustweb-cli-record","v":1,"device":"device:x","zones":{},"persons":{},"tags":{},"tuples":[{"subject":"person:ada"}],"shares":[],"log":[]}')
    const r = await a.run('import', 'bad.json', '--merge')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /bad\.json: tuple 1 is not a tuple/)
    assert.equal(readFileSync(recordFile(a), 'utf8'), before)
  })
  it('--replace swaps the record for the imported one and logs one line naming the device it replaced', async () => {
    const a = await ours()
    const file = await theirs()
    const imported = JSON.parse(readFileSync(file, 'utf8')) as { log: unknown[] }
    const r = await a.run('import', file, '--replace')
    assert.equal(r.code, 0, r.stderr)
    const rec = a.record()
    assert.equal(rec.device, 'device:phone')
    assert.deepEqual(Object.keys(rec.persons), ['ada', 'di'])
    assert.equal(rec.tuples.length, 3)
    assert.equal(rec.shares.length, 2)
    assert.equal(rec.log.length, imported.log.length + 1)
    const last = rec.log[rec.log.length - 1]
    assert.equal(last.text, `imported ${file}, replacing the record of device:laptop`)
    assert.equal(last.at, NOW)
  })
  it('--merge adds what is missing, keeps ours, dedupes tuples, renumbers and shifts the share lines, keeps our device', async () => {
    const a = await ours()
    withRecord(a, (r) => { r.persons.bo.removedAt = NOW })
    const file = await theirs()
    const r = await a.run('import', file, '--merge', '--json')
    assert.equal(r.code, 0, r.stderr)
    const s = r.json<{ mode: string; added: Record<string, number>; skipped: Record<string, number> }>()
    assert.equal(s.mode, 'merge')
    assert.deepEqual(s.added, { zones: 1, persons: 1, tags: 1, tuples: 2, shares: 2 })
    assert.deepEqual(s.skipped, { zones: 1, persons: 1, tags: 0, tuples: 1, shares: 0 })
    const rec = a.record()
    assert.equal(rec.device, 'device:laptop')
    assert.equal(rec.zones.friend?.label, 'Friends', 'our zone entry is kept')
    assert.equal(rec.zones.closest?.label, 'Inner')
    assert.equal(rec.persons.ada.name, 'Ada', 'our person entry is kept')
    assert.equal(rec.persons.di.name, 'Di')
    assert.ok(rec.persons.bo.removedAt, 'a person removed here stays removed')
    assert.equal(rec.tuples.length, 5 + 2)
    assert.equal(rec.tuples.filter((t) => t.subject === 'person:ada' && t.relation === 'in_zone').length, 1, 'the duplicate tuple is not added')
    assert.deepEqual(rec.shares.map((l) => [l.op, l.id, l.seq]), [['share', 'item:bike', 1], ['share', 'item:seeds', 2], ['revoke', 'item:seeds', 3]])
    const seeds = rec.shares[1] as Extract<ShareLine, { op: 'share' }>
    assert.equal(seeds.cutoff, 2, 'cutoff shifted by the same offset as seq')
    const revoke = rec.shares[2] as Extract<ShareLine, { op: 'revoke' }>
    assert.equal(revoke.at, 3, 'a revoke\'s at shifts too')
    // log: both inits sorted by time (theirs began earlier), then the import's own line
    assert.deepEqual(rec.log.map((l) => [l.by, l.command]), [['device:phone', 'init'], ['device:laptop', 'init'], ['device:laptop', `import ${file}`]])
    assert.equal(rec.log[2].text, `imported ${file} (merge): +1 zone, +1 person, +1 tag, +2 tuples, +2 shares`)
  })
  it('--merge of the same file again finds nothing new and writes nothing', async () => {
    const a = await ours()
    const file = await theirs()
    await a.ok('import', file, '--merge')
    const before = readFileSync(recordFile(a), 'utf8')
    const r = await a.run('import', file, '--merge')
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /nothing new/)
    assert.equal(readFileSync(recordFile(a), 'utf8'), before)
  })
  it('--merge --dry-run prints the summary and writes nothing', async () => {
    const a = await ours()
    const before = readFileSync(recordFile(a), 'utf8')
    const r = await a.run('import', await theirs(), '--merge', '--dry-run')
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /dry run/)
    assert.match(r.stdout, /persons\s+\+1/)
    assert.match(r.stdout, /tuples\s+\+2\s+\(1 already here\)/)
    assert.equal(readFileSync(recordFile(a), 'utf8'), before)
  })
  it('after a merge the record is still one the CLI reads, and the merged person counts in the merged zone', async () => {
    const a = await ours()
    await a.ok('import', await theirs(), '--merge')
    const md = await a.ok('export', '--format', 'markdown')
    const di = md.slice(md.indexOf('# person:di'), md.indexOf('# tag:'))
    assert.match(di, /- zone: closest/)
    assert.equal((await a.run('log')).code, 0)
  })
})
