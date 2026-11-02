// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The record changes: each is pure, refuses what makes no sense, and leaves one readable log line (I6). */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ops from '../src/ops.ts'
import { emptyRecord, parseRecord, serialize } from '../src/record.ts'
import { CliError } from '../src/errors.ts'

const T0 = new Date('2026-10-27T12:00:00.000Z')
const T1 = new Date('2026-10-28T08:00:00.000Z')
const fresh = () => emptyRecord(T0)
const refused = (fn, pattern, code = 1) => assert.throws(fn, (e) => e instanceof CliError && e.exitCode === code && pattern.test(e.message))
const zone = (r, id) => r.zones.find((z) => z.id === id)
const last = (r) => r.log[r.log.length - 1]
/** Every result is still a record the parser accepts. */
const valid = (r) => assert.deepEqual(parseRecord(serialize(r)), r)

test('zone create: a named zone on a level; the record is not changed in place', () => {
  const r0 = fresh()
  const { record: r, message } = ops.createZone(r0, 'allies', 'close', 'Allies', T1)
  assert.equal(r0.zones.length, 7)
  assert.deepEqual(zone(r, 'allies'), { id: 'allies', name: 'Allies', level: 'close', builtin: false, members: [], createdAt: T1.toISOString() })
  assert.equal(message, 'zone create: allies "Allies" on level close')
  assert.equal(last(r), `${T1.toISOString()} ${message}`)
  assert.equal(zone(ops.createZone(r0, 'crew', 'friend', undefined, T1).record, 'crew').name, 'crew')
  valid(r)
})

test('zone create refuses a bad id, a level as id, a taken id, an unknown level and a blank name', () => {
  const r = ops.createZone(fresh(), 'allies', 'close', undefined, T1).record
  refused(() => ops.createZone(r, 'Bad Id', 'close', undefined, T1), /not an id/, 2)
  refused(() => ops.createZone(r, 'friend', 'close', undefined, T1), /friend is a built-in level/)
  refused(() => ops.createZone(r, 'allies', 'close', undefined, T1), /zone allies exists/)
  refused(() => ops.createZone(r, 'crew', 'self', undefined, T1), /level must be one of public, intending/, 2)
  refused(() => ops.createZone(r, 'crew', 'close', '   ', T1), /name must not be blank/, 2)
  refused(() => ops.createZone(r, 'crew', 'close', 'x'.repeat(81), T1), /name is longer than 80/, 2)
})

test('zone rename changes the name only; built-in zones can be renamed too', () => {
  const { record: r, message } = ops.renameZone(fresh(), 'close', '  Allies  ', T1)
  assert.deepEqual({ ...zone(r, 'close') }, { ...zone(fresh(), 'close'), name: 'Allies' })
  assert.equal(message, 'zone rename: close "Close friends and allies" -> "Allies"')
  refused(() => ops.renameZone(fresh(), 'nope', 'X', T1), /no zone nope/)
  refused(() => ops.renameZone(fresh(), 'close', '', T1), /blank/, 2)
})

test('zone archive and restore: a stamp, never a deletion; public cannot be switched off', () => {
  const a = ops.archiveZone(fresh(), 'friend', T1)
  assert.equal(zone(a.record, 'friend').archivedAt, T1.toISOString())
  assert.equal(a.message, 'zone archive: friend (ring switched off: what is shared to it moves one ring in)')
  assert.equal(a.record.zones.length, 7)
  const c = ops.archiveZone(ops.createZone(fresh(), 'crew', 'friend', undefined, T1).record, 'crew', T1)
  assert.equal(c.message, 'zone archive: crew (it places nobody now)')
  refused(() => ops.archiveZone(a.record, 'friend', T1), /friend is archived already/)
  refused(() => ops.archiveZone(fresh(), 'public', T1), /public cannot be archived/)
  const back = ops.restoreZone(a.record, 'friend', T1)
  assert.equal('archivedAt' in zone(back.record, 'friend'), false)
  assert.equal(back.message, 'zone restore: friend')
  refused(() => ops.restoreZone(fresh(), 'friend', T1), /friend is not archived/)
  valid(a.record)
})

