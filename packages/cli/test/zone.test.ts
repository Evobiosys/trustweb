// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** `trustweb zone`: the ladder listing, set up / rename / archive / unarchive, direct members and tag rules. Made-up ids only. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { serializeRecord } from '../src/record.ts'
import { Zone } from '../src/sink.ts'
import { Cli, NOW, seeded, withRecord } from './helpers/run.ts'

const LATER = '2026-11-03T09:00:00.000Z'
const lastLog = (cli: Cli): string => cli.record().log.at(-1)?.text ?? ''
const bytes = (cli: Cli): string => serializeRecord(cli.record())

/** Runs a command that must refuse: exit 1, the message matches, and the record is byte-identical afterwards. */
async function refuses(cli: Cli, argv: string[], message: RegExp): Promise<void> {
  const before = bytes(cli)
  const r = await cli.run(...argv)
  assert.equal(r.code, 1, `\`trustweb ${argv.join(' ')}\` exited ${r.code}: ${r.stderr}${r.stdout}`)
  assert.match(r.stderr, message)
  assert.equal(bytes(cli), before, `\`trustweb ${argv.join(' ')}\` wrote to the record`)
}

interface ZoneRow { zone: string; state: string; label: string; members: number; tags: number }

describe('zone list', () => {
  it('shows all eight rungs outer to inner on an empty record', async () => {
    const cli = new Cli()
    await cli.ok('init')
    const rows = (await cli.run('zone', 'list', '--json')).json<ZoneRow[]>()
    assert.deepEqual(rows.map((r) => r.zone), ['public', 'intending', 'acquaintance', 'community', 'friend', 'close', 'closest', 'self'])
    assert.deepEqual(rows[0], { zone: 'public', state: 'always-on', label: 'Public', members: 0, tags: 0 })
    assert.deepEqual(rows[4], { zone: 'friend', state: 'not set up', label: 'Friends', members: 0, tags: 0 })
    const text = await cli.ok('zone', 'list')
    assert.match(text, /^zone\s+state\s+label\s+members\s+tags/m)
    assert.match(text, /intending\s+not set up\s+Intending to connect/)
  })
  it('counts direct members, members through tag rules (nested tags too), and tag rules', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => {
      r.tuples.push({ subject: 'tag:garden', relation: 'in_zone', object: 'zone:friend', since: NOW, by: 'device:laptop' })
    })
    const rows = (await cli.run('zone', 'list', '--json')).json<ZoneRow[]>()
    const friend = rows.find((r) => r.zone === 'friend')
    // ada directly, bo through garden, cy through roses (nested in garden).
    assert.deepEqual(friend, { zone: 'friend', state: 'on', label: 'Friends', members: 3, tags: 1 })
    assert.equal(rows.find((r) => r.zone === 'community')?.state, 'archived')
    assert.equal(rows.find((r) => r.zone === 'close')?.members, 1)
  })
})

describe('zone create', () => {
  it('sets up a zone with the ladder label, logs it, and lists it as on', async () => {
    const cli = new Cli()
    await cli.ok('init')
    const r = await cli.run('zone', 'create', 'friend', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { zone: 'friend', label: 'Friends', state: 'on' })
    assert.deepEqual(cli.record().zones.friend, { label: 'Friends', createdAt: NOW })
    assert.equal(lastLog(cli), 'set up zone friend ("Friends")')
    assert.equal(cli.record().log.at(-1)?.command, 'zone create friend')
  })
  it('takes --label and a typed zone id', async () => {
    const cli = new Cli()
    await cli.ok('init')
    const text = await cli.ok('zone', 'create', 'zone:close', '--label', 'Allies')
    assert.match(text, /set up zone close \("Allies"\)/)
    assert.equal(cli.record().zones.close?.label, 'Allies')
  })
  it('refuses public and self, a zone already set up (hint rename), an archived one (hint unarchive), an empty label, a word off the ladder', async () => {
    const cli = await seeded()
    await refuses(cli, ['zone', 'create', 'public'], /always on/)
    await refuses(cli, ['zone', 'create', 'self'], /always on/)
    await refuses(cli, ['zone', 'create', 'friend'], /already set up.*zone rename/)
    await refuses(cli, ['zone', 'create', 'community'], /archived.*zone unarchive community/)
    await refuses(cli, ['zone', 'create', 'closest', '--label', '  '], /label/)
    await refuses(cli, ['zone', 'create', 'besties'], /not a trust zone/)
  })
})

describe('zone rename', () => {
  it('relabels a zone (archived too), and says so when the label is already that, writing nothing', async () => {
    const cli = await seeded()
    const r = await cli.run('zone', 'rename', 'friend', '  Good friends ', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { zone: 'friend', label: 'Good friends', previous: 'Friends', changed: true })
    assert.equal(cli.record().zones.friend?.label, 'Good friends')
    assert.equal(lastLog(cli), 'renamed zone friend from "Friends" to "Good friends"')
    await cli.ok('zone', 'rename', 'community', 'Neighbours')
    assert.equal(cli.record().zones.community?.label, 'Neighbours')
    const before = bytes(cli)
    const same = await cli.ok('zone', 'rename', 'friend', 'Good friends')
    assert.match(same, /already/)
    assert.equal(bytes(cli), before)
  })
  it('refuses an empty label, a zone not set up, and public/self', async () => {
    const cli = await seeded()
    await refuses(cli, ['zone', 'rename', 'friend', '   '], /label/)
    await refuses(cli, ['zone', 'rename', 'closest', 'Few'], /not set up.*zone create closest/)
    await refuses(cli, ['zone', 'rename', 'public', 'Everyone'], /always on/)
  })
})

