// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The record file: shape, validation, canonical bytes, discovery up the directory tree, and the audit log (I6). */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RECORD_FILE, RECORD_DIR, RecordError, appendLog, discoverRecord, emptyRecord, loadRecord, parseRecord, saveRecord, serializeRecord,
} from '../src/record.ts'

const NOW = new Date('2026-11-02T12:00:00.000Z')
const tmp = (): string => mkdtempSync(join(tmpdir(), 'trustweb-cli-'))

describe('emptyRecord and canonical bytes', () => {
  it('starts with no zones set up, no persons, tags, tuples, shares; one log line says who made it', () => {
    const r = emptyRecord('device:laptop', NOW)
    assert.equal(r.kind, 'trustweb-cli-record')
    assert.equal(r.v, 1)
    assert.equal(r.device, 'device:laptop')
    assert.deepEqual([r.zones, r.persons, r.tags, r.tuples, r.shares], [{}, {}, {}, [], []])
    assert.equal(r.log.length, 1)
    assert.equal(r.log[0].at, NOW.toISOString())
  })
  it('serializes with keys in a fixed order and a final newline, so the same record is always the same bytes', () => {
    const a = emptyRecord('device:laptop', NOW)
    const b = { ...a, log: a.log, shares: a.shares, tuples: a.tuples, tags: a.tags, persons: a.persons, zones: a.zones, device: a.device, v: a.v, kind: a.kind }
    assert.equal(serializeRecord(a), serializeRecord(b))
    assert.ok(serializeRecord(a).endsWith('\n'))
    assert.ok(serializeRecord(a).startsWith('{\n  "kind": "trustweb-cli-record",\n  "v": 1,\n  "device": "device:laptop"'))
  })
})

describe('parseRecord', () => {
  it('round-trips what it wrote', () => {
    const r = emptyRecord('device:laptop', NOW)
    r.zones.friend = { label: 'Friends', createdAt: NOW.toISOString() }
    r.persons.ada = { name: 'Ada', addedAt: NOW.toISOString() }
    r.tuples.push({ subject: 'person:ada', relation: 'in_zone', object: 'zone:friend', since: NOW.toISOString(), by: 'device:laptop' })
    assert.deepEqual(parseRecord(serializeRecord(r)), r)
  })
  it('refuses what is not a record, naming the problem', () => {
    const bad = (text: string, re: RegExp): void => assert.throws(() => parseRecord(text), (e: unknown) => e instanceof RecordError && re.test(e.message))
    bad('nope', /JSON/)
    bad('[]', /object/)
    bad('{"kind":"other","v":1}', /kind/)
    bad('{"kind":"trustweb-cli-record","v":2}', /version/)
    bad(JSON.stringify({ ...emptyRecord('d', NOW), zones: { mars: { label: 'x', createdAt: NOW.toISOString() } } }), /zone.*mars/)
    bad(JSON.stringify({ ...emptyRecord('d', NOW), zones: { public: { label: 'x', createdAt: NOW.toISOString() } } }), /public/)
    bad(JSON.stringify({ ...emptyRecord('d', NOW), persons: { 'a b': { name: 'x', addedAt: NOW.toISOString() } } }), /person.*a b/)
    bad(JSON.stringify({ ...emptyRecord('d', NOW), tuples: [{ subject: 'person:a', relation: 'flies', object: 'x', since: 'now', by: 'd' }] }), /tuple.*1/)
    bad(JSON.stringify({ ...emptyRecord('d', NOW), shares: [{ op: 'dance' }] }), /share.*1/)
    bad(JSON.stringify({ ...emptyRecord('d', NOW), device: '' }), /device/)
  })
  it('validates tuples with the share sink\'s own parser (a zone id off the ladder is refused)', () => {
    const r = emptyRecord('d', NOW)
    r.tuples.push({ subject: 'person:a', relation: 'in_zone', object: 'zone:mars', since: NOW.toISOString(), by: 'd' })
    assert.throws(() => parseRecord(serializeRecord(r)), RecordError)
  })
})

describe('files', () => {
  it('saveRecord writes the canonical bytes, loadRecord reads them back', () => {
    const dir = tmp()
    const file = join(dir, RECORD_DIR, RECORD_FILE)
    const r = emptyRecord('device:laptop', NOW)
    saveRecord(file, r)
    assert.equal(readFileSync(file, 'utf8'), serializeRecord(r))
    assert.deepEqual(loadRecord(file), r)
  })
  it('loadRecord reports a missing file and a damaged file as RecordErrors that name the path', () => {
    const dir = tmp()
    const missing = join(dir, 'none.json')
    assert.throws(() => loadRecord(missing), (e: unknown) => e instanceof RecordError && e.message.includes(missing))
    const damaged = join(dir, 'bad.json')
    writeFileSync(damaged, '{"kind"')
    assert.throws(() => loadRecord(damaged), (e: unknown) => e instanceof RecordError && e.message.includes(damaged))
  })
  it('discoverRecord: an explicit path wins, then the environment, then .trustweb/record.json up the tree; else null', () => {
    const root = tmp()
    const deep = join(root, 'a', 'b')
    mkdirSync(deep, { recursive: true })
    assert.equal(discoverRecord(deep, {}), null)
    mkdirSync(join(root, RECORD_DIR))
    writeFileSync(join(root, RECORD_DIR, RECORD_FILE), '{}')
    assert.equal(discoverRecord(deep, {}), join(root, RECORD_DIR, RECORD_FILE))
    assert.equal(discoverRecord(deep, { TRUSTWEB_RECORD: '/elsewhere/r.json' }), '/elsewhere/r.json')
    assert.equal(discoverRecord(deep, { TRUSTWEB_RECORD: '/elsewhere/r.json' }, 'given.json'), join(deep, 'given.json'))
  })
})

describe('appendLog', () => {
  it('adds one human-readable line with the time, the device and the command; nothing is removed', () => {
    const r = emptyRecord('device:laptop', NOW)
    const later = new Date('2026-11-02T13:00:00.000Z')
    appendLog(r, 'zone create friend', 'set up zone friend ("Friends")', later)
    assert.equal(r.log.length, 2)
    assert.deepEqual(r.log[1], { at: later.toISOString(), by: 'device:laptop', command: 'zone create friend', text: 'set up zone friend ("Friends")' })
  })
})