test('zone add registers unknown people and tags, then adds them; all or nothing', () => {
  const { record: r, message } = ops.addMembers(fresh(), 'friend', ['person:fig', 'tag:garden'], T1)
  assert.deepEqual(zone(r, 'friend').members, ['person:fig', 'tag:garden'])
  assert.deepEqual(r.people, [{ id: 'fig', tags: [], addedAt: T1.toISOString() }])
  assert.deepEqual(r.tags, [{ id: 'garden', parents: [], createdAt: T1.toISOString() }])
  assert.equal(message, 'zone add: friend + person:fig, tag:garden (new: person:fig, tag:garden)')
  assert.equal(ops.addMembers(r, 'close', ['person:fig'], T1).message, 'zone add: close + person:fig')
  refused(() => ops.addMembers(r, 'friend', ['person:kiwi', 'person:fig'], T1), /person:fig is in friend already/)
  refused(() => ops.addMembers(r, 'friend', ['person:kiwi', 'person:kiwi'], T1), /person:kiwi given twice/, 2)
  refused(() => ops.addMembers(r, 'friend', [], T1), /name at least one/, 2)
  refused(() => ops.addMembers(r, 'friend', ['fig'], T1), /expected person:<id> or tag:<id>/, 2)
  refused(() => ops.addMembers(ops.archiveZone(r, 'close', T1).record, 'close', ['person:kiwi'], T1), /close is archived; restore it first/)
  valid(r)
})

test('zone remove takes members out; the people and tags stay', () => {
  const r = ops.addMembers(fresh(), 'friend', ['person:fig', 'tag:garden'], T1).record
  const { record: out, message } = ops.removeMembers(r, 'friend', ['person:fig'], T1)
  assert.deepEqual(zone(out, 'friend').members, ['tag:garden'])
  assert.equal(out.people.length, 1)
  assert.equal(message, 'zone remove: friend - person:fig')
  refused(() => ops.removeMembers(r, 'friend', ['person:kiwi'], T1), /person:kiwi is not in friend/)
  refused(() => ops.removeMembers(r, 'friend', [], T1), /name at least one/, 2)
  refused(() => ops.removeMembers(ops.archiveZone(r, 'friend', T1).record, 'friend', ['person:fig'], T1), /archived/)
})

test('person add, tag and untag', () => {
  const a = ops.addPerson(fresh(), 'fig', 'Fig', T1)
  assert.deepEqual(a.record.people, [{ id: 'fig', name: 'Fig', tags: [], addedAt: T1.toISOString() }])
  assert.equal(a.message, 'person add: fig "Fig"')
  assert.equal(ops.addPerson(fresh(), 'fig', undefined, T1).message, 'person add: fig')
  refused(() => ops.addPerson(a.record, 'fig', undefined, T1), /person fig exists/)
  refused(() => ops.addPerson(a.record, 'F', undefined, T1), /not an id/, 2)
  refused(() => ops.addPerson(a.record, 'kiwi', ' ', T1), /blank/, 2)

  const t = ops.tagPerson(a.record, 'fig', ['garden', 'bikes'], T1)
  assert.deepEqual(t.record.people[0].tags, ['garden', 'bikes'])
  assert.deepEqual(t.record.tags.map((x) => x.id), ['garden', 'bikes'])
  assert.equal(t.message, 'person tag: fig + garden, bikes (new: tag:garden, tag:bikes)')
  const t2 = ops.tagPerson(t.record, 'kiwi', ['garden'], T1)
  assert.equal(t2.message, 'person tag: kiwi + garden (new: person:kiwi)')
  refused(() => ops.tagPerson(t.record, 'fig', ['garden'], T1), /fig holds garden already/)
  refused(() => ops.tagPerson(t.record, 'fig', [], T1), /name at least one/, 2)
  refused(() => ops.tagPerson(t.record, 'fig', ['Bad'], T1), /not an id/, 2)
  refused(() => ops.tagPerson(t.record, 'fig', ['x', 'x'], T1), /x given twice/, 2)
  refused(() => ops.tagPerson(t.record, 'F', ['x'], T1), /not an id/, 2)

  const u = ops.untagPerson(ops.addPerson(t.record, 'kiwi', undefined, T1).record, 'fig', ['garden'], T1)
  assert.deepEqual(u.record.people[0].tags, ['bikes'])
  assert.equal(u.message, 'person untag: fig - garden')
  refused(() => ops.untagPerson(u.record, 'fig', ['garden'], T1), /fig does not hold garden/)
  refused(() => ops.untagPerson(u.record, 'nope', ['garden'], T1), /no person nope/)
  refused(() => ops.untagPerson(u.record, 'fig', [], T1), /name at least one/, 2)
  valid(u.record)
})