describe('zone archive / unarchive', () => {
  it('archives, warns who now counts less intimate and which shares move one ring in, and unarchives', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => {
      r.shares.push({ op: 'share', id: 'item:bike', seq: 1, scope: { zone: Zone.Friend, include: [], exclude: [] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep', ts: NOW })
    })
    const r = await cli.run('zone', 'archive', 'friend', '--json', '--now', LATER)
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { zone: 'friend', state: 'archived', archivedAt: LATER, membersLessIntimate: 1, sharesMoved: 1, movedTo: 'close' })
    assert.match(r.stderr, /warning: 1 person in friend now counts as a less intimate zone/)
    assert.match(r.stderr, /warning: 1 item shared to friend now opens only to close/)
    assert.equal(cli.record().zones.friend?.archivedAt, LATER)
    assert.match(lastLog(cli), /^archived zone friend/)
    const u = await cli.run('zone', 'unarchive', 'friend', '--json')
    assert.equal(u.code, 0, u.stderr)
    assert.deepEqual(u.json(), { zone: 'friend', state: 'on' })
    assert.equal(cli.record().zones.friend?.archivedAt, undefined)
    assert.equal(lastLog(cli), 'unarchived zone friend')
  })
  it('a member who also sits in a more intimate zone does not count as moved; nothing to say means no warning', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => {
      r.tuples.push({ subject: 'person:cy', relation: 'in_zone', object: 'zone:friend', since: NOW, by: 'device:laptop' })
      r.tuples = r.tuples.filter((t) => !(t.subject === 'person:ada' && t.relation === 'in_zone'))
    })
    const r = await cli.run('zone', 'archive', 'friend', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.json<{ membersLessIntimate: number }>().membersLessIntimate, 0)
    assert.equal(r.stderr, '')
  })
  it('refuses public/self, an already archived zone, a zone not set up; unarchive refuses a zone that is on', async () => {
    const cli = await seeded()
    await refuses(cli, ['zone', 'archive', 'self'], /always on/)
    await refuses(cli, ['zone', 'archive', 'community'], /already archived/)
    await refuses(cli, ['zone', 'archive', 'closest'], /not set up/)
    await refuses(cli, ['zone', 'unarchive', 'friend'], /not archived/)
    await refuses(cli, ['zone', 'unarchive', 'closest'], /not set up/)
  })
})

describe('zone add-person / remove-person', () => {
  it('adds several persons in one commit, says who was already in, and is idempotent', async () => {
    const cli = await seeded()
    const logs = cli.record().log.length
    const r = await cli.run('zone', 'add-person', 'friend', 'ada', 'person:bo', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { zone: 'friend', persons: [{ person: 'person:ada', result: 'already in zone' }, { person: 'person:bo', result: 'added' }] })
    assert.equal(cli.record().log.length, logs + 1)
    assert.equal(lastLog(cli), 'added bo to zone friend')
    assert.ok(cli.record().tuples.some((t) => t.subject === 'person:bo' && t.relation === 'in_zone' && t.object === 'zone:friend' && t.by === 'device:laptop' && t.since === NOW))
    const before = bytes(cli)
    const again = await cli.ok('zone', 'add-person', 'friend', 'bo')
    assert.match(again, /person:bo\s+already in zone/)
    assert.equal(bytes(cli), before)
  })
  it('refuses an archived or unknown zone, an unknown or removed person, and writes nothing', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => { r.persons.di = { name: 'Di', addedAt: NOW, removedAt: NOW } })
    await refuses(cli, ['zone', 'add-person', 'community', 'bo'], /archived.*zone unarchive community/)
    await refuses(cli, ['zone', 'add-person', 'closest', 'bo'], /not set up/)
    await refuses(cli, ['zone', 'add-person', 'friend', 'bo', 'eve'], /person eve is not in this record.*person add eve/)
    await refuses(cli, ['zone', 'add-person', 'friend', 'di'], /person di is not in this record/)
    await refuses(cli, ['zone', 'add-person', 'self', 'bo'], /always on/)
  })
  it('remove-person closes the direct membership (kept as history), also from an archived zone', async () => {
    const cli = await seeded()
    const r = await cli.run('zone', 'remove-person', 'friend', 'ada', '--json', '--now', LATER)
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { zone: 'friend', persons: ['person:ada'], closed: 1 })
    const t = cli.record().tuples.find((x) => x.subject === 'person:ada' && x.object === 'zone:friend')
    assert.equal(t?.until, LATER)
    assert.equal(lastLog(cli), 'removed ada from zone friend')
    withRecord(cli, (rec) => { rec.tuples.push({ subject: 'person:bo', relation: 'in_zone', object: 'zone:community', since: NOW, by: 'device:laptop' }) })
    await cli.ok('zone', 'remove-person', 'community', 'bo')
    assert.equal(cli.record().tuples.filter((x) => x.subject === 'person:bo' && x.object === 'zone:community' && !x.until).length, 0)
  })
  it('refuses a non-member before writing anything, and names the tag when the person is only in through a rule', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => { r.tuples.push({ subject: 'tag:garden', relation: 'in_zone', object: 'zone:friend', since: NOW, by: 'device:laptop' }) })
    await refuses(cli, ['zone', 'remove-person', 'friend', 'ada', 'bo'], /bo is in zone friend only through tag:garden.*zone remove-tag friend garden.*person untag bo garden/)
    await refuses(cli, ['zone', 'remove-person', 'friend', 'cy'], /cy is in zone friend only through tag:garden/)
    await refuses(cli, ['zone', 'remove-person', 'close', 'ada'], /ada is not a member of zone close/)
    await refuses(cli, ['zone', 'remove-person', 'friend', 'eve'], /person eve is not in this record/)
    await refuses(cli, ['zone', 'remove-person', 'closest', 'ada'], /not set up/)
  })
})

