// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The CLI record: its built-in zones (the share sink's ladder), its validation, and stable bytes. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BUILTIN_NAMES, FORMAT, LEVELS, VERSION, emptyRecord, isId, memberRef, parseRecord, serialize } from '../src/record.ts'
import { CliError } from '../src/errors.ts'
import { LADDER } from '../../../apps/trustweb/src/share_sink/zones.ts'

const NOW = new Date('2026-10-27T12:00:00.000Z')
const good = () => emptyRecord(NOW)
const bad = (mutate, pattern) => {
  const r = JSON.parse(serialize(good()))
  mutate(r)
  assert.throws(() => parseRecord(JSON.stringify(r)), (e) => e instanceof CliError && pattern.test(e.message))
}

test('levels are the ladder without self (self is the owner alone)', () => {
  assert.deepEqual(LEVELS, LADDER.filter((z) => z !== 'self'))
})

test('an empty record holds one built-in zone per level, named, in ladder order, and nothing else', () => {
  const r = good()
  assert.equal(r.format, FORMAT)
  assert.equal(r.version, VERSION)
  assert.equal(r.device, 'device:cli')
  assert.deepEqual(r.zones.map((z) => z.id), LEVELS)
  assert.ok(r.zones.every((z) => z.builtin && z.level === z.id && z.members.length === 0 && z.createdAt === NOW.toISOString()))
  assert.deepEqual(r.zones.map((z) => z.name), LEVELS.map((l) => BUILTIN_NAMES[l]))
  assert.deepEqual([r.people, r.tags, r.shares], [[], [], []])
  assert.deepEqual(r.log, [`${NOW.toISOString()} init: empty record, ${LEVELS.length} built-in zones`])
  assert.equal(emptyRecord(NOW, 'device:other').device, 'device:other')
})

test('serialize writes stable bytes that parse back to the same record', () => {
  const text = serialize(good())
  assert.ok(text.endsWith('}\n'))
  assert.equal(serialize(parseRecord(text)), text)
})

test('ids: lowercase letters, digits, dot, dash, underscore; up to 64; starting with a letter or digit', () => {
  for (const ok of ['fig', 'a', 'x-1', 'b.c_d', '9lives', 'a'.repeat(64)]) assert.ok(isId(ok), ok)
  for (const no of ['', 'Fig', '-a', 'a b', 'a:b', '~probe', 'a'.repeat(65), 'é']) assert.ok(!isId(no), no)
})

test('memberRef reads person:<id> and tag:<id>, nothing else', () => {
  assert.deepEqual(memberRef('person:fig'), { kind: 'person', id: 'fig', ref: 'person:fig' })
  assert.deepEqual(memberRef('tag:garden'), { kind: 'tag', id: 'garden', ref: 'tag:garden' })
  for (const no of ['fig', 'zone:close', 'person:', 'tag:Bad', 'item:bike']) {
    assert.throws(() => memberRef(no), (e) => e instanceof CliError && e.exitCode === 2 && /person:<id> or tag:<id>/.test(e.message), no)
  }
})

test('parseRecord refuses what is not JSON, or not this format or version', () => {
  assert.throws(() => parseRecord('{nope'), /not JSON/)
  assert.throws(() => parseRecord('[]'), /not a TrustWeb CLI record/)
  assert.throws(() => parseRecord('null'), /not a TrustWeb CLI record/)
  bad((r) => { r.format = 'other' }, /not a TrustWeb CLI record/)
  bad((r) => { r.version = 2 }, /version 2 .* reads version 1/)
  bad((r) => { r.device = '' }, /device/)
})

test('parseRecord checks every zone', () => {
  bad((r) => { r.zones = {} }, /zones/)
  bad((r) => { r.zones[0] = null }, /zone 1/)
  bad((r) => { r.zones[0].id = 'Bad' }, /zone 1: id/)
  bad((r) => { r.zones[1].id = 'public' }, /zone 2: id public appears twice/)
  bad((r) => { r.zones[0].name = '' }, /zone 1: name/)
  bad((r) => { r.zones[0].name = 3 }, /zone 1: name/)
  bad((r) => { r.zones[0].level = 'self' }, /zone 1: level/)
  bad((r) => { r.zones[0].builtin = 'yes' }, /zone 1: builtin/)
  bad((r) => { r.zones[0].builtin = false }, /zone 1: id public is a level/)
  bad((r) => { r.zones[0].level = 'close' }, /zone 1: a built-in zone sits on its own level/)
  bad((r) => { r.zones.push({ ...r.zones[0], id: 'extra', builtin: true }) }, /zone 8: only the levels are built in/)
  bad((r) => { r.zones.pop() }, /built-in zone closest is missing/)
  bad((r) => { r.zones[0].members = 'x' }, /zone 1: members/)
  bad((r) => { r.zones[0].members = ['fig'] }, /zone 1: fig: expected person:<id> or tag:<id>/)
  bad((r) => { r.people = [{ id: 'fig', tags: [], addedAt: NOW.toISOString() }]; r.zones[0].members = ['person:fig', 'person:fig'] }, /zone 1: person:fig appears twice/)
  bad((r) => { r.zones[0].members = ['person:fig'] }, /zone 1: person:fig is not in people/)
  bad((r) => { r.zones[0].members = ['tag:garden'] }, /zone 1: tag:garden is not in tags/)
  bad((r) => { r.zones[0].createdAt = 'soon' }, /zone 1: createdAt/)
  bad((r) => { r.zones[0].archivedAt = 'never' }, /zone 1: archivedAt/)
})

