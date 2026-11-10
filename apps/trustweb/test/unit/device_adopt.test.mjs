// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Take another device's state (src/device_adopt.ts): difference count, archive/restore round trip, adoption idempotent. */
import {
  ARCHIVE_DAYS, adoptBundle, archiveRecord, differences, readArchived, restoreArchived,
} from '../../src/device_adopt.ts'
import { bundleOf, refreshStamps, settingsOf } from '../../src/sync_core.ts'
import { adoptedEdit, applyEdit } from '../../src/record_diff.ts'

const DAY = 86_400_000
const NOW = Date.parse('2026-11-10T12:00:00Z')
const line = (id, text = id) => ({ id, text, tag: 'note', audience: 'close', status: 'current', notedAt: 1, checkedAt: 1 })
const person = (id, name, lines = [], extra = {}) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines, ...extra })
const state = (over = {}) => ({ v: 1, me: { displayName: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const bundle = (s) => bundleOf(s, refreshStamps(s, {}, 1, 'Phone'))
const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v) } } }

describe('differences', () => {
  it('identical records differ in nothing', () => {
    const s = state({ people: [person('a', 'Ada', [line('l1')])], membraneLimit: 5 })
    expect(differences(s, bundle(structuredClone(s)))).toEqual({ people: 0, notes: 0, settings: 0 })
  })
  it('counts people missing on either side or changed, and ignores the per-device picture', () => {
    const mine = state({ people: [person('a', 'Ada', [], { image: 'x' }), person('b', 'Ben'), person('c', 'Cy')] })
    const theirs = state({ people: [person('a', 'Ada'), person('b', 'Ben B'), person('d', 'Di')] })
    expect(differences(mine, bundle(theirs)).people).toBe(3) // b changed, c only mine, d only theirs
  })
  it('a person deleted here for 30 days counts as absent here', () => {
    const mine = state({ people: [person('a', 'Ada', [], { deleted_at: 'x', ring: 'none' })] })
    expect(differences(mine, bundle(state({ people: [person('a', 'Ada')] }))).people).toBe(1)
  })
  it('counts note lines that exist on one side only or read differently', () => {
    const mine = state({ people: [person('a', 'Ada', [line('l1'), line('l2', 'old')])] })
    const theirs = state({ people: [person('a', 'Ada', [line('l2', 'new'), line('l3')])] })
    expect(differences(mine, bundle(theirs)).notes).toBe(3) // l1 only mine, l2 changed, l3 only theirs
  })
  it('counts settings that differ, were set on one side only, or are per device (not counted)', () => {
    const mine = state({ membraneLimit: 5, city: 'Wien', notificationsOn: true })
    const theirs = state({ membraneLimit: 7, engagementDays: 30, notificationsOn: false })
    expect(differences(mine, bundle(theirs)).settings).toBe(3) // membraneLimit, city, engagementDays
  })
})

describe('adoptBundle', () => {
  it('makes the shared part identical and drops what only this side had', () => {
    const mine = state({ people: [person('a', 'Ada'), person('c', 'Cy')], inventory: [{ id: 'r1', text: 'Bike' }], city: 'Wien' })
    const theirs = state({ people: [person('a', 'Ada L', [line('l1')]), person('d', 'Di')], membraneLimit: 7, sameAs: { x: 'a' } })
    adoptBundle(mine, bundle(theirs))
    expect(mine.people.map((p) => [p.id, p.name])).toEqual([['a', 'Ada L'], ['d', 'Di']])
    expect(mine.inventory).toEqual([])
    expect(mine.city).toBeUndefined()
    expect(mine.membraneLimit).toBe(7)
    expect(mine.sameAs).toEqual({ x: 'a' })
    expect(differences(mine, bundle(theirs))).toEqual({ people: 0, notes: 0, settings: 0 })
  })
  it('keeps what is true of this device only, and the local picture of a person both sides know', () => {
    const mine = state({ people: [person('a', 'Ada', [], { image: 'pic' })], notificationsOn: true, identity: { did: 'did:me' }, peers: [{ id: 'p' }], tabRow: ['web'] })
    adoptBundle(mine, bundle(state({ people: [person('a', 'Ada L')], notificationsOn: false, tabRow: ['map'] })))
    expect(mine.notificationsOn).toBe(true)
    expect(mine.identity).toEqual({ did: 'did:me' })
    expect(mine.peers).toEqual([{ id: 'p' }])
    expect(mine.tabRow).toEqual(['web'])
    expect(mine.people[0]).toMatchObject({ name: 'Ada L', image: 'pic' })
  })
  it('a setting the other side lacks is removed here (wholesale)', () => {
    const mine = state({ city: 'Wien', membraneLimit: 3 })
    adoptBundle(mine, bundle(state({ membraneLimit: 3 })))
    expect(Object.keys(settingsOf(mine))).toEqual(['membraneLimit'])
  })
  it('is idempotent', () => {
    const theirs = bundle(state({ people: [person('a', 'Ada', [line('l1')])], inventory: [{ id: 'r', text: 'Drill' }], city: 'Graz', chats: {} }))
    const mine = state({ people: [person('z', 'Zed')], city: 'Wien' })
    adoptBundle(mine, theirs)
    const once = structuredClone(mine)
    adoptBundle(mine, theirs)
    expect(mine).toEqual(once)
  })
})