describe('zone add-tag / remove-tag', () => {
  it('writes the rule and reports how many persons it places', async () => {
    const cli = await seeded()
    const r = await cli.run('zone', 'add-tag', 'friend', 'garden', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { zone: 'friend', tags: [{ tag: 'tag:garden', result: 'added' }], placed: 2 })
    assert.ok(cli.record().tuples.some((t) => t.subject === 'tag:garden' && t.relation === 'in_zone' && t.object === 'zone:friend'))
    assert.equal(lastLog(cli), 'added tag garden to zone friend (places 2 more persons)')
    const before = bytes(cli)
    const again = await cli.run('zone', 'add-tag', 'friend', 'garden', '--json')
    assert.deepEqual(again.json(), { zone: 'friend', tags: [{ tag: 'tag:garden', result: 'already in zone' }], placed: 0 })
    assert.equal(bytes(cli), before)
  })
  it('refuses an archived zone and an unknown tag', async () => {
    const cli = await seeded()
    await refuses(cli, ['zone', 'add-tag', 'community', 'garden'], /archived/)
    await refuses(cli, ['zone', 'add-tag', 'friend', 'garden', 'choir'], /tag choir is not in this record.*tag add choir/)
  })
  it('remove-tag closes the rule; a tag without a rule there is refused', async () => {
    const cli = await seeded()
    await cli.ok('zone', 'add-tag', 'friend', 'garden', 'roses')
    const r = await cli.run('zone', 'remove-tag', 'friend', 'garden', '--json', '--now', LATER)
    assert.equal(r.code, 0, r.stderr)
    // cy still sits in friend through roses, so only bo leaves.
    assert.deepEqual(r.json(), { zone: 'friend', tags: ['tag:garden'], closed: 1, left: 1 })
    assert.equal(lastLog(cli), 'removed tag garden from zone friend (1 person leaves)')
    await refuses(cli, ['zone', 'remove-tag', 'friend', 'garden', '--now', LATER], /tag:garden has no rule in zone friend/)
    await refuses(cli, ['zone', 'remove-tag', 'close', 'roses'], /tag:roses has no rule in zone close/)
  })
})

describe('zone: end to end', () => {
  it('create -> add persons -> tag rule -> list counts -> archive (warns) -> list shows archived -> log tells the story', async () => {
    const cli = new Cli()
    await cli.ok('init', '--device', 'laptop')
    await cli.ok('person', 'add', 'ada')
    await cli.ok('person', 'add', 'bo')
    await cli.ok('person', 'add', 'cy')
    await cli.ok('tag', 'add', 'choir')
    await cli.ok('person', 'tag', 'cy', 'choir')
    await cli.ok('zone', 'create', 'community', '--label', 'Neighbours')
    await cli.ok('zone', 'add-person', 'community', 'ada', 'bo')
    await cli.ok('zone', 'add-tag', 'community', 'choir')
    const listed = (await cli.run('zone', 'list', '--json')).json<ZoneRow[]>()
    assert.deepEqual(listed.find((z) => z.zone === 'community'), { zone: 'community', state: 'on', label: 'Neighbours', members: 3, tags: 1 })
    const archived = await cli.run('zone', 'archive', 'community')
    assert.equal(archived.code, 0, archived.stderr)
    assert.match(archived.stderr, /3 persons in community now count as a less intimate zone/)
    const text = await cli.ok('zone', 'list')
    assert.match(text, /community\s+archived\s+Neighbours\s+3\s+1/)
    const log = cli.record().log.map((l) => l.text)
    assert.deepEqual(log.slice(-4), [
      'set up zone community ("Neighbours")',
      'added ada, bo to zone community',
      'added tag choir to zone community (places 1 more person)',
      log.at(-1),
    ])
    assert.match(log.at(-1) ?? '', /^archived zone community/)
  })
})
