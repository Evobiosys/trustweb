/**
 * State safety (review-app-a, wave 1733): the regression net for every later
 * round that touches the stored record. The next deploy lands on a phone whose
 * data exists nowhere else, so:
 *   1. A realistic record saved by the build BEFORE wave 1733 (tag
 *      trustweb-pre-wave-1733-2026-10-06: people, notes with and without
 *      meetings, inventory, stored meetings, a kept meeting pack, demo content,
 *      demo accounts, received shares, fields this build does not know) migrates
 *      with nothing lost, nothing duplicated, unknown fields kept, idempotently.
 *   2. Migration never throws on odd-but-possible shapes; it skips them untouched.
 *   3. store.ts: a record that is there but unreadable is kept aside and never
 *      overwritten silently; where it cannot be kept aside, it is never written.
 *   4. The demo carry-over (localStorage, so untrusted): stale, replayed,
 *      malformed or hand-edited records cannot break or pollute the live record.
 */
import { Audience, Provenance, PROVENANCES, Ring, isDemoPerson, pastMeetings, sharedItems, threadsForRing } from '../../src/model.ts'
import { migrateSources } from '../../src/provenance.ts'
import { loadState, parseRecord, saveState, clearState, storageKey, unreadableKey, wasUnreadable } from '../../src/store.ts'
import { CARRY_KEY, CARRY_MAX_AGE_MS, mergeCarryOver, parseCarry, readCarry } from '../../src/demo_to_live.ts'
import { NOW, line, preWaveState } from '../fixtures/pre_wave_state.mjs'

const count = (s) => ({
  people: s.people.length,
  notes: s.people.reduce((n, p) => n + p.lines.length, 0),
  inventory: s.inventory.length,
  meetings: s.meetings.length,
  past: pastMeetings(s).length,
})
/** Everything but the sources: what must be byte-identical before and after migration. */
const withoutSources = (s) => JSON.parse(JSON.stringify(s, (k, v) => (k === 'source' ? undefined : v)))

describe('a pre-wave record migrates safely', () => {
  it('nothing lost, nothing duplicated, every other byte unchanged', () => {
    const before = preWaveState()
    const s = preWaveState()
    expect(migrateSources(s)).toBe(true)
    expect(count(s)).toEqual(count(before))
    expect(withoutSources(s)).toEqual(before)
    // unknown fields at every level are kept
    expect(s.unknownTopLevel).toEqual({ from: 'a later build', n: 1 })
    expect(s.people[1].futureField).toEqual({ keep: 'me' })
    expect(s.meetings[2].laterField).toBe(7)
  })
  it('every item and note gets one valid source, the right one', () => {
    const s = preWaveState()
    migrateSources(s)
    for (const x of [...s.inventory, ...s.people.flatMap((p) => p.lines)]) expect(PROVENANCES).toContain(x.source.kind)
    const note = (pid, id) => s.people.find((p) => p.id === pid).lines.find((l) => l.id === id).source
    expect(note('anna', 'a1')).toEqual({ kind: Provenance.RecordedMeeting, meetingId: 'm-anna' })
    expect(note('max', 'x1')).toEqual({ kind: Provenance.Typed })
    expect(note('demo-p1', 'd1')).toEqual({ kind: Provenance.Demo })
    // a kept pack's notes were shared by Lea, not recorded on this phone
    expect(note('lea', 'l1')).toEqual({ kind: Provenance.SharedByPerson, fromName: 'Lea', meetingId: 'm-lea' })
    expect(s.inventory.find((i) => i.id === 'i2').source).toEqual({ kind: Provenance.RecordedSolo, meetingId: 'm-inv' })
    expect(s.inventory.find((i) => i.id === 'demo-i1').source).toEqual({ kind: Provenance.Demo })
  })
  it('is idempotent: a second boot changes nothing and saves the same bytes', () => {
    const s = preWaveState()
    migrateSources(s)
    const once = JSON.stringify(s)
    expect(migrateSources(s)).toBe(false)
    expect(JSON.stringify(s)).toBe(once)
    const reloaded = JSON.parse(once)
    expect(migrateSources(reloaded)).toBe(false)
    expect(JSON.stringify(reloaded)).toBe(once)
  })
  it('what an asker can be matched against and receives is the same before and after', () => {
    const before = preWaveState()
    const after = preWaveState()
    migrateSources(after)
    for (const ring of [Ring.Close, Ring.Friend, Ring.Acquaintance]) {
      const a = threadsForRing(before, ring)
      const b = threadsForRing(after, ring)
      expect(JSON.stringify(b.threads)).toBe(JSON.stringify(a.threads))
      expect(JSON.stringify([...b.refs])).toBe(JSON.stringify([...a.refs]))
      expect(JSON.stringify(sharedItems([...b.refs.values()]))).toBe(JSON.stringify(sharedItems([...a.refs.values()])))
      expect(a.refs.size).toBeGreaterThan(0)
    }
  })
  it('the record grows by the sources only (reported size)', () => {
    const before = JSON.stringify(preWaveState()).length
    const s = preWaveState()
    migrateSources(s)
    const after = JSON.stringify(s).length
    const items = s.inventory.length + s.people.reduce((n, p) => n + p.lines.length, 0)
    console.log(`  fixture record: ${before} -> ${after} bytes (+${after - before} for ${items} sources, ${((after - before) / items).toFixed(0)} bytes each)`)
    expect((after - before) / items).toBeLessThan(80)
  })
})

