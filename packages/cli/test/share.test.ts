// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb share`: add, list, preview, revoke. The preview and `show item` must name the same people for the same scope
 * (T12: one oracle, canAccess, on the same store), including when a zone is archived. Made-up ids only.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Cli, NOW, seeded, withRecord } from './helpers/run.ts'

const LATER = '2026-11-03T09:30:00.000Z'

interface Preview { item: string; zone: string; count: number; people: string[]; names: string[] }
interface ShowItem { item: string; share: unknown; people: { person: string }[] }

const archive = (cli: Cli, zone: 'close' | 'friend'): void => {
  withRecord(cli, (r) => { r.zones[zone] = { ...r.zones[zone]!, archivedAt: NOW } })
}

describe('share add', () => {
  it('appends one share line, prints who would see it, and logs one line', async () => {
    const cli = await seeded()
    const logBefore = cli.record().log.length
    const out = await cli.ok('share', 'add', 'bike', '--zone', 'friend')
    assert.match(out, /^Shared item:bike to zone friend\.$/m)
    assert.match(out, /^2 people would see item:bike: ada \(Ada\), cy \(Cy\)$/m)
    const r = cli.record()
    assert.deepEqual(r.shares, [{
      op: 'share', id: 'item:bike', seq: 1, scope: { zone: 'friend', include: [], exclude: [] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep', ts: NOW,
    }])
    assert.equal(r.log.length, logBefore + 1)
    assert.equal(r.log.at(-1)!.command, 'share add bike')
    assert.match(r.log.at(-1)!.text, /item:bike.*zone friend.*2 people/)
  })
  it('--also and --except take persons and tags; an exclusion beats the zone and the tag', async () => {
    const cli = await seeded()
    assert.match(await cli.ok('share', 'add', 'bike', '--zone', 'friend', '--also', 'bo'), /^3 people would see item:bike: ada \(Ada\), bo \(Bo\), cy \(Cy\)$/m)
    assert.match(await cli.ok('share', 'add', 'ladder', '--zone', 'friend', '--except', 'tag:roses'), /^1 person would see item:ladder: ada \(Ada\)$/m)
    assert.match(await cli.ok('share', 'add', 'seeds', '--zone', 'close', '--also', 'tag:garden', '--except', 'person:cy'), /^1 person would see item:seeds: bo \(Bo\)$/m)
    const seeds = cli.record().shares.at(-1)!
    assert.ok(seeds.op === 'share')
    assert.deepEqual(seeds.scope, { zone: 'close', include: ['tag:garden'], exclude: ['person:cy'] })
  })
  it('public is a zone like any other and always on; nobody is a valid answer', async () => {
    const cli = await seeded()
    assert.match(await cli.ok('share', 'add', 'seeds', '--zone', 'public'), /^3 people would see item:seeds: ada \(Ada\), bo \(Bo\), cy \(Cy\)$/m)
    assert.match(await cli.ok('share', 'add', 'bike', '--zone', 'close', '--except', 'cy'), /^0 people would see item:bike$/m)
  })
  it('--json gives the line, what it replaces, and the preview', async () => {
    const cli = await seeded()
    const r = await cli.run('share', 'add', 'item:bike', '--zone', 'zone:friend', '--also', 'bo', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), {
      item: 'item:bike',
      line: { op: 'share', id: 'item:bike', seq: 1, scope: { zone: 'friend', include: ['person:bo'], exclude: [] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep', ts: NOW },
      replaces: null,
      count: 3,
      people: ['person:ada', 'person:bo', 'person:cy'],
      names: ['ada (Ada)', 'bo (Bo)', 'cy (Cy)'],
    })
  })
  it('re-sharing appends a new line that replaces the earlier one; the preview ignores the earlier line', async () => {
    const cli = await seeded()
    await cli.ok('share', 'add', 'bike', '--zone', 'friend', '--also', 'bo')
    const out = await cli.ok('share', 'add', 'bike', '--zone', 'close', `--now=${LATER}`)
    assert.match(out, /replaces the share from 2026-11-02 12:00/)
    assert.match(out, /^1 person would see item:bike: cy \(Cy\)$/m)
    const r = cli.record()
    assert.equal(r.shares.length, 2)
    assert.equal(r.shares[1].seq, 2)
    assert.equal(r.shares[1].ts, LATER)
  })
  it('the same scope again is not an error: it says so and writes nothing', async () => {
    const cli = await seeded()
    await cli.ok('share', 'add', 'bike', '--zone', 'friend', '--also', 'bo', '--except', 'tag:roses')
    const before = cli.record()
    const r = await cli.run('share', 'add', 'bike', '--zone', 'friend', '--except', 'tag:roses', '--also', 'person:bo')
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /^item:bike is already shared with this scope \(zone friend, also person:bo, except tag:roses, since 2026-11-02 12:00\); nothing written\.$/m)
    assert.deepEqual(cli.record(), before)
  })
  it('refuses, writing nothing: self, an archived or not set up zone, unknown or removed ids, the wrong id kind', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => { r.persons.di = { name: 'Di', addedAt: NOW, removedAt: NOW } })
    const before = cli.record()
    const cases: [string[], RegExp][] = [
      [['--zone', 'self'], /an item is yours already/],
      [['--zone', 'community'], /zone unarchive community/],
      [['--zone', 'closest'], /zone create closest/],
      [['--zone', 'friend', '--also', 'zed'], /person add zed/],
      [['--zone', 'friend', '--also', 'di'], /person add di/],
      [['--zone', 'friend', '--except', 'tag:choir'], /tag add choir/],
      [['--zone', 'friend', '--also', 'item:ladder'], /person or tag id is expected/],
      [['--zone', 'moon'], /not a trust zone/],
    ]
    for (const [opts, msg] of cases) {
      const r = await cli.run('share', 'add', 'bike', ...opts)
      assert.equal(r.code, 1, `${opts.join(' ')}: ${r.stderr}`)
      assert.match(r.stderr, msg, opts.join(' '))
    }
    const kind = await cli.run('share', 'add', 'tag:bike', '--zone', 'friend')
    assert.equal(kind.code, 1)
    assert.match(kind.stderr, /item id is expected/)
    assert.deepEqual(cli.record(), before)
  })
  it('wrong use of the line is exit 2: no --zone, an id in both --also and --except', async () => {
    const cli = await seeded()
    const noZone = await cli.run('share', 'add', 'bike')
    assert.equal(noZone.code, 2)
    assert.match(noZone.stderr, /--zone/)
    const both = await cli.run('share', 'add', 'bike', '--zone', 'friend', '--also', 'ada', '--except', 'person:ada')
    assert.equal(both.code, 2)
    assert.match(both.stderr, /person:ada.*both --also and --except/)
    assert.equal(cli.record().shares.length, 0)
  })
})