test('tag create and nest; nesting reuses the share sink: no cycles, at most four levels', () => {
  const a = ops.createTag(fresh(), 'garden', 'Garden', T1)
  assert.deepEqual(a.record.tags, [{ id: 'garden', label: 'Garden', parents: [], createdAt: T1.toISOString() }])
  assert.equal(a.message, 'tag create: garden "Garden"')
  assert.equal(ops.createTag(fresh(), 'garden', undefined, T1).message, 'tag create: garden')
  refused(() => ops.createTag(a.record, 'garden', undefined, T1), /tag garden exists/)
  refused(() => ops.createTag(a.record, 'G', undefined, T1), /not an id/, 2)
  refused(() => ops.createTag(a.record, 'g', '', T1), /blank/, 2)

  let r = a.record
  for (const id of ['seedlings', 'pots', 'clay', 'dust']) r = ops.createTag(r, id, undefined, T1).record
  const n = ops.nestTag(r, 'seedlings', 'garden', T1)
  assert.deepEqual(n.record.tags.find((t) => t.id === 'seedlings').parents, ['garden'])
  assert.equal(n.message, 'tag nest: seedlings under garden')
  refused(() => ops.nestTag(n.record, 'seedlings', 'garden', T1), /seedlings is under garden already/)
  refused(() => ops.nestTag(n.record, 'garden', 'seedlings', T1), /would make a cycle/)
  refused(() => ops.nestTag(n.record, 'garden', 'garden', T1), /would make a cycle/)
  refused(() => ops.nestTag(n.record, 'nope', 'garden', T1), /no tag nope/)
  refused(() => ops.nestTag(n.record, 'garden', 'nope', T1), /no tag nope/)
  let deep = n.record
  deep = ops.nestTag(deep, 'pots', 'seedlings', T1).record
  deep = ops.nestTag(deep, 'clay', 'pots', T1).record
  refused(() => ops.nestTag(deep, 'dust', 'clay', T1), /deeper than 4 levels/)
  valid(deep)
})

test('share appends one share line through the share sink, to a level only', () => {
  const s = ops.share(fresh(), 'bike', 'friend', ['tag:garden'], ['person:fig'], T1)
  const line = s.record.shares[0]
  assert.deepEqual(line, { op: 'share', id: 'item:bike', seq: 1, scope: { zone: 'friend', include: ['tag:garden'], exclude: ['person:fig'] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep', ts: T1.toISOString() })
  assert.equal(s.message, 'share: item:bike with zone friend + tag:garden - person:fig (new: tag:garden, person:fig)')
  assert.equal(ops.share(s.record, 'bike', 'close', [], [], T1).record.shares[1].seq, 2)
  assert.equal(ops.share(fresh(), 'bike', 'public', [], [], T1).message, 'share: item:bike with zone public')
  const withCrew = ops.createZone(fresh(), 'crew', 'friend', undefined, T1).record
  refused(() => ops.share(withCrew, 'bike', 'crew', [], [], T1), /crew is a created zone on level friend: share to friend, or name its people with --include/)
  refused(() => ops.share(fresh(), 'bike', 'nope', [], [], T1), /no zone nope/)
  refused(() => ops.share(fresh(), 'Bike', 'friend', [], [], T1), /not an id/, 2)
  refused(() => ops.share(fresh(), 'bike', 'friend', ['person:fig'], ['person:fig'], T1), /person:fig is both included and excluded/, 2)
  const off = ops.archiveZone(fresh(), 'friend', T1).record
  assert.equal(ops.share(off, 'bike', 'friend', [], [], T1).message, 'share: item:bike with zone friend (friend is archived: it reaches the next ring in that is on)')
  valid(s.record)
})