describe('archived copies', () => {
  const key = 'k'
  it('round trip: archive, list, restore gives the record back', () => {
    const store = memStore()
    const s = state({ people: [person('a', 'Ada', [line('l1')])], city: 'Wien' })
    expect(archiveRecord(store, key, s, { reason: 'before taking Phone', device: 'Phone' }, NOW)).toBe(true)
    const [c] = readArchived(store, key, NOW)
    expect(c).toMatchObject({ at: NOW, reason: 'before taking Phone', device: 'Phone', people: 1, expiresAt: NOW + ARCHIVE_DAYS * DAY })
    expect(restoreArchived(c, null)).toEqual(s)
  })
  it('the stored copy does not change when the live record does afterwards', () => {
    const store = memStore()
    const s = state({ people: [person('a', 'Ada')] })
    archiveRecord(store, key, s, { reason: 'r', device: 'd' }, NOW)
    s.people[0].name = 'changed'
    expect(readArchived(store, key, NOW)[0].record.people[0].name).toBe('Ada')
  })
  it('a copy goes after 30 days, newest first, and unreadable storage reads as none', () => {
    const store = memStore()
    archiveRecord(store, key, state(), { reason: 'old', device: 'd' }, NOW - 31 * DAY)
    archiveRecord(store, key, state(), { reason: 'a', device: 'd' }, NOW - DAY)
    archiveRecord(store, key, state(), { reason: 'b', device: 'd' }, NOW)
    expect(readArchived(store, key, NOW).map((c) => c.reason)).toEqual(['b', 'a'])
    expect(readArchived({ getItem: () => '{oops', setItem: () => undefined }, key, NOW)).toEqual([])
  })
  it('full storage: nothing kept, false (the adoption must then not go ahead)', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(archiveRecord(full, key, state(), { reason: 'r', device: 'd' }, NOW)).toBe(false)
  })
  it('a restored record brings the transcript of a meeting back from the live one', () => {
    const store = memStore()
    archiveRecord(store, key, state({ meetings: [{ id: 'm', about: 'x', transcript: [{ t: 'hi' }] }] }), { reason: 'r', device: 'd' }, NOW)
    const live = state({ meetings: [{ id: 'm', about: 'x', transcript: [{ t: 'hi' }] }] })
    expect(restoreArchived(readArchived(store, key, NOW)[0], live).meetings[0].transcript).toEqual([{ t: 'hi' }])
  })
})

describe('edit stream entry', () => {
  it('is one adopted-from-device edit naming the device and the differences; replaying it changes nothing', () => {
    const e = adoptedEdit({ at: 'x', previewId: 'p' }, 'Phone', { people: 2, notes: 1, settings: 0 })
    expect(e).toEqual({ at: 'x', previewId: 'p', kind: 'adopted-from-device', ids: [], before: null, after: { device: 'Phone', people: 2, notes: 1, settings: 0 } })
    const rec = { people: [{ id: 'a' }] }
    expect(applyEdit(rec, e)).toEqual(rec)
  })
})