describe('migration never throws on odd shapes; it leaves them as they are', () => {
  it.each([
    ['no meetings field', (s) => { delete s.meetings }],
    ['meetings not an array', (s) => { s.meetings = {} }],
    ['a meeting without lines', (s) => { delete s.meetings[0].lines }],
    ['a meeting line that is null', (s) => { s.meetings[0].lines.push(null) }],
    ['a person without lines', (s) => { delete s.people[1].lines }],
    ['a null person and a null note', (s) => { s.people.push(null); s.people[0].lines.push(null) }],
    ['an item without text', (s) => { delete s.inventory[0].text }],
    ['a broken demo field', (s) => { s.demo = { people: 'x' } }],
    ['no inventory at all', (s) => { delete s.inventory }],
    ['a source of an unknown kind (from a later build)', (s) => { s.inventory[0].source = { kind: 'from-the-future', x: 1 } }],
  ])('%s', (_name, spoil) => {
    const s = preWaveState()
    spoil(s)
    const odd = JSON.parse(JSON.stringify(s))
    expect(() => migrateSources(s)).not.toThrow()
    // whatever was odd is still there exactly as it was
    expect(JSON.stringify(withoutSources(s)).length).toBe(JSON.stringify(withoutSources(odd)).length)
  })
})

// ------------------------------------------------------------------ store.ts
class MemoryStorage {
  constructor() { this.map = new Map(); this.refuse = () => false }
  get length() { return this.map.size }
  key(i) { return [...this.map.keys()][i] ?? null }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null }
  setItem(k, v) { if (this.refuse(k, v)) throw new Error('QuotaExceededError'); this.map.set(k, String(v)) }
  removeItem(k) { this.map.delete(k) }
}

