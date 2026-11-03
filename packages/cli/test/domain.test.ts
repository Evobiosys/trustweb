// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The shared record helpers: zone states and labels, the must-exist checks, facts added once and closed never deleted, members through tag rules. */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { CommandError } from '../src/cli.ts'
import { ZONE_LABELS, addFact, closeFacts, hasLive, membersOf, requirePerson, requireTag, requireZone, zoneLabel, zoneOfPersonIn, zoneState } from '../src/domain.ts'
import { emptyRecord } from '../src/record.ts'
import { Zone, activeZones, latestShares, storeOf, unfoldTagRules } from '../src/sink.ts'

const NOW = new Date('2026-11-02T12:00:00.000Z')
const AT = NOW.toISOString()

function fixture() {
  const r = emptyRecord('device:laptop', NOW)
  r.zones.friend = { label: 'Friends', createdAt: AT }
  r.zones.close = { label: 'Allies', createdAt: AT, archivedAt: AT }
  r.persons.ada = { name: 'Ada', addedAt: AT }
  r.persons.bo = { name: 'Bo', addedAt: AT }
  r.persons.cy = { name: 'Cy', addedAt: AT, removedAt: AT }
  r.tags.garden = { label: 'garden', addedAt: AT }
  r.tags.old = { label: 'old', addedAt: AT, removedAt: AT }
  return r
}

describe('zones', () => {
  it('states: public and self always on; set up = on; archived; not set up', () => {
    const r = fixture()
    assert.equal(zoneState(r, Zone.Public), 'always-on')
    assert.equal(zoneState(r, Zone.Self), 'always-on')
    assert.equal(zoneState(r, Zone.Friend), 'on')
    assert.equal(zoneState(r, Zone.Close), 'archived')
    assert.equal(zoneState(r, Zone.Community), 'not set up')
    assert.deepEqual(activeZones(r), [Zone.Public, Zone.Friend, Zone.Self])
  })
  it('labels: the record\'s own, else the ladder\'s word', () => {
    const r = fixture()
    assert.equal(zoneLabel(r, Zone.Friend), 'Friends')
    assert.equal(zoneLabel(r, Zone.Community), ZONE_LABELS[Zone.Community])
  })
  it('requireZone names the command that fixes it', () => {
    const r = fixture()
    assert.equal(requireZone(r, Zone.Friend).label, 'Friends')
    assert.throws(() => requireZone(r, Zone.Community), (e: unknown) => e instanceof CommandError && /zone create community/.test(e.message))
    assert.throws(() => requireZone(r, Zone.Close), (e: unknown) => e instanceof CommandError && /zone unarchive close/.test(e.message))
    assert.equal(requireZone(r, Zone.Close, 'set-up').label, 'Allies')
    assert.throws(() => requireZone(r, Zone.Public), (e: unknown) => e instanceof CommandError && /always on/.test(e.message))
  })
})

describe('persons and tags', () => {
  it('a removed person or tag counts as absent, with the hint to add them', () => {
    const r = fixture()
    assert.equal(requirePerson(r, 'ada').name, 'Ada')
    assert.throws(() => requirePerson(r, 'cy'), (e: unknown) => e instanceof CommandError && /person add cy/.test(e.message))
    assert.throws(() => requirePerson(r, 'zed'), CommandError)
    assert.equal(requireTag(r, 'garden').label, 'garden')
    assert.throws(() => requireTag(r, 'old'), (e: unknown) => e instanceof CommandError && /tag add old/.test(e.message))
  })
})