describe('share preview', () => {
  it('prints and returns who would see it, and writes nothing', async () => {
    const cli = await seeded()
    const before = cli.record()
    assert.match(await cli.ok('share', 'preview', 'bike', '--zone', 'friend'), /^2 people would see item:bike: ada \(Ada\), cy \(Cy\)$/m)
    const r = await cli.run('share', 'preview', 'bike', '--zone', 'close', '--also', 'tag:garden', '--json')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json(), { item: 'item:bike', zone: 'close', count: 2, people: ['person:bo', 'person:cy'], names: ['bo (Bo)', 'cy (Cy)'] })
    assert.deepEqual(cli.record(), before)
  })
  it('refuses what add refuses', async () => {
    const cli = await seeded()
    assert.equal((await cli.run('share', 'preview', 'bike', '--zone', 'self')).code, 1)
    assert.equal((await cli.run('share', 'preview', 'bike', '--zone', 'friend', '--also', 'cy', '--except', 'cy')).code, 2)
  })
  it('an archived zone does not count for a person: cy (only in close) is not named once close is archived', async () => {
    const cli = await seeded()
    archive(cli, 'close')
    const r = await cli.run('share', 'preview', 'bike', '--zone', 'friend', '--json')
    assert.deepEqual(r.json<Preview>().people, ['person:ada'])
  })
  it('removed persons are not listed (their tuples are closed; they are no longer in this web)', async () => {
    const cli = await seeded()
    withRecord(cli, (r) => { r.persons.di = { name: 'Di', addedAt: NOW, removedAt: NOW } })
    const r = await cli.run('share', 'preview', 'seeds', '--zone', 'public', '--json')
    assert.deepEqual(r.json<Preview>().people, ['person:ada', 'person:bo', 'person:cy'])
  })
})

describe('T12: preview == show item after add, for the same scope', () => {
  const scopes: string[][] = [
    ['--zone', 'public'],
    ['--zone', 'friend'],
    ['--zone', 'close'],
    ['--zone', 'friend', '--also', 'bo'],
    ['--zone', 'friend', '--except', 'tag:garden'],
    ['--zone', 'close', '--also', 'tag:garden', '--except', 'cy'],
    ['--zone', 'public', '--except', 'tag:roses'],
  ]
  for (const archived of [false, true]) {
    it(`holds for every scope${archived ? ' with close archived' : ''}`, async () => {
      for (const scope of scopes) {
        const cli = await seeded()
        if (archived) archive(cli, 'close')
        if (archived && scope[1] === 'close') continue
        await cli.ok('share', 'add', 'ladder', '--zone', 'friend', '--also', 'cy')
        const preview = (await cli.run('share', 'preview', 'ladder', ...scope, '--json')).json<Preview>()
        await cli.ok('share', 'add', 'ladder', ...scope)
        const shown = (await cli.run('show', 'item', 'ladder', '--json')).json<ShowItem>()
        assert.deepEqual(shown.people.map((p) => p.person), preview.people, scope.join(' '))
        assert.equal(preview.count, preview.people.length)
      }
    })
  }
})

