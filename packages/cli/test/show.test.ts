// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb show`: what a zone, tag, person or item can see, and why. Every answer is checked against the app's canAccess
 * run directly here on the same store (sink.ts), so `show` can never drift from enforcement. Made-up ids only.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { NOW, seeded, withRecord, type Cli } from './helpers/run.ts'
import { activeZones, canAccess, isLive, personIds, storeOf, toMarkdown, unfoldTagRules, type Store, type Tuple } from '../src/sink.ts'
import type { TrustRecord } from '../src/record.ts'

const now = new Date(NOW)
const by = 'device:laptop'
type Why = { subject: string; relation: string; object: string }[]
interface Seen { item: string; why: Why }

const fact = (subject: string, relation: Tuple['relation'], object: string): Tuple => ({ subject, relation, object, since: NOW, by })
const items = (store: Store): string[] =>
  [...new Set(store.filter((t) => isLive(t, now) && (t.relation === 'may_read' || t.relation === 'may_write') && /^(item|file):/.test(t.object)).map((t) => t.object))].sort()
const plain = (why: readonly Tuple[]): Why => why.map((t) => ({ subject: t.subject, relation: t.relation, object: t.object }))

/** The expected answer, straight from canAccess: a probe person whose only standing is this one tuple. */
function probe(r: TrustRecord, relation: 'in_zone' | 'has_tag', object: string): Seen[] {
  const p = fact('person:_probe', relation, object)
  const store = [...storeOf(r, now), p, ...unfoldTagRules([...r.tuples, p], ['person:_probe'], now)]
  return items(store).flatMap((item) => {
    const a = canAccess(store, 'person:_probe', item, now, activeZones(r))
    return a.allowed ? [{ item, why: plain(a.why) }] : []
  })
}
function seenBy(r: TrustRecord, person: string): Seen[] {
  const store = storeOf(r, now)
  return items(store).flatMap((item) => {
    const a = canAccess(store, person, item, now, activeZones(r))
    return a.allowed ? [{ item, why: plain(a.why) }] : []
  })
}

/** seeded() plus: bike shared to friend, seeds to close, ladder to public except tag:roses. */
async function shared(): Promise<Cli> {
  const cli = await seeded()
  await cli.ok('share', 'add', 'bike', '--zone', 'friend')
  await cli.ok('share', 'add', 'seeds', '--zone', 'close')
  await cli.ok('share', 'add', 'ladder', '--zone', 'public', '--except', 'tag:roses')
  return cli
}