describe('store.ts never overwrites a record it cannot read', () => {
  let ls
  beforeEach(() => { ls = new MemoryStorage(); globalThis.localStorage = ls })
  afterEach(() => { delete globalThis.localStorage })

  it('a good record loads as it is; nothing is kept aside', () => {
    ls.setItem(storageKey('p-good'), JSON.stringify(preWaveState()))
    expect(loadState('p-good')?.me.displayName).toBe('Jakob')
    expect(wasUnreadable('p-good')).toBe(false)
    expect(ls.getItem(unreadableKey('p-good'))).toBeNull()
  })
  it.each([
    ['damaged JSON', '{"v":1,"me":{"id":"x"'],
    ['a later version', JSON.stringify({ ...preWaveState(), v: 2 })],
    ['no owner', JSON.stringify({ v: 1, people: [] })],
    ['not an object', '"just a string"'],
  ])('%s: kept aside untouched, then the live key may be written', (_name, raw) => {
    const p = 'p-' + Math.random().toString(36).slice(2, 8)
    ls.setItem(storageKey(p), raw)
    expect(loadState(p)).toBeNull()
    expect(wasUnreadable(p)).toBe(true)
    expect(ls.getItem(unreadableKey(p))).toBe(raw)
    // loading again keeps one copy, not two
    loadState(p)
    expect([...ls.map.keys()].filter((k) => k.startsWith('trustweb.unreadable.'))).toHaveLength(1)
    saveState(p, { v: 1, me: { id: 'n', displayName: 'New' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false })
    expect(ls.getItem(unreadableKey(p))).toBe(raw)
  })
  it('where the copy cannot be written (storage full), the live key is never written this visit', () => {
    const raw = JSON.stringify({ ...preWaveState(), v: 2 })
    ls.setItem(storageKey('p-full'), raw)
    ls.refuse = (k) => k.startsWith('trustweb.unreadable.')
    expect(loadState('p-full')).toBeNull()
    saveState('p-full', { v: 1, me: { id: 'n', displayName: 'New' }, people: [], peers: [], inventory: [], log: [], notificationsOn: false })
    expect(ls.getItem(storageKey('p-full'))).toBe(raw)
    // only "Reset this phone" (the person's explicit choice) lifts that
    clearState('p-full')
    expect(ls.getItem(storageKey('p-full'))).toBeNull()
  })
  it('parseRecord accepts every record the pre-wave build could use (and keeps aside an owner that is not an object)', () => {
    expect(parseRecord(JSON.stringify(preWaveState()))).not.toBeNull()
    expect(parseRecord('null')).toBeNull()
    expect(parseRecord('{"v":1,"me":"x"}')).toBeNull()
  })
})

// ------------------------------------------------------------------ carry-over
const goodCarry = (over = {}) => ({
  v: 1, at: NOW, name: 'Jakob',
  people: [{ id: 'c-own', name: 'Kim', context: 'Demo', ring: Ring.Friend, metAt: NOW, lines: [line('c1', 'Has a van')] }],
  inventory: [{ id: 'c-thing', text: 'Drill', audience: Audience.Friends, included: true, createdAt: NOW, source: { kind: Provenance.Typed } }],
  meetings: [],
  demo: { people: [], inventory: [] },
  ...over,
})

describe('a hostile, stale or broken carry-over cannot break or pollute the live record', () => {
  it('a stale record (older than a day) or one from the future counts as none', () => {
    expect(parseCarry(JSON.stringify(goodCarry()), NOW + 1000)).not.toBeNull()
    expect(parseCarry(JSON.stringify(goodCarry()), NOW + CARRY_MAX_AGE_MS + 1)).toBeNull()
    expect(parseCarry(JSON.stringify(goodCarry({ at: NOW + 2 * 3_600_000 })), NOW)).toBeNull()
  })
  it('listing LIVE ids as dummy never marks the person\'s real people or things dummy', () => {
    const live = preWaveState()
    const c = parseCarry(JSON.stringify(goodCarry({ demo: { people: ['anna', 'max', 'c-own'], inventory: ['i1'] } })), NOW)
    expect(c.demo.people).toEqual(['c-own'])
    const out = mergeCarryOver(live, c)
    expect(isDemoPerson(out, 'anna')).toBe(false)
    expect(isDemoPerson(out, 'max')).toBe(false)
    expect(out.demo.inventory).not.toContain('i1')
    // and straight into merge too (a record that skipped parseCarry)
    const raw = mergeCarryOver(live, { ...goodCarry(), demo: { people: ['anna'], inventory: ['i1'] } })
    expect(isDemoPerson(raw, 'anna')).toBe(false)
    expect(raw.demo).toEqual(live.demo)
  })
  it('a carried relay link is stripped, in parsing and in merging', () => {
    const withPeer = goodCarry({ people: [{ ...goodCarry().people[0], peerId: 'peer-anna' }] })
    expect(parseCarry(JSON.stringify(withPeer), NOW).people[0].peerId).toBeUndefined()
    expect(mergeCarryOver(preWaveState(), withPeer).people.find((p) => p.id === 'c-own').peerId).toBeUndefined()
  })
  it('malformed people, notes, things and meetings are left out; the rest still arrives', () => {
    const c = parseCarry(JSON.stringify(goodCarry({
      people: [{ id: 'no-lines', name: 'X', context: '', ring: Ring.Friend, metAt: NOW }, null, 'x',
        { ...goodCarry().people[0], lines: [line('ok', 'fine'), { id: 'bad' }, null] }],
      inventory: [{ id: 'bad-item', text: 7 }, goodCarry().inventory[0]],
      meetings: [{ id: 'bad-m', about: 'x' }],
    })), NOW)
    expect(c.people.map((p) => p.id)).toEqual(['c-own'])
    expect(c.people[0].lines.map((l) => l.id)).toEqual(['ok'])
    expect(c.inventory.map((i) => i.id)).toEqual(['c-thing'])
    expect(c.meetings).toEqual([])
    // and what arrives migrates without a throw
    const out = mergeCarryOver(preWaveState(), c)
    expect(() => migrateSources(out)).not.toThrow()
  })
  it('a live id carried again never replaces the live one; replaying adds nothing', () => {
    const live = preWaveState()
    const c = parseCarry(JSON.stringify(goodCarry({ people: [{ id: 'anna', name: 'NOT ANNA', context: '', ring: Ring.Friend, metAt: 1, lines: [] }] })), NOW)
    const once = mergeCarryOver(live, c)
    expect(once.people.find((p) => p.id === 'anna').name).toBe('Anna')
    expect(JSON.stringify(mergeCarryOver(once, c))).toBe(JSON.stringify(once))
  })
  it('readCarry drops a record that can never apply (stale or broken) on the way', () => {
    globalThis.localStorage = new MemoryStorage()
    try {
      localStorage.setItem(CARRY_KEY, JSON.stringify(goodCarry()))
      expect(readCarry(NOW + CARRY_MAX_AGE_MS + 1)).toBeNull()
      expect(localStorage.getItem(CARRY_KEY)).toBeNull()
      localStorage.setItem(CARRY_KEY, '{broken')
      expect(readCarry(NOW)).toBeNull()
      expect(localStorage.getItem(CARRY_KEY)).toBeNull()
      localStorage.setItem(CARRY_KEY, JSON.stringify(goodCarry()))
      expect(readCarry(NOW)?.name).toBe('Jakob')
      expect(localStorage.getItem(CARRY_KEY)).not.toBeNull()
    } finally {
      delete globalThis.localStorage
    }
  })
})
