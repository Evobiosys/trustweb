// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** `trustweb tag`: list, add (and re-add), rename, remove (closing every tuple that names it), nest, unnest. Made-up ids only. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { serializeRecord } from '../src/record.ts'
import { Zone } from '../src/sink.ts'
import { Cli, NOW, seeded, withRecord } from './helpers/run.ts'

const LATER = '2026-11-03T09:00:00.000Z'
const lastLog = (cli: Cli): string => cli.record().log.at(-1)?.text ?? ''
const bytes = (cli: Cli): string => serializeRecord(cli.record())

async function refuses(cli: Cli, argv: string[], message: RegExp): Promise<void> {
  const before = bytes(cli)
  const r = await cli.run(...argv)
  assert.equal(r.code, 1, `\`trustweb ${argv.join(' ')}\` exited ${r.code}: ${r.stderr}${r.stdout}`)
  assert.match(r.stderr, message)
  assert.equal(bytes(cli), before, `\`trustweb ${argv.join(' ')}\` wrote to the record`)
}

interface TagRow { tag: string; label: string; state: string; carriers: number; nestedIn: string[]; zones: string[]; added: string; removed?: string }

describe('tag list', () => {
  it('lists live tags with label, direct carriers, parents, rule zones and when added', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => {
      r.tags.choir = { label: 'Choir', addedAt: NOW, removedAt: NOW }
      r.tuples.push({ subject: 'tag:roses', relation: 'in_zone', object: 'zone:friend', since: NOW, by: 'device:laptop' })
    })
    const rows = (await cli.run('tag', 'list', '--json')).json<TagRow[]>()
    assert.deepEqual(rows, [
      { tag: 'tag:garden', label: 'garden', state: 'live', carriers: 1, nestedIn: [], zones: [], added: NOW },
      { tag: 'tag:roses', label: 'roses', state: 'live', carriers: 1, nestedIn: ['tag:garden'], zones: ['friend'], added: NOW },
    ])
    const text = await cli.ok('tag', 'list')
    assert.match(text, /^tag\s+label\s+carriers\s+nested-in\s+zones\s+added/m)
    assert.match(text, /tag:roses\s+roses\s+1\s+tag:garden\s+friend\s+2026-11-02 12:00/)
    assert.doesNotMatch(text, /choir/)
    const all = (await cli.run('tag', 'list', '--all', '--json')).json<TagRow[]>()
    assert.deepEqual(all[0], { tag: 'tag:choir', label: 'Choir', state: 'removed', carriers: 0, nestedIn: [], zones: [], added: NOW, removed: NOW })
    assert.match(await cli.ok('tag', 'list', '--all'), /tag:choir\s+Choir\s+removed/)
  })
})

describe('tag add / rename', () => {
  it('adds with a label (default: the bare id), refuses a live one, revives a removed one', async () => {
    const cli = await seeded()
    const r = await cli.run('tag', 'add', 'choir', '--label', 'Choir', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { tag: 'tag:choir', label: 'Choir', result: 'added' })
    assert.equal(lastLog(cli), 'added tag choir ("Choir")')
    await refuses(cli, ['tag', 'add', 'garden'], /tag garden is already in this record.*tag rename garden/)
    await refuses(cli, ['tag', 'add', 'person:garden'], /a tag id is expected/)
    await cli.ok('tag', 'remove', 'choir')
    const again = await cli.run('tag', 'add', 'choir', '--label', 'Singers', '--json')
    assert.deepEqual(again.json(), { tag: 'tag:choir', label: 'Singers', result: 're-added' })
    assert.deepEqual(cli.record().tags.choir, { label: 'Singers', addedAt: NOW })
    assert.equal(lastLog(cli), 're-added tag choir ("Singers")')
  })
  it('renames; the same label again writes nothing; unknown or empty is refused', async () => {
    const cli = await seeded()
    const r = await cli.run('tag', 'rename', 'garden', 'Garden club', '--json')
    assert.deepEqual(r.json(), { tag: 'tag:garden', label: 'Garden club', previous: 'garden', changed: true })
    assert.equal(lastLog(cli), 'renamed tag garden from "garden" to "Garden club"')
    const before = bytes(cli)
    assert.match(await cli.ok('tag', 'rename', 'garden', 'Garden club'), /already/)
    assert.equal(bytes(cli), before)
    await refuses(cli, ['tag', 'rename', 'choir', 'Choir'], /tag choir is not in this record/)
    await refuses(cli, ['tag', 'rename', 'garden', ''], /label/)
  })
})