describe('show zone', () => {
  it('prints state, label, members and what a member can see, with the why-lines', async () => {
    const cli = await shared()
    const out = await cli.ok('show', 'zone', 'friend')
    const lines = out.split('\n')
    assert.equal(lines[0], 'zone friend')
    assert.ok(lines.includes('state: on'))
    assert.ok(lines.includes('label: Friends'))
    assert.match(out, /^Members:\n {2}person:ada {2}ada \(Ada\)$/m)
    assert.match(out, /^ {2}item:bike\n {4}- person:_probe in_zone zone:friend\n {4}- zone:friend may_read item:bike$/m)
    assert.match(out, /^ {2}item:ladder$/m)
    assert.doesNotMatch(out, /item:seeds/)
  })
  it('--json agrees with canAccess on a probe person, for every zone on the ladder', async () => {
    const cli = await shared()
    const r = cli.record()
    for (const z of ['public', 'intending', 'acquaintance', 'community', 'friend', 'close', 'closest', 'self']) {
      const res = await cli.run('show', 'zone', z, '--json')
      assert.equal(res.code, 0, res.stderr)
      const j = res.json<{ zone: string; state: string; label: string; members: unknown[]; items: Seen[] }>()
      assert.equal(j.zone, z)
      assert.deepEqual(j.items, probe(r, 'in_zone', `zone:${z}`), z)
    }
    const close = (await cli.run('show', 'zone', 'close', '--json')).json()
    assert.deepEqual(close, {
      zone: 'close', state: 'on', label: 'Close friends and allies',
      members: [{ person: 'person:cy' }],
      items: [
        { item: 'item:bike', why: [{ subject: 'person:_probe', relation: 'in_zone', object: 'zone:close' }, { subject: 'zone:friend', relation: 'may_read', object: 'item:bike' }] },
        { item: 'item:ladder', why: [{ subject: 'zone:public', relation: 'may_read', object: 'item:ladder' }] },
        { item: 'item:seeds', why: [{ subject: 'person:_probe', relation: 'in_zone', object: 'zone:close' }, { subject: 'zone:close', relation: 'may_read', object: 'item:seeds' }] },
      ],
    })
  })
  it('states: public and self always on, community archived, acquaintance not set up', async () => {
    const cli = await shared()
    const state = async (z: string): Promise<string> => (await cli.run('show', 'zone', z, '--json')).json<{ state: string }>().state
    assert.equal(await state('public'), 'always-on')
    assert.equal(await state('self'), 'always-on')
    assert.equal(await state('community'), 'archived')
    assert.equal(await state('acquaintance'), 'not set up')
    assert.match(await cli.ok('show', 'zone', 'acquaintance'), /zone acquaintance is not set up: a member counts as public/)
  })
  it('an archived zone: its members count as public, and an item shared to it moves one ring in', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => { r.zones.closest = { label: 'Closest few', createdAt: NOW } })
    await cli.ok('share', 'add', 'seeds', '--zone', 'close')
    withRecord(cli, (r) => { r.zones.close = { ...r.zones.close!, archivedAt: NOW } })
    const close = await cli.ok('show', 'zone', 'close')
    assert.match(close, /^state: archived$/m)
    assert.match(close, /zone close is archived: a member counts as public unless another zone of theirs is on; items shared to close move in to closest/)
    assert.doesNotMatch(close, /item:seeds/)
    const closest = (await cli.run('show', 'zone', 'closest', '--json')).json<{ items: Seen[] }>()
    assert.deepEqual(closest.items.map((s) => s.item), ['item:seeds'])
    assert.deepEqual(closest.items, probe(cli.record(), 'in_zone', 'zone:closest'))
  })
  it('a tag rule makes carriers members (via the tag), and they see the zone\'s items', async () => {
    const cli = await shared()
    withRecord(cli, (r) => { r.tuples.push(fact('tag:garden', 'in_zone', 'zone:friend')) })
    const j = (await cli.run('show', 'zone', 'friend', '--json')).json<{ members: unknown[] }>()
    assert.deepEqual(j.members, [{ person: 'person:ada' }, { person: 'person:bo', via: 'tag:garden' }, { person: 'person:cy', via: 'tag:garden' }])
    assert.match(await cli.ok('show', 'zone', 'friend'), /^ {2}person:bo {3}bo \(Bo\) {2}via tag:garden$/m)
    const bo = (await cli.run('show', 'person', 'bo', '--json')).json<{ items: Seen[] }>()
    assert.ok(bo.items.some((s) => s.item === 'item:bike'))
  })
  it('refuses a zone that is not on the ladder', async () => {
    const cli = await seeded()
    const r = await cli.run('show', 'zone', 'moon')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /not a trust zone/)
  })
})