test('parseRecord checks every person and tag', () => {
  bad((r) => { r.people = null }, /people/)
  bad((r) => { r.people = ['fig'] }, /person 1/)
  bad((r) => { r.people = [{ id: 'F', tags: [], addedAt: NOW.toISOString() }] }, /person 1: id/)
  bad((r) => { r.people = [{ id: 'fig', tags: [], addedAt: NOW.toISOString() }, { id: 'fig', tags: [], addedAt: NOW.toISOString() }] }, /person 2: id fig appears twice/)
  bad((r) => { r.people = [{ id: 'fig', name: '', tags: [], addedAt: NOW.toISOString() }] }, /person 1: name/)
  bad((r) => { r.people = [{ id: 'fig', tags: 'x', addedAt: NOW.toISOString() }] }, /person 1: tags/)
  bad((r) => { r.people = [{ id: 'fig', tags: ['garden'], addedAt: NOW.toISOString() }] }, /person 1: tag garden is not in tags/)
  bad((r) => { r.people = [{ id: 'fig', tags: [], addedAt: 'x' }] }, /person 1: addedAt/)
  bad((r) => { r.tags = 1 }, /tags/)
  bad((r) => { r.tags = [7] }, /tag 1/)
  bad((r) => { r.tags = [{ id: '', parents: [], createdAt: NOW.toISOString() }] }, /tag 1: id/)
  bad((r) => { r.tags = [{ id: 'g', parents: [], createdAt: NOW.toISOString() }, { id: 'g', parents: [], createdAt: NOW.toISOString() }] }, /tag 2: id g appears twice/)
  bad((r) => { r.tags = [{ id: 'g', label: 5, parents: [], createdAt: NOW.toISOString() }] }, /tag 1: label/)
  bad((r) => { r.tags = [{ id: 'g', parents: {}, createdAt: NOW.toISOString() }] }, /tag 1: parents/)
  bad((r) => { r.tags = [{ id: 'g', parents: ['h'], createdAt: NOW.toISOString() }] }, /tag 1: parent h is not in tags/)
  bad((r) => { r.tags = [{ id: 'g', parents: [], createdAt: '' }] }, /tag 1: createdAt/)
})

test('parseRecord checks shares and the log, and refuses a store the share sink would not read', () => {
  bad((r) => { r.shares = {} }, /shares/)
  bad((r) => { r.shares = [{ op: 'nope' }] }, /share line 1/)
  bad((r) => { r.shares = [{ op: 'share', id: 'item:x', seq: 1, ts: 'x', scope: { zone: 'friend', include: [], exclude: [] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep' }] }, /share line 1/)
  bad((r) => { r.shares = [{ op: 'share', id: 'item:x', seq: 1, ts: NOW.toISOString(), scope: { zone: 'nope', include: [], exclude: [] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep' }] }, /share line 1/)
  bad((r) => { r.shares = [{ op: 'share', id: 'item:x', seq: 1, ts: NOW.toISOString(), scope: { zone: 'friend', include: 'x', exclude: [] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep' }] }, /share line 1/)
  bad((r) => { r.shares = [{ op: 'share', id: 'item:x', seq: 1, ts: NOW.toISOString(), scope: { zone: 'friend', include: [], exclude: ['bad'] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep' }] }, /share line 1/)
  bad((r) => { r.shares = [{ op: 'share', id: 'bike', seq: 1, ts: NOW.toISOString(), scope: { zone: 'friend', include: [], exclude: [] }, cutoff: 1, to: 'zone:friend', terms: 'read-keep' }] }, /share line 1/)
  bad((r) => { r.shares = [null] }, /share line 1/)
  bad((r) => { r.log = 'x' }, /log/)
  bad((r) => { r.log = [1] }, /log/)
})

test('parseRecord keeps share lines of other kinds (revoke, retract, agree) as they are', () => {
  const r = JSON.parse(serialize(good()))
  r.shares = [{ op: 'revoke', id: 'r1', seq: 1, ts: NOW.toISOString(), target: 'shr:1', at: 1 }]
  assert.deepEqual(parseRecord(JSON.stringify(r)).shares, r.shares)
})
