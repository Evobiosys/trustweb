// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** `trustweb person`: list, add (and re-add), rename, remove (closing every tuple that names them), tag, untag. Made-up ids only. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { serializeRecord } from '../src/record.ts'
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

interface PersonRow { person: string; name: string; state: string; zone: string; tags: string[]; added: string; removed?: string }

describe('person list', () => {
  it('lists live persons by id with name, zone (public when none, archived zones ignored), direct tags and when added', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => {
      r.persons.di = { name: 'Di', addedAt: NOW, removedAt: NOW }
      r.persons.eve = { name: 'eve', addedAt: NOW }
      r.tuples.push({ subject: 'person:eve', relation: 'in_zone', object: 'zone:community', since: NOW, by: 'device:laptop' })
    })
    const rows = (await cli.run('person', 'list', '--json')).json<PersonRow[]>()
    assert.deepEqual(rows.map((r) => r.person), ['person:ada', 'person:bo', 'person:cy', 'person:eve'])
    assert.deepEqual(rows[0], { person: 'person:ada', name: 'Ada', state: 'live', zone: 'friend', tags: [], added: NOW })
    assert.deepEqual(rows[1].tags, ['tag:garden'])
    assert.equal(rows[1].zone, 'public')
    assert.equal(rows[2].zone, 'close')
    assert.equal(rows[3].zone, 'public', 'community is archived, so eve counts as public')
    const text = await cli.ok('person', 'list')
    assert.match(text, /^person\s+name\s+zone\s+tags\s+added/m)
    assert.match(text, /person:bo\s+Bo\s+public\s+tag:garden\s+2026-11-02 12:00/)
    assert.doesNotMatch(text, /person:di/)
  })
  it('--all shows removed persons too, with a state column', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => { r.persons.di = { name: 'Di', addedAt: NOW, removedAt: NOW } })
    const rows = (await cli.run('person', 'list', '--all', '--json')).json<PersonRow[]>()
    assert.deepEqual(rows.find((r) => r.person === 'person:di'), { person: 'person:di', name: 'Di', state: 'removed', zone: 'public', tags: [], added: NOW, removed: NOW })
    const text = await cli.ok('person', 'list', '--all')
    assert.match(text, /^person\s+name\s+state\s+zone/m)
    assert.match(text, /person:di\s+Di\s+removed/)
  })
  it('an empty record lists (none)', async () => {
    const cli = new Cli()
    await cli.ok('init')
    assert.match(await cli.ok('person', 'list'), /\(none\)/)
    assert.deepEqual((await cli.run('person', 'list', '--json')).json(), [])
  })
})

describe('person add / rename', () => {
  it('adds with a name (default: the bare id), logs it, and refuses a live one with a hint', async () => {
    const cli = new Cli()
    await cli.ok('init')
    const r = await cli.run('person', 'add', 'ada', '--name', 'Ada', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { person: 'person:ada', name: 'Ada', result: 'added' })
    assert.deepEqual(cli.record().persons.ada, { name: 'Ada', addedAt: NOW })
    assert.equal(lastLog(cli), 'added person ada ("Ada")')
    await cli.ok('person', 'add', 'person:bo')
    assert.equal(cli.record().persons.bo?.name, 'bo')
    await refuses(cli, ['person', 'add', 'ada'], /person ada is already in this record.*person rename ada/)
    await refuses(cli, ['person', 'add', 'not valid'], /not a valid person id/)
    await refuses(cli, ['person', 'add', 'tag:ada'], /a person id is expected/)
    await refuses(cli, ['person', 'add', 'cy', '--name', ' '], /name/)
  })
  it('re-adding a removed person revives the same entry (zones and tags stay closed)', async () => {
    const cli = await seeded()
    await cli.ok('person', 'remove', 'ada', '--now', LATER)
    const r = await cli.run('person', 'add', 'ada', '--json', '--now', LATER)
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { person: 'person:ada', name: 'Ada', result: 're-added' })
    assert.deepEqual(cli.record().persons.ada, { name: 'Ada', addedAt: NOW })
    assert.equal(lastLog(cli), 're-added person ada ("Ada")')
    const rows = (await cli.run('person', 'list', '--json', '--now', LATER)).json<PersonRow[]>()
    assert.equal(rows.find((p) => p.person === 'person:ada')?.zone, 'public')
  })
  it('renames; the same name again is said and not written; unknown or empty is refused', async () => {
    const cli = await seeded()
    const r = await cli.run('person', 'rename', 'ada', 'Ada L.', '--json')
    assert.deepEqual(r.json(), { person: 'person:ada', name: 'Ada L.', previous: 'Ada', changed: true })
    assert.equal(lastLog(cli), 'renamed person ada from "Ada" to "Ada L."')
    const before = bytes(cli)
    assert.match(await cli.ok('person', 'rename', 'ada', 'Ada L.'), /already/)
    assert.equal(bytes(cli), before)
    await refuses(cli, ['person', 'rename', 'eve', 'Eve'], /person eve is not in this record/)
    await refuses(cli, ['person', 'rename', 'ada', '  '], /name/)
  })
})