describe('show tag', () => {
  it('prints parents, children, zones, carriers (direct and through nested tags) and what it opens', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => { r.tuples.push(fact('tag:garden', 'in_zone', 'zone:friend')) })
    await cli.ok('share', 'add', 'bike', '--zone', 'friend')
    await cli.ok('share', 'add', 'seeds', '--zone', 'close', '--also', 'tag:garden')
    await cli.ok('share', 'add', 'ladder', '--zone', 'close')
    const out = await cli.ok('show', 'tag', 'garden')
    assert.match(out, /^tag garden$/m)
    assert.match(out, /^label: garden$/m)
    assert.match(out, /^parents: \(none\)$/m)
    assert.match(out, /^children: tag:roses$/m)
    assert.match(out, /^zones: zone:friend$/m)
    assert.match(out, /^Carried by:\n {2}person:bo {2}bo \(Bo\)$/m)
    assert.match(out, /^Through nested tags:\n {2}person:cy {2}cy \(Cy\) {2}via tag:roses$/m)
    assert.match(out, /^ {2}item:seeds\n {4}- person:_probe has_tag tag:garden\n {4}- tag:garden may_read item:seeds$/m)
    const j = (await cli.run('show', 'tag', 'garden', '--json')).json<{ items: Seen[] }>()
    assert.deepEqual(j, {
      tag: 'tag:garden', label: 'garden', state: 'known', parents: [], children: ['tag:roses'], zones: ['zone:friend'],
      carriers: { direct: ['person:bo'], nested: [{ person: 'person:cy', via: 'tag:roses' }] },
      items: probe(cli.record(), 'has_tag', 'tag:garden'),
    })
    assert.deepEqual(j.items.map((s) => s.item), ['item:bike', 'item:seeds'])
    const roses = (await cli.run('show', 'tag', 'tag:roses', '--json')).json<{ parents: string[]; items: Seen[] }>()
    assert.deepEqual(roses.parents, ['tag:garden'])
    assert.deepEqual(roses.items, probe(cli.record(), 'has_tag', 'tag:roses'))
  })
  it('--markdown prints the share sink\'s own page for the tag', async () => {
    const cli = await seeded()
    await cli.ok('share', 'add', 'seeds', '--zone', 'close', '--also', 'tag:garden')
    const r = cli.record()
    assert.equal(await cli.ok('show', 'tag', 'garden', '--markdown'), toMarkdown(storeOf(r, now), 'tag:garden', now, activeZones(r)))
  })
  it('an unknown tag still answers, with a warning; a removed one says so', async () => {
    const cli = await seeded()
    const r = await cli.run('show', 'tag', 'choir')
    assert.equal(r.code, 0)
    assert.match(r.stderr, /warning: the record does not know tag:choir/)
    assert.match(r.stdout, /^Carried by:\n {2}\(nobody\)$/m)
    withRecord(cli, (rec) => { rec.tags.choir = { label: 'choir', addedAt: NOW, removedAt: NOW } })
    assert.match(await cli.ok('show', 'tag', 'choir'), /^removed: 2026-11-02 12:00$/m)
    assert.equal((await cli.run('show', 'tag', 'choir', '--json')).json<{ state: string }>().state, 'removed')
  })
})

describe('show person', () => {
  it('prints the zone with the tuple behind it, held tags with the nesting path, and what they see with why', async () => {
    const cli = await shared()
    const out = await cli.ok('show', 'person', 'cy')
    assert.match(out, /^person cy$/m)
    assert.match(out, /^name: Cy$/m)
    assert.match(out, /^zone: close \(person:cy in_zone zone:close\)$/m)
    assert.match(out, /^tags: tag:roses, tag:garden \(via tag:roses\)$/m)
    assert.match(out, /^ {2}item:seeds\n {4}- person:cy in_zone zone:close\n {4}- zone:close may_read item:seeds$/m)
    assert.doesNotMatch(out, /item:ladder/)
    const r = cli.record()
    for (const p of personIds(r)) {
      const j = (await cli.run('show', 'person', p, '--json')).json<{ items: Seen[] }>()
      assert.deepEqual(j.items, seenBy(r, p), p)
    }
    const j = (await cli.run('show', 'person', 'cy', '--json')).json()
    assert.deepEqual(j, {
      person: 'person:cy', name: 'Cy', state: 'known', zone: 'close',
      zoneWhy: { subject: 'person:cy', relation: 'in_zone', object: 'zone:close' },
      tags: [{ tag: 'tag:roses', via: [] }, { tag: 'tag:garden', via: ['tag:roses'] }],
      items: seenBy(r, 'person:cy'),
    })
  })
  it('a zone through a tag rule names the tag; bo with no zone is public', async () => {
    const cli = await shared()
    assert.match(await cli.ok('show', 'person', 'bo'), /^zone: public \(no zone\)$/m)
    withRecord(cli, (r) => { r.tuples.push(fact('tag:garden', 'in_zone', 'zone:friend')) })
    assert.match(await cli.ok('show', 'person', 'bo'), /^zone: friend \(person:bo in_zone zone:friend, through tag:garden\)$/m)
  })
  it('--markdown prints the share sink\'s own page for the person', async () => {
    const cli = await shared()
    const r = cli.record()
    assert.equal(await cli.ok('show', 'person', 'cy', '--markdown'), toMarkdown(storeOf(r, now), 'person:cy', now, activeZones(r)))
  })
  it('an archived zone does not count: cy counts as public once close is archived', async () => {
    const cli = await shared()
    withRecord(cli, (r) => { r.zones.close = { ...r.zones.close!, archivedAt: NOW } })
    const j = (await cli.run('show', 'person', 'cy', '--json')).json<{ zone: string; items: Seen[] }>()
    assert.equal(j.zone, 'public')
    assert.deepEqual(j.items, seenBy(cli.record(), 'person:cy'))
  })
  it('an unknown person still answers (public, nothing) with a warning; a removed one says so', async () => {
    const cli = await shared()
    const r = await cli.run('show', 'person', 'zed', '--json')
    assert.equal(r.code, 0)
    assert.match(r.stderr, /warning: the record does not know person:zed/)
    const j = r.json<{ state: string; zone: string; items: Seen[] }>()
    assert.equal(j.state, 'unknown')
    assert.equal(j.zone, 'public')
    assert.deepEqual(j.items.map((s) => s.item), ['item:ladder'])
    const later = '2026-11-03T12:00:00.000Z'
    withRecord(cli, (rec) => {
      rec.persons.ada.removedAt = later
      rec.tuples = rec.tuples.map((t) => (t.subject === 'person:ada' ? { ...t, until: later } : t))
    })
    const out = await cli.ok('show', 'person', 'ada', `--now=${later}`)
    assert.match(out, /^removed: 2026-11-03 12:00$/m)
    assert.match(out, /^zone: public \(no zone\)$/m)
  })
})

