// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The relation store derived from a record, and what a zone, tag or person can see: the share sink's canAccess decides. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ops from '../src/ops.ts'
import { activeZones, effectiveZoneOf, sees, storeOf, zoneMembers } from '../src/derive.ts'
import { emptyRecord } from '../src/record.ts'
import { CliError } from '../src/errors.ts'
import { parseJsonl } from '../../../apps/trustweb/src/share_sink/tuples.ts'
import { toJsonl } from '../../../apps/trustweb/src/share_sink/export.ts'

const T0 = new Date('2026-10-27T12:00:00.000Z')
const NOW = new Date('2026-10-28T12:00:00.000Z')
const apply = (r, ...steps) => steps.reduce((acc, [fn, ...args]) => ops[fn](acc, ...args, T0).record, r)
const lines = (store) => store.map((t) => `${t.subject} ${t.relation} ${t.object}`)

/** fig: friend; kiwi: friend + garden; plum: allies (close); pear: seedlings (under garden, so allies too). */
const world = () => apply(emptyRecord(T0),
  ['createZone', 'allies', 'close', 'Allies'],
  ['addMembers', 'friend', ['person:fig', 'person:kiwi']],
  ['addMembers', 'allies', ['person:plum', 'tag:garden']],
  ['tagPerson', 'kiwi', ['garden']],
  ['createTag', 'seedlings', undefined],
  ['nestTag', 'seedlings', 'garden'],
  ['tagPerson', 'pear', ['seedlings']],
  ['share', 'bike', 'friend', [], []],
  ['share', 'ladder', 'closest', ['tag:garden'], []],
  ['share', 'recipe', 'public', [], []],
  ['share', 'tools', 'friend', [], ['person:kiwi']],
)

test('the store: zone members on their level (tags expanded through nesting), tags, nesting, the latest share per item', () => {
  const r = apply(world(), ['share', 'bike', 'close', [], []])
  const s = storeOf(r)
  assert.deepEqual(lines(s), [
    'person:fig in_zone zone:friend', 'person:kiwi in_zone zone:friend',
    'person:plum in_zone zone:close', 'person:kiwi in_zone zone:close', 'person:pear in_zone zone:close',
    'person:kiwi has_tag tag:garden', 'person:pear has_tag tag:seedlings',
    'tag:seedlings nested_in tag:garden',
    'zone:close may_read item:bike',
    'zone:closest may_read item:ladder', 'tag:garden may_read item:ladder',
    'zone:public may_read item:recipe',
    'zone:friend may_read item:tools', 'person:kiwi excludes item:tools',
  ])
  assert.ok(s.every((t) => t.by === 'device:cli'))
  assert.deepEqual(parseJsonl(toJsonl(s)), s, 'the share sink reads back every derived tuple')
})

test('a person placed twice on one level by different zones gets one tuple', () => {
  const r = apply(world(), ['createZone', 'crew', 'friend', undefined], ['addMembers', 'crew', ['person:fig']])
  assert.equal(lines(storeOf(r)).filter((l) => l === 'person:fig in_zone zone:friend').length, 1)
})

test('archiving: a created zone places nobody; a built-in zone keeps its tuples but its ring is off', () => {
  const r = apply(world(), ['archiveZone', 'allies'], ['archiveZone', 'friend'])
  const s = lines(storeOf(r))
  assert.ok(!s.includes('person:plum in_zone zone:close'))
  assert.ok(s.includes('person:fig in_zone zone:friend'))
  assert.deepEqual(activeZones(r), ['public', 'intending', 'acquaintance', 'community', 'close', 'closest', 'self'])
  assert.deepEqual(activeZones(world()).length, 8)
})

test('a person\'s zone is the most intimate ring that is on', () => {
  const r = world()
  assert.equal(effectiveZoneOf(r, 'kiwi', NOW), 'close')
  assert.equal(effectiveZoneOf(r, 'fig', NOW), 'friend')
  assert.equal(effectiveZoneOf(apply(r, ['archiveZone', 'friend']), 'fig', NOW), 'public')
})

