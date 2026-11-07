// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// schema_version.ts: one ordered migration chain, a stamp, and no half-reading of a newer record.
import { toggleBar, addBar, moveBar } from '../../src/bottom_bar.ts'
import { SCHEMA_VERSION, SchemaNewerError, assertReadable, migrate } from '../../src/schema_version.ts'
import { parseRecord } from '../../src/store.ts'
import { bundleOf, parseBundle } from '../../src/sync_core.ts'
import { S } from '../../src/strings.ts'
import { readFileSync } from 'node:fs'

const base = (over = {}) => ({ v: 1, me: { id: 'me', displayName: 'J' }, peers: [], log: [], people: [], inventory: [], meetings: [], ...over })

describe('migrate', () => {
  it('stamps the version, and a second run changes nothing', () => {
    const s = base()
    expect(migrate(s)).toBe(true)
    expect(s.schemaVersion).toBe(SCHEMA_VERSION)
    const once = JSON.stringify(s)
    expect(migrate(s)).toBe(false)
    expect(JSON.stringify(s)).toBe(once)
  })
  it('refuses a newer record with both numbers in the message, leaving it untouched', () => {
    const s = base({ schemaVersion: SCHEMA_VERSION + 1, chats: 'garbage' })
    expect(() => migrate(s)).toThrow(SchemaNewerError)
    expect(() => migrate(s)).toThrow(`${SCHEMA_VERSION + 1}`)
    expect(() => migrate(s)).toThrow(`(${SCHEMA_VERSION})`)
    expect(s.chats).toBe('garbage')
    expect(() => assertReadable(SCHEMA_VERSION)).not.toThrow()
    expect(() => assertReadable(undefined)).not.toThrow()
  })
  it('parseRecord migrates a stored record and reads a newer one as unreadable', () => {
    expect(parseRecord(JSON.stringify(base())).schemaVersion).toBe(SCHEMA_VERSION)
    expect(parseRecord(JSON.stringify(base({ schemaVersion: SCHEMA_VERSION + 1 })))).toBeNull()
  })
  it('the sheet text carries both numbers', () => {
    expect(S.schemaNewer(3, 2)).toBe('This backup comes from a newer TrustWeb (format 3, this app reads 2). Update the app first.')
  })
  it('a bundle carries the sender\'s schema version through parseBundle', () => {
    const b = bundleOf(base(), {})
    expect(b.schemaVersion).toBe(SCHEMA_VERSION)
    expect(parseBundle(JSON.parse(JSON.stringify({ ...b, schemaVersion: 9 }))).schemaVersion).toBe(9)
  })
  it('About prints the constant', () => {
    expect(S.aboutVersion('abc', SCHEMA_VERSION)).toBe(`App version abc, data format v${SCHEMA_VERSION}`)
    expect(readFileSync(new URL('../../src/about.ts', import.meta.url), 'utf8')).toContain('S.aboutVersion(appVersion(), SCHEMA_VERSION)')
  })
})

describe('the chain runs each existing migration', () => {
  const git = { kind: 'typed' }
  it.each([
    ['migrateSources', { people: [{ id: 'p', name: 'P', lines: [{ id: 'l', text: 't' }] }] }, (s) => expect(s.people[0].lines[0].source).toEqual(git)],
    ['normaliseNoteFields', { meetings: [{ id: 'm', generalNotes: 42, lines: [], transcript: [] }] }, (s) => expect('generalNotes' in s.meetings[0]).toBe(false)],
    ['migrateChats', { chats: 'garbage' }, (s) => expect(s.chats).toEqual({})],
    ['repairConnectRecord', { connectCode: { code: 'x' } }, (s) => expect('connectCode' in s).toBe(false)],
    ['repairOtherCodes', { otherCodes: ['junk'] }, (s) => expect(s.otherCodes ?? []).toEqual([])],
    ['repairShareFields', { shareMode: 'both' }, (s) => expect(s.shareMode).toBeUndefined()],
    ['repairGeneralNotes', { people: [{ id: 'p', name: 'P', lines: [], generalNote: 5 }] }, (s) => expect('generalNote' in s.people[0]).toBe(false)],
    ['repairProfile', { profile: { norms: 'x' } }, (s) => expect(s.profile).toBeUndefined()],
    ['repairAgreements', { people: [{ id: 'p', name: 'P', lines: [], agreements: 'x' }] }, (s) => expect('agreements' in s.people[0]).toBe(false)],
  ])('%s', (_n, over, check) => {
    const s = base(over)
    migrate(s)
    check(s)
  })
})