describe('facts', () => {
  it('addFact writes once (since now, by the device); a second identical live fact is not written again', () => {
    const r = fixture()
    const f = { subject: 'person:ada', relation: 'in_zone' as const, object: 'zone:friend' }
    assert.equal(addFact(r, f, NOW), true)
    assert.equal(addFact(r, f, NOW), false)
    assert.deepEqual(r.tuples, [{ ...f, since: AT, by: 'device:laptop' }])
    assert.equal(hasLive(r, f, NOW), true)
  })
  it('closeFacts sets until = now on the live matches and keeps them; a closed fact can be added again', () => {
    const r = fixture()
    const f = { subject: 'person:ada', relation: 'in_zone' as const, object: 'zone:friend' }
    addFact(r, f, NOW)
    const later = new Date('2026-11-03T12:00:00.000Z')
    assert.equal(closeFacts(r, (t) => t.subject === 'person:ada', later), 1)
    assert.equal(closeFacts(r, (t) => t.subject === 'person:ada', later), 0)
    assert.equal(r.tuples.length, 1)
    assert.equal(r.tuples[0].until, later.toISOString())
    assert.equal(hasLive(r, f, later), false)
    assert.equal(addFact(r, f, later), true)
    assert.equal(r.tuples.length, 2)
  })
})

describe('members and tag rules', () => {
  it('a tag rule puts the tag\'s carriers in the zone; the derived tuple says through which tag', () => {
    const r = fixture()
    addFact(r, { subject: 'person:ada', relation: 'in_zone', object: 'zone:friend' }, NOW)
    addFact(r, { subject: 'person:bo', relation: 'has_tag', object: 'tag:garden' }, NOW)
    addFact(r, { subject: 'tag:garden', relation: 'in_zone', object: 'zone:friend' }, NOW)
    assert.deepEqual(membersOf(r, Zone.Friend, NOW), [{ person: 'person:ada' }, { person: 'person:bo', via: 'tag:garden' }])
    const derived = unfoldTagRules(r.tuples, ['person:ada', 'person:bo'], NOW)
    assert.deepEqual(derived, [{ subject: 'person:bo', relation: 'in_zone', object: 'zone:friend', tag: 'tag:garden', since: AT, by: 'device:laptop' }])
    assert.equal(zoneOfPersonIn(r, 'person:bo', NOW), Zone.Friend)
    assert.equal(zoneOfPersonIn(r, 'person:zed', NOW), Zone.Public)
  })
  it('a nested tag counts: carriers of the child are placed by a rule on the parent', () => {
    const r = fixture()
    addFact(r, { subject: 'person:bo', relation: 'has_tag', object: 'tag:roses' }, NOW)
    addFact(r, { subject: 'tag:roses', relation: 'nested_in', object: 'tag:garden' }, NOW)
    addFact(r, { subject: 'tag:garden', relation: 'in_zone', object: 'zone:friend' }, NOW)
    assert.deepEqual(membersOf(r, Zone.Friend, NOW), [{ person: 'person:bo', via: 'tag:garden' }])
  })
  it('an archived zone does not count for the person\'s zone, and the store folds in the latest share per item unless revoked', () => {
    const r = fixture()
    addFact(r, { subject: 'person:ada', relation: 'in_zone', object: 'zone:close' }, NOW)
    assert.equal(zoneOfPersonIn(r, 'person:ada', NOW), Zone.Public)
    const scope = { zone: Zone.Friend, include: [], exclude: [] }
    r.shares.push({ op: 'share', id: 'item:bike', seq: 1, scope, cutoff: 1, to: 'zone:friend', terms: 'read-keep', ts: AT })
    r.shares.push({ op: 'share', id: 'item:bike', seq: 2, scope: { ...scope, zone: Zone.Close }, cutoff: 2, to: 'zone:close', terms: 'read-keep', ts: AT })
    assert.equal(latestShares(r.shares).length, 1)
    assert.equal(latestShares(r.shares)[0].scope.zone, Zone.Close)
    assert.ok(storeOf(r, NOW).some((t) => t.subject === 'zone:close' && t.relation === 'may_read' && t.object === 'item:bike'))
    r.shares.push({ op: 'revoke', id: 'rev:1', seq: 3, target: 'item:bike', at: 3, ts: AT })
    assert.equal(latestShares(r.shares).length, 0)
  })
})