test('zone members: direct people, and people through a tag (nesting included)', () => {
  assert.deepEqual(zoneMembers(world(), 'allies'), { people: ['plum'], viaTags: [{ person: 'kiwi', tag: 'garden' }, { person: 'pear', tag: 'garden' }] })
  assert.deepEqual(zoneMembers(world(), 'public'), { people: [], viaTags: [] })
  assert.throws(() => zoneMembers(world(), 'nope'), CliError)
})

test('what a zone sees: a person who sits only in it; more intimate zones see more', () => {
  const friend = sees(world(), 'friend', NOW)
  assert.equal(friend.target, 'zone:friend')
  assert.deepEqual(friend.items.map((i) => i.item), ['item:bike', 'item:recipe', 'item:tools'])
  assert.deepEqual(friend.items[0].why, ['zone:friend may_read item:bike'])
  assert.deepEqual(friend.notes, [])
  assert.deepEqual(sees(world(), 'public', NOW).items.map((i) => i.item), ['item:recipe'])
  assert.deepEqual(sees(world(), 'closest', NOW).items.map((i) => i.item), ['item:bike', 'item:ladder', 'item:recipe', 'item:tools'])
})

test('a created zone sees what its level sees, and says so', () => {
  const allies = sees(world(), 'allies', NOW)
  assert.deepEqual(allies.items.map((i) => i.item), ['item:bike', 'item:recipe', 'item:tools'])
  assert.deepEqual(allies.notes, ['allies sits on level close: it sees what close sees'])
})

test('an archived zone: a created one sees nothing, a switched-off ring sees what public sees', () => {
  const r = apply(world(), ['archiveZone', 'allies'], ['archiveZone', 'friend'])
  assert.deepEqual(sees(r, 'allies', NOW), { target: 'zone:allies', notes: ['allies is archived: it places nobody, so it sees nothing'], items: [] })
  const f = sees(r, 'friend', NOW)
  assert.deepEqual(f.notes, ['friend is archived (ring switched off): someone only in it counts as public'])
  assert.deepEqual(f.items.map((i) => i.item), ['item:recipe'])
  const crew = sees(apply(r, ['restoreZone', 'friend'], ['createZone', 'crew', 'friend', undefined], ['archiveZone', 'friend']), 'crew', NOW)
  assert.deepEqual(crew.notes, ['crew sits on level friend: it sees what friend sees', 'level friend is archived (ring switched off): someone only in crew counts as public'])
})

test('what a tag sees: a holder of only that tag; the why shows the tag and its nesting', () => {
  const g = sees(world(), 'tag:garden', NOW)
  assert.deepEqual(g.items.map((i) => i.item), ['item:ladder', 'item:recipe'])
  assert.deepEqual(g.items[0].why, ['tag:garden may_read item:ladder'])
  const s = sees(world(), 'tag:seedlings', NOW)
  assert.deepEqual(s.items[0], { item: 'item:ladder', why: ['tag:seedlings nested_in tag:garden', 'tag:garden may_read item:ladder'] })
  assert.throws(() => sees(world(), 'tag:nope', NOW), /no tag nope/)
})

test('what a person sees: their zones, tags and individual grants, exclusions first; the why names the placing zone', () => {
  const kiwi = sees(world(), 'person:kiwi', NOW)
  assert.deepEqual(kiwi.items.map((i) => i.item), ['item:bike', 'item:ladder', 'item:recipe'])
  assert.deepEqual(kiwi.items[0].why, ['person:kiwi in_zone zone:close (via allies)', 'zone:friend may_read item:bike'])
  assert.deepEqual(kiwi.items[1].why, ['person:kiwi has_tag tag:garden', 'tag:garden may_read item:ladder'])
  assert.deepEqual(sees(world(), 'person:fig', NOW).items[0].why, ['person:fig in_zone zone:friend (via friend)', 'zone:friend may_read item:bike'])
  assert.throws(() => sees(world(), 'person:nope', NOW), /no person nope/)
  assert.throws(() => sees(world(), 'zone:friend', NOW), /no zone zone:friend/)
})

test('shares expire after a year (I9): later, nobody sees them', () => {
  assert.deepEqual(sees(world(), 'closest', new Date('2027-11-01T00:00:00.000Z')).items, [])
})