describe('favourite -> pinned', () => {
  it('a stored record and an older bundle load favourite as pinned', () => {
    const rec = parseRecord(JSON.stringify(base({ people: [{ id: 'a', name: 'A', lines: [], favourite: true }] })))
    expect(rec.people[0]).toMatchObject({ pinned: true })
    expect(rec.people[0].favourite).toBeUndefined()
    const b = parseBundle({ v: 1, people: [{ id: 'a', name: 'A', lines: [], favourite: true }], inventory: [], meetings: [], at: {} })
    expect(b.people[0].pinned).toBe(true)
    expect(b.people[0].favourite).toBeUndefined()
  })
})

describe('bottom bar order reset (wave 33)', () => {
  const NEW = ['web', 'chat', 'record', 'events', 'inventory']
  const all = { events: true, feed: true, inventory: true, people: true, map: true }
  it('a record without the marker gets the new default once, whatever its schema version', () => {
    const s = base({ schemaVersion: 2, uiBar: { order: ['ask', 'inventory', 'web', 'record', 'chat', 'events'], primary: 'web' } })
    expect(migrate(s)).toBe(true)
    expect(s.uiBar.order).toEqual(NEW)
    expect(s.uiBar.primary).toBe('web')
    expect(s.uiBar.orderVersion).toBe(2)
    s.uiBar.order = ['chat', 'record', 'web']
    expect(migrate(s)).toBe(false)
    expect(s.uiBar.order).toEqual(['chat', 'record', 'web'])
  })
  it('a lower marker resets, a marker of 2 or more does not', () => {
    const low = base({ uiBar: { order: ['chat', 'record'], orderVersion: 1 } })
    migrate(low)
    expect(low.uiBar.order).toEqual(NEW)
    const done = base({ schemaVersion: 2, uiBar: { order: ['chat', 'record'], orderVersion: 2 } })
    expect(migrate(done)).toBe(false)
    expect(done.uiBar.order).toEqual(['chat', 'record'])
  })
  it('a custom order is reset too; opt-in views (feed) and hidden flags survive, ask does not', () => {
    const s = base({ uiBar: { order: ['events', 'feed', 'ask', 'record'], hidden: ['chat'] } })
    migrate(s)
    expect(s.uiBar.order).toEqual([...NEW, 'feed'])
    expect(s.uiBar.hidden).toEqual(['chat'])
  })
  it('an absent uiBar stays absent', () => {
    const s = base({ schemaVersion: 2 })
    migrate(s)
    expect('uiBar' in s).toBe(false)
  })
  it('a uiBar without an order keeps its fields and is marked, so a later custom order survives', () => {
    const s = base({ schemaVersion: 2, uiBar: { primary: 'web' } })
    migrate(s)
    expect(s.uiBar).toEqual({ primary: 'web', orderVersion: 2 })
  })
  it('a bar edited in the app carries the marker, so the next load keeps it', () => {
    for (const bar of [toggleBar(undefined, 'map', all), addBar(undefined, 'map', 'web', 'right', all), moveBar(undefined, 'chat', -1, all)]) {
      const s = base({ uiBar: bar })
      const order = [...bar.order]
      migrate(s)
      expect(s.uiBar.order).toEqual(order)
    }
  })
  it('the schema version stays 2: older builds keep syncing', () => {
    expect(SCHEMA_VERSION).toBe(2)
  })
})