describe('share list', () => {
  it('lists the latest live share per item; --all lists every line with its op', async () => {
    const cli = await seeded()
    await cli.ok('share', 'add', 'bike', '--zone', 'friend')
    await cli.ok('share', 'add', 'bike', '--zone', 'close', '--also', 'bo', `--now=${LATER}`)
    await cli.ok('share', 'add', 'seeds', '--zone', 'public', '--except', 'tag:roses')
    await cli.ok('share', 'add', 'ladder', '--zone', 'friend')
    await cli.ok('share', 'revoke', 'ladder')
    const text = await cli.ok('share', 'list')
    const rows = text.trimEnd().split('\n')
    assert.match(rows[0], /^item\s+zone\s+also\s+except\s+since\s+seq$/)
    assert.equal(rows.length, 4)
    assert.match(text, /^item:bike\s+close\s+person:bo\s+-\s+2026-11-03 09:30\s+2$/m)
    assert.match(text, /^item:seeds\s+public\s+-\s+tag:roses\s+2026-11-02 12:00\s+3$/m)
    assert.doesNotMatch(text, /ladder/)
    const json = (await cli.run('share', 'list', '--json')).json()
    assert.deepEqual(json, [
      { item: 'item:bike', zone: 'close', also: ['person:bo'], except: [], since: LATER, seq: 2 },
      { item: 'item:seeds', zone: 'public', also: [], except: ['tag:roses'], since: NOW, seq: 3 },
    ])
    const all = await cli.ok('share', 'list', '--all')
    assert.match(all.split('\n')[0], /^seq\s+op\s+item\s+zone\s+also\s+except\s+when\s+live$/)
    assert.match(all, /^1\s+share\s+item:bike\s+friend\s+-\s+-\s+2026-11-02 12:00\s+no$/m)
    assert.match(all, /^2\s+share\s+item:bike\s+close\s+person:bo\s+-\s+2026-11-03 09:30\s+yes$/m)
    assert.match(all, /^5\s+revoke\s+item:ladder\s+-\s+-\s+-\s+2026-11-02 12:00\s+-$/m)
    const allJson = (await cli.run('share', 'list', '--all', '--json')).json<{ seq: number; op: string; item: string; live: boolean | null }[]>()
    assert.deepEqual(allJson.map((l) => [l.seq, l.op, l.item, l.live]), [
      [1, 'share', 'item:bike', false], [2, 'share', 'item:bike', true], [3, 'share', 'item:seeds', true], [4, 'share', 'item:ladder', false], [5, 'revoke', 'item:ladder', null],
    ])
  })
  it('an empty record says so', async () => {
    const cli = await seeded()
    assert.match(await cli.ok('share', 'list'), /no shares yet/)
    assert.deepEqual((await cli.run('share', 'list', '--json')).json(), [])
  })
})

describe('share revoke', () => {
  it('appends a revoke line; the item is no longer shared and nobody sees it through a share', async () => {
    const cli = await seeded()
    await cli.ok('share', 'add', 'bike', '--zone', 'friend')
    const logBefore = cli.record().log.length
    const r = await cli.run('share', 'revoke', 'bike', '--json')
    assert.equal(r.code, 0, r.stderr)
    const line = { op: 'revoke', id: 'rev:2', seq: 2, target: 'item:bike', at: 2, ts: NOW }
    assert.deepEqual(r.json(), { item: 'item:bike', line, was: { zone: 'friend', also: [], except: [], since: NOW, seq: 1 } })
    const rec = cli.record()
    assert.deepEqual(rec.shares.at(-1), line)
    assert.equal(rec.log.length, logBefore + 1)
    assert.match(rec.log.at(-1)!.text, /revoked the share of item:bike/)
    assert.match(await cli.ok('share', 'list'), /no shares yet/)
    assert.deepEqual((await cli.run('show', 'item', 'bike', '--json')).json<ShowItem>().people, [])
    assert.match(await cli.ok('share', 'revoke', 'seeds').catch((e: Error) => e.message), /no live share/)
  })
  it('revoking what is not shared is refused (exit 1) and writes nothing; text output names what ended', async () => {
    const cli = await seeded()
    const before = cli.record()
    const r = await cli.run('share', 'revoke', 'bike')
    assert.equal(r.code, 1)
    assert.match(r.stderr, /item:bike has no live share/)
    assert.deepEqual(cli.record(), before)
    await cli.ok('share', 'add', 'bike', '--zone', 'friend')
    assert.match(await cli.ok('share', 'revoke', 'bike'), /^Revoked the share of item:bike \(was zone friend, since 2026-11-02 12:00\)\.$/m)
    assert.equal((await cli.run('share', 'revoke', 'bike')).code, 1)
    await cli.ok('share', 'add', 'bike', '--zone', 'close')
    assert.equal(cli.record().shares.length, 3)
    assert.equal((await cli.run('share', 'list', '--json')).json<unknown[]>().length, 1)
  })
})