describe('tag remove', () => {
  it('closes every tuple naming the tag (carriers, nesting both ways, rules, grants) and reports the counts', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => {
      const by = 'device:laptop'
      r.tags.choir = { label: 'choir', addedAt: NOW }
      r.tuples.push(
        { subject: 'tag:garden', relation: 'in_zone', object: 'zone:friend', since: NOW, by },
        { subject: 'tag:garden', relation: 'nested_in', object: 'tag:choir', since: NOW, by },
        { subject: 'tag:garden', relation: 'may_read', object: 'item:seeds', since: NOW, by },
      )
    })
    const count = cli.record().tuples.length
    const r = await cli.run('tag', 'remove', 'garden', '--json', '--now', LATER)
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { tags: ['tag:garden'], closed: 5, byRelation: { has_tag: 1, in_zone: 1, may_read: 1, nested_in: 2 } })
    const rec = cli.record()
    assert.equal(rec.tags.garden?.removedAt, LATER)
    assert.equal(rec.tuples.length, count)
    assert.ok(rec.tuples.filter((t) => t.subject === 'tag:garden' || t.object === 'tag:garden').every((t) => t.until === LATER))
    assert.equal(lastLog(cli), 'removed tag garden (5 tuples closed: 1 has_tag, 1 in_zone, 1 may_read, 2 nested_in)')
    await refuses(cli, ['tag', 'remove', 'garden', '--now', LATER], /tag garden was already removed/)
    await refuses(cli, ['tag', 'remove', 'roses', 'choir', 'seeds', '--now', LATER], /tag seeds is not in this record/)
  })
  it('warns when a current share still names the tag in its scope (an exclusion through it stops biting)', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => {
      r.shares.push({ op: 'share', id: 'item:bike', seq: 1, scope: { zone: Zone.Friend, include: [], exclude: ['tag:roses'] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep', ts: NOW })
    })
    const r = await cli.run('tag', 'remove', 'roses')
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stderr, /warning: tag:roses is still named in the scope of item:bike/)
  })
})

describe('tag nest / unnest', () => {
  it('nests a child under a parent; again is already; unnest closes it', async () => {
    const cli = await seeded()
    await cli.ok('tag', 'add', 'choir')
    const r = await cli.run('tag', 'nest', 'choir', 'tag:garden', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { child: 'tag:choir', parent: 'tag:garden', result: 'nested' })
    assert.ok(cli.record().tuples.some((t) => t.subject === 'tag:choir' && t.relation === 'nested_in' && t.object === 'tag:garden' && t.by === 'device:laptop'))
    assert.equal(lastLog(cli), 'nested tag choir in garden')
    const before = bytes(cli)
    const again = await cli.run('tag', 'nest', 'choir', 'garden', '--json')
    assert.deepEqual(again.json(), { child: 'tag:choir', parent: 'tag:garden', result: 'already' })
    assert.equal(bytes(cli), before)
    const u = await cli.run('tag', 'unnest', 'choir', 'garden', '--json', '--now', LATER)
    assert.deepEqual(u.json(), { child: 'tag:choir', parent: 'tag:garden', closed: 1 })
    assert.equal(lastLog(cli), 'unnested tag choir from garden')
    await refuses(cli, ['tag', 'unnest', 'choir', 'garden', '--now', LATER], /tag:choir is not nested in tag:garden/)
  })
  it('refuses a cycle and a chain deeper than the limit with the share sink\'s own words; unknown tags too', async () => {
    const cli = await seeded()
    await refuses(cli, ['tag', 'nest', 'garden', 'roses'], /share sink: tag:garden under tag:roses would make a cycle/)
    await refuses(cli, ['tag', 'nest', 'garden', 'garden'], /would make a cycle/)
    await cli.ok('tag', 'add', 'a1')
    await cli.ok('tag', 'add', 'a2')
    await cli.ok('tag', 'add', 'a3')
    await cli.ok('tag', 'nest', 'garden', 'a1')
    await cli.ok('tag', 'nest', 'a1', 'a2')
    await refuses(cli, ['tag', 'nest', 'a2', 'a3'], /deeper than 4 levels/)
    await refuses(cli, ['tag', 'nest', 'choir', 'garden'], /tag choir is not in this record/)
  })
  it('a closed nesting no longer counts for the cycle check', async () => {
    const cli = await seeded()
    await cli.ok('tag', 'unnest', 'roses', 'garden', '--now', LATER)
    await cli.ok('tag', 'nest', 'garden', 'roses', '--now', LATER)
    assert.equal(lastLog(cli), 'nested tag garden in roses')
  })
})

describe('tag: end to end', () => {
  it('add -> carriers -> nest -> zone rule reaches the nested carriers -> remove the parent -> they leave the zone', async () => {
    const cli = new Cli()
    await cli.ok('init', '--device', 'laptop')
    await cli.ok('person', 'add', 'ada')
    await cli.ok('person', 'add', 'bo')
    await cli.ok('tag', 'add', 'garden')
    await cli.ok('tag', 'add', 'roses')
    await cli.ok('person', 'tag', 'ada', 'roses')
    await cli.ok('person', 'tag', 'bo', 'garden')
    await cli.ok('tag', 'nest', 'roses', 'garden')
    await cli.ok('zone', 'create', 'friend')
    await cli.ok('zone', 'add-tag', 'friend', 'garden')
    const rows = (await cli.run('tag', 'list', '--json')).json<TagRow[]>()
    assert.deepEqual(rows.map((t) => [t.tag, t.carriers, t.nestedIn, t.zones]), [['tag:garden', 1, [], ['friend']], ['tag:roses', 1, ['tag:garden'], []]])
    const persons = (await cli.run('person', 'list', '--json')).json<{ zone: string }[]>()
    assert.deepEqual(persons.map((p) => p.zone), ['friend', 'friend'])
    await cli.ok('tag', 'remove', 'garden')
    const after = (await cli.run('person', 'list', '--json')).json<{ zone: string }[]>()
    assert.deepEqual(after.map((p) => p.zone), ['public', 'public'])
    assert.match(lastLog(cli), /^removed tag garden \(3 tuples closed/)
  })
})