describe('person remove', () => {
  it('sets removedAt, closes every live tuple naming the person as subject or object, and keeps them as history', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => {
      r.tuples.push({ subject: 'person:cy', relation: 'may_read', object: 'item:bike', since: NOW, by: 'device:laptop' })
      r.tuples.push({ subject: 'tag:roses', relation: 'grants', object: 'person:cy', since: NOW, by: 'device:laptop' })
    })
    const count = cli.record().tuples.length
    const r = await cli.run('person', 'remove', 'cy', '--json', '--now', LATER)
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { persons: ['person:cy'], closed: 4 })
    const rec = cli.record()
    assert.equal(rec.persons.cy?.removedAt, LATER)
    assert.equal(rec.tuples.length, count)
    assert.ok(rec.tuples.filter((t) => t.subject === 'person:cy' || t.object === 'person:cy').every((t) => t.until === LATER))
    assert.equal(rec.tuples.find((t) => t.subject === 'tag:roses' && t.relation === 'nested_in')?.until, undefined)
    assert.equal(lastLog(cli), 'removed person cy (4 tuples closed)')
    const rows = (await cli.run('person', 'list', '--json', '--now', LATER)).json<PersonRow[]>()
    assert.ok(!rows.some((p) => p.person === 'person:cy'))
  })
  it('removes several at once in one commit; refuses an unknown or already removed one before writing anything', async () => {
    const cli = await seeded()
    await cli.ok('person', 'remove', 'ada', 'bo')
    assert.equal(lastLog(cli), 'removed persons ada, bo (2 tuples closed)')
    await refuses(cli, ['person', 'remove', 'cy', 'ada'], /person ada was already removed/)
    await refuses(cli, ['person', 'remove', 'cy', 'eve'], /person eve is not in this record/)
  })
})

describe('person tag / untag', () => {
  it('tags with several tags, says which were already held, and is idempotent', async () => {
    const cli = await seeded()
    const r = await cli.run('person', 'tag', 'bo', 'garden', 'tag:roses', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { person: 'person:bo', tags: [{ tag: 'tag:garden', result: 'already' }, { tag: 'tag:roses', result: 'added' }] })
    assert.equal(lastLog(cli), 'tagged bo with roses')
    const before = bytes(cli)
    assert.match(await cli.ok('person', 'tag', 'bo', 'roses'), /tag:roses\s+already/)
    assert.equal(bytes(cli), before)
  })
  it('refuses an unknown or removed person, an unknown or removed tag', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => { r.tags.choir = { label: 'choir', addedAt: NOW, removedAt: NOW } })
    await refuses(cli, ['person', 'tag', 'eve', 'garden'], /person eve is not in this record/)
    await refuses(cli, ['person', 'tag', 'bo', 'roses', 'choir'], /tag choir is not in this record/)
  })
  it('untag closes the has_tag tuple; a tag held only through nesting, or not at all, is refused', async () => {
    const cli = await seeded()
    await refuses(cli, ['person', 'untag', 'cy', 'garden'], /cy holds tag:garden only through tag:roses.*person untag cy roses.*tag unnest/)
    await refuses(cli, ['person', 'untag', 'ada', 'garden'], /ada does not hold tag:garden/)
    const r = await cli.run('person', 'untag', 'bo', 'garden', '--json', '--now', LATER)
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { person: 'person:bo', tags: ['tag:garden'], closed: 1 })
    assert.equal(cli.record().tuples.find((t) => t.subject === 'person:bo' && t.relation === 'has_tag')?.until, LATER)
    assert.equal(lastLog(cli), 'untagged bo: garden')
  })
})

describe('person: end to end', () => {
  it('add -> tag -> zone through the tag -> list -> untag -> list -> remove -> list --all', async () => {
    const cli = new Cli()
    await cli.ok('init', '--device', 'laptop')
    await cli.ok('person', 'add', 'di', '--name', 'Di')
    await cli.ok('tag', 'add', 'choir')
    await cli.ok('zone', 'create', 'friend')
    await cli.ok('zone', 'add-tag', 'friend', 'choir')
    await cli.ok('person', 'tag', 'di', 'choir')
    let rows = (await cli.run('person', 'list', '--json')).json<PersonRow[]>()
    assert.deepEqual(rows, [{ person: 'person:di', name: 'Di', state: 'live', zone: 'friend', tags: ['tag:choir'], added: NOW }])
    await cli.ok('person', 'untag', 'di', 'choir')
    rows = (await cli.run('person', 'list', '--json')).json<PersonRow[]>()
    assert.equal(rows[0].zone, 'public')
    await cli.ok('person', 'remove', 'di')
    assert.match(await cli.ok('person', 'list'), /\(none\)/)
    assert.match(await cli.ok('person', 'list', '--all'), /person:di\s+Di\s+removed/)
    assert.deepEqual(cli.record().log.slice(-4).map((l) => l.command), ['zone add-tag friend choir', 'person tag di choir', 'person untag di choir', 'person remove di'])
  })
})