describe('show item', () => {
  it('prints the latest share scope and who can see it now, with why', async () => {
    const cli = await seeded()
    await cli.ok('share', 'add', 'bike', '--zone', 'friend', '--also', 'bo', '--except', 'cy')
    const out = await cli.ok('show', 'item', 'bike')
    assert.match(out, /^item bike$/m)
    assert.match(out, /^zone: friend$/m)
    assert.match(out, /^also: person:bo$/m)
    assert.match(out, /^except: person:cy$/m)
    assert.match(out, /^since: 2026-11-02 12:00 \(seq 1\)$/m)
    assert.match(out, /^Who can see it now:\n {2}person:ada {2}ada \(Ada\)\n {4}- person:ada in_zone zone:friend\n {4}- zone:friend may_read item:bike$/m)
    assert.match(out, /^ {2}person:bo {3}bo \(Bo\)\n {4}- person:bo may_read item:bike$/m)
    assert.doesNotMatch(out, /person:cy {2}cy/)
    const r = cli.record()
    const store = storeOf(r, now)
    const expected = personIds(r).flatMap((p) => {
      const a = canAccess(store, p, 'item:bike', now, activeZones(r))
      return a.allowed ? [{ person: p, label: p === 'person:ada' ? 'ada (Ada)' : 'bo (Bo)', why: plain(a.why) }] : []
    })
    assert.deepEqual((await cli.run('show', 'item', 'item:bike', '--json')).json(), {
      item: 'item:bike', share: { zone: 'friend', also: ['person:bo'], except: ['person:cy'], since: NOW, seq: 1 }, people: expected,
    })
  })
  it('an item never shared, or revoked, says "not shared"; a direct grant tuple still counts', async () => {
    const cli = await seeded()
    assert.match(await cli.ok('show', 'item', 'bike'), /^not shared$/m)
    await cli.ok('share', 'add', 'bike', '--zone', 'friend')
    await cli.ok('share', 'revoke', 'bike')
    assert.match(await cli.ok('show', 'item', 'bike'), /^not shared \(revoked 2026-11-02 12:00\)$/m)
    withRecord(cli, (r) => { r.tuples.push(fact('person:bo', 'may_read', 'item:bike')) })
    const j = (await cli.run('show', 'item', 'bike', '--json')).json<{ share: unknown; people: { person: string }[] }>()
    assert.equal(j.share, null)
    assert.deepEqual(j.people.map((p) => p.person), ['person:bo'])
  })
  it('an item shared to an archived zone says where it moved', async () => {
    const cli = await seeded()
    await cli.ok('share', 'add', 'seeds', '--zone', 'close')
    withRecord(cli, (r) => { r.zones.close = { ...r.zones.close!, archivedAt: NOW } })
    const out = await cli.ok('show', 'item', 'seeds')
    assert.match(out, /^zone: close \(archived: counts as self\)$/m)
    assert.match(out, /^Who can see it now:\n {2}\(nobody\)$/m)
  })
})
