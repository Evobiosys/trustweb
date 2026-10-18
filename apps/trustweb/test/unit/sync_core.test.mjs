/** Device sync, the pure part (src/sync_core.ts): stamps, merge, chunks, pairing code, fingerprint. */
import {
  CHUNK_BYTES, REVIEW_MAX, bundleOf, recordReview, countsOf, fingerprintOf, fromChunks, mergeBundle, pairingCode, parseBundle, parsePairingCode, refreshStamps, stampsAfterMerge, toChunks,
} from '../../src/sync_core.ts'

const line = (id, text = id) => ({ id, text, tag: 'note', audience: 'close', status: 'current', notedAt: 1, checkedAt: 1 })
const person = (id, name, lines = []) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines })
const state = (over = {}) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const item = (id, text, extra = {}) => ({ id, text, audience: 'close', included: true, createdAt: 1, ...extra })
const DID = 'did:peer:2.' + 'Vz6Mk'.repeat(10)

describe('stamps', () => {
  it('a new entity gets now, an unchanged one keeps its stamp, an edited one gets the new now', () => {
    const s = state({ people: [person('a', 'Ada')] })
    const t1 = refreshStamps(s, {}, 100, 'T')
    expect(t1['p:a'].at).toBe(100)
    expect(refreshStamps(s, t1, 200, 'T')['p:a'].at).toBe(100)
    s.people[0].name = 'Ada L'
    expect(refreshStamps(s, t1, 300, 'T')['p:a'].at).toBe(300)
  })
})

describe('merge', () => {
  it('adds unknown ids both ways and deletes nothing', () => {
    const mac = state({ people: [person('a', 'Ada')], inventory: [item('r1', 'Bike')] })
    const phone = state({ people: [person('b', 'Ben')], meetings: [{ id: 'm1', about: 'Ben' }] })
    const res = mergeBundle(mac, refreshStamps(mac, {}, 1, 'T'), bundleOf(phone, refreshStamps(phone, {}, 1, 'T')), 0)
    expect(res).toMatchObject({ added: 2, updated: 0, conflicts: [] })
    expect(mac.people.map((p) => p.id)).toEqual(['a', 'b'])
    expect(mac.inventory).toHaveLength(1)
    expect(mac.meetings).toHaveLength(1)
  })
  it('the same id keeps the newer version; note lines are united; a both-sides edit is a conflict', () => {
    const mine = state({ people: [person('a', 'Ada old', [line('l1')])] })
    const theirs = state({ people: [person('a', 'Ada new', [line('l2')])] })
    const myStamps = refreshStamps(mine, {}, 100, 'T')
    const res = mergeBundle(mine, myStamps, bundleOf(theirs, refreshStamps(theirs, {}, 200, 'T')), 50)
    expect(mine.people[0].name).toBe('Ada new')
    expect(mine.people[0].lines.map((l) => l.id).sort()).toEqual(['l1', 'l2'])
    expect(res.updated).toBe(1)
    expect(res.conflicts).toHaveLength(1)
    expect(res.conflicts[0]).toMatchObject({ kind: 'person', kept: 'theirs', label: 'Ada new' })
  })
  it('an older remote version loses; an edit on one side only is no conflict', () => {
    const mine = state({ people: [person('a', 'Mine')] })
    const theirs = state({ people: [person('a', 'Theirs')] })
    const res = mergeBundle(mine, refreshStamps(mine, {}, 300, 'T'), bundleOf(theirs, refreshStamps(theirs, {}, 100, 'T')), 200)
    expect(mine.people[0].name).toBe('Mine')
    expect(res.conflicts).toHaveLength(0)
  })
  it('a picture id is dropped on arrival (the picture stays on its device)', () => {
    const mine = state()
    mergeBundle(mine, {}, bundleOf(state({ inventory: [item('r', 'Drill', { imageId: 'img1' })] }), {}), 0)
    expect(mine.inventory[0].imageId).toBeUndefined()
  })
  it('merging twice is a no-op (two-way converges)', () => {
    const a = state({ people: [person('a', 'Ada')] })
    const b = state({ people: [person('b', 'Ben')] })
    const sa = refreshStamps(a, {}, 1, 'T'), sb = refreshStamps(b, {}, 1, 'T')
    mergeBundle(a, sa, bundleOf(b, sb), 0)
    const again = mergeBundle(a, stampsAfterMerge(a, sa, bundleOf(b, sb), 2, 'A', 'B'), bundleOf(b, sb), 0)
    expect(again).toMatchObject({ added: 0, updated: 0 })
    const back = mergeBundle(b, sb, bundleOf(a, stampsAfterMerge(a, sa, bundleOf(b, sb), 2, 'A', 'B')), 0)
    expect(back.added).toBe(1)
    expect(b.people.map((p) => p.id).sort()).toEqual(['a', 'b'])
  })
  it('counts people, lines, resources, meetings', () => {
    expect(countsOf({ people: [person('a', 'A', [line('1'), line('2')])], inventory: [item('r', 'x')], meetings: [] })).toEqual({ people: 1, lines: 2, resources: 1, meetings: 0, events: 0, messages: 0 })
  })
})

describe('blocked travels', () => {
  it('a block arrives, and a newer unblock (0) beats it', () => {
    const mine = state({ people: [person('a', 'Ada')] })
    const blocked = state({ people: [{ ...person('a', 'Ada'), blocked: 7 }] })
    mergeBundle(mine, refreshStamps(mine, {}, 1, 'T'), bundleOf(blocked, refreshStamps(blocked, {}, 5, 'T')), 0)
    expect(mine.people[0].blocked).toBe(7)
    const unblocked = state({ people: [{ ...person('a', 'Ada'), blocked: 0 }] })
    mergeBundle(mine, refreshStamps(mine, {}, 5, 'T'), bundleOf(unblocked, refreshStamps(unblocked, {}, 9, 'T')), 0)
    expect(mine.people[0].blocked).toBe(0)
  })
})

describe('chunks and bundle shape', () => {
  it('a big record round-trips in pieces under the size bound', () => {
    const big = state({ people: Array.from({ length: 800 }, (_, i) => person('p' + i, 'Person ' + i + ' ü', [line('l' + i, 'x'.repeat(150))])) })
    const bundle = bundleOf(big, refreshStamps(big, {}, 1, 'T'))
    const pieces = toChunks(bundle)
    expect(pieces.length).toBeGreaterThan(1)
    expect(pieces.every((p) => p.length <= CHUNK_BYTES)).toBe(true)
    expect(fromChunks(pieces)).toEqual(bundle)
  })
  it('garbage and wrong shapes are nothing', () => {
    expect(fromChunks([new TextEncoder().encode('{nope')])).toBeNull()
    expect(parseBundle({ v: 2, people: [], inventory: [], meetings: [], at: {} })).toBeNull()
    expect(parseBundle({ v: 1, people: [{ id: 'a' }], inventory: [], meetings: [], at: {} })).toBeNull()
    expect(parseBundle(null)).toBeNull()
  })
})

describe('pairing code and fingerprint', () => {
  const SECRET = 'a'.repeat(22)
  it('round-trips; anything else is refused', () => {
    expect(parsePairingCode(pairingCode(DID, SECRET))).toEqual({ did: DID, secret: SECRET })
    expect(parsePairingCode('TWD1~' + DID)).toBeNull()
    expect(parsePairingCode('XXX1~' + DID + '~' + SECRET)).toBeNull()
    expect(parsePairingCode(pairingCode('did:web:x', SECRET))).toBeNull()
    expect(parsePairingCode(pairingCode(DID, SECRET) + '~x')).toBeNull()
  })
  it('the fingerprint is 4 upper-case hex characters, stable per secret', async () => {
    const a = await fingerprintOf(new Uint8Array(32).fill(1))
    expect(a).toMatch(/^[0-9A-F]{4}$/)
    expect(await fingerprintOf(new Uint8Array(32).fill(1))).toBe(a)
    expect(await fingerprintOf(new Uint8Array(32).fill(2))).not.toBe(a)
  })
})

const msg = (dir, sentAt, text, state, at = sentAt) => ({ key: `${dir === 'out' ? 'o' : 'i'}:${sentAt}:${text}`, dir, text, at, sentAt, state })
const ev = (id, name, extra = {}) => ({ id, name, from: '2026-10-01', where: 'x', createdAt: 1, attended: true, ...extra })

describe('bundle v2', () => {
  it('a v1 bundle is still read; a malformed v2 field makes the bundle nothing', () => {
    expect(parseBundle({ v: 1, people: [], inventory: [], meetings: [], at: {} })).not.toBeNull()
    const ok = bundleOf(state(), {})
    expect(parseBundle(JSON.parse(JSON.stringify(ok)))).toEqual(ok)
    for (const bad of [{ events: [{ id: 'e' }] }, { chats: 5 }, { sameAs: { a: 1 } }, { channels: { mine: { signal: 5 }, share: {} } }, { by: [] }]) {
      expect(parseBundle({ ...JSON.parse(JSON.stringify(ok)), ...bad })).toBeNull()
    }
  })
  it('self-maps in sameAs and event-local fields are dropped on arrival; images and non-text chat fields never travel', () => {
    const ok = JSON.parse(JSON.stringify(bundleOf(state(), {})))
    const p = parseBundle({ ...ok, sameAs: { a: 'a', b: 'c' }, events: [ev('e1', 'E', { srv: 'x', hitTagged: true, fromLink: true })] })
    expect(p.sameAs).toEqual({ b: 'c' })
    expect(p.events[0]).not.toHaveProperty('srv')
    const withMsg = state({ chats: { p1: { unread: 1, messages: [{ ...msg('in', 5, 'hi', 'received'), imageId: 'img', audio: 'a' }, { key: 'bad' }] } } })
    expect(bundleOf(withMsg, {}).chats.p1.messages).toEqual([msg('in', 5, 'hi', 'received')])
  })
})

describe('merge v2: events, channels, chats', () => {
  it('events merge by id, newer wins, conflict listed; local-only event fields stay', () => {
    const a = state({ events: [ev('e1', 'Phone name')] })
    const b = state({ events: [ev('e1', 'Mac name', { srv: 'abc' }), ev('e2', 'Only mac')] })
    const res = mergeBundle(b, refreshStamps(b, {}, 100, 'Mac'), bundleOf(a, refreshStamps(a, {}, 200, 'Phone')), 50)
    expect(b.events.map((e) => e.name)).toEqual(['Phone name', 'Only mac'])
    expect(b.events[0].srv).toBe('abc')
    expect(res.conflicts[0]).toMatchObject({ kind: 'event', kept: 'theirs', mineBy: 'Mac', theirsBy: 'Phone', mineAt: 100, theirsAt: 200 })
  })
  it('chats: union by key, further state wins, ordered by (sentAt, key), unread = max, nothing dropped', () => {
    const a = state({ chats: { p: { unread: 2, messages: [msg('out', 1, 'one', 'delivered'), msg('in', 3, 'three', 'received')] } } })
    const b = state({ chats: { p: { unread: 1, messages: [msg('out', 1, 'one', 'pending'), msg('out', 2, 'two', 'pending')] } } })
    mergeBundle(b, {}, bundleOf(a, {}), 0)
    expect(b.chats.p.messages.map((m) => [m.sentAt, m.state])).toEqual([[1, 'delivered'], [2, 'pending'], [3, 'received']])
    expect(b.chats.p.unread).toBe(2)
    const again = mergeBundle(b, {}, bundleOf(a, {}), 0)
    expect(again.added).toBe(0)
  })
  it('chats trim to 200 in the device-independent order, the same on both sides', () => {
    const many = (from) => Array.from({ length: 150 }, (_, i) => msg('in', from + i, 't' + (from + i), 'received'))
    const a = state({ chats: { p: { unread: 0, messages: many(1) } } })
    const b = state({ chats: { p: { unread: 0, messages: many(101) } } })
    const a2 = structuredClone(a)
    mergeBundle(a, {}, bundleOf(b, {}), 0)
    mergeBundle(b, {}, bundleOf(a2, {}), 0)
    expect(a.chats.p.messages).toHaveLength(200)
    expect(a.chats.p.messages[0].sentAt).toBe(51)
    expect(b.chats.p.messages).toEqual(a.chats.p.messages)
  })
  it('channels: a saved value beats none; two different values: newer wins and the other is listed; ticks follow the winner', () => {
    const a = state({ myChannels: { signal: 'S-a', matrix: '@a:x.org' }, contactShare: { shareOnConnect: { signal: true, matrix: true } } })
    const b = state({ myChannels: { signal: 'S-b' }, contactShare: { shareOnConnect: { signal: false } } })
    const res = mergeBundle(b, refreshStamps(b, {}, 100, 'Mac'), bundleOf(a, refreshStamps(a, {}, 200, 'Phone')), 0)
    expect(b.myChannels).toEqual({ signal: 'S-a', matrix: '@a:x.org' })
    expect(b.contactShare.shareOnConnect).toEqual({ signal: true, matrix: true })
    expect(res.conflicts).toHaveLength(1)
    expect(res.conflicts[0]).toMatchObject({ kind: 'channel', id: 'signal', kept: 'theirs', mine: 'S-b', theirs: 'S-a' })
    const older = state({ myChannels: { signal: 'S-new' }, contactShare: { shareOnConnect: { signal: false } } })
    mergeBundle(older, refreshStamps(older, {}, 900, 'Mac'), bundleOf(a, refreshStamps(a, {}, 200, 'Phone')), 0)
    expect(older.myChannels.signal).toBe('S-new')
    expect(older.contactShare.shareOnConnect.signal).toBe(false)
  })
  it('fields only the loser has are taken over (person, resource, meeting)', () => {
    const mine = state({ people: [{ ...person('a', 'Ada'), generalNote: 'n', channels: { signal: 'x' } }], inventory: [item('r', 'Drill', { imageId: 'img' })] })
    const theirs = state({ people: [{ ...person('a', 'Ada new'), channels: { matrix: 'm' } }], inventory: [item('r', 'Drill 2')] })
    mergeBundle(mine, refreshStamps(mine, {}, 100, 'Mac'), bundleOf(theirs, refreshStamps(theirs, {}, 200, 'Phone')), 0)
    expect(mine.people[0]).toMatchObject({ name: 'Ada new', generalNote: 'n', channels: { signal: 'x', matrix: 'm' } })
    expect(mine.inventory[0]).toMatchObject({ text: 'Drill 2', imageId: 'img' })
  })
  it('stamps remember who changed and who brought an entity in', () => {
    const a = state({ people: [person('a', 'Ada')] })
    const sa = refreshStamps(a, {}, 5, 'Phone')
    expect(sa['p:a']).toMatchObject({ by: 'Phone', from: 'Phone', at: 5 })
    const b = state()
    const sb = refreshStamps(b, {}, 6, 'Mac')
    mergeBundle(b, sb, bundleOf(a, sa), 0)
    expect(stampsAfterMerge(b, sb, bundleOf(a, sa), 9, 'Mac', 'Phone')['p:a']).toMatchObject({ by: 'Phone', from: 'Phone', at: 5 })
  })
  it('recordReview keeps at most 50, newest first, meetings slimmed', () => {
    const s = state()
    const c = (i) => ({ kind: 'meeting', id: 'm' + i, label: 'x', kept: 'mine', mine: { id: 'm' + i, transcript: [1, 2], outbox: [1] }, theirs: {} })
    recordReview(s, Array.from({ length: 40 }, (_, i) => c(i)))
    recordReview(s, Array.from({ length: 40 }, (_, i) => c(100 + i)))
    expect(s.syncReview).toHaveLength(REVIEW_MAX)
    expect(s.syncReview[0].id).toBe('m100')
    expect(s.syncReview[0].mine).toEqual({ id: 'm100', transcript: [] })
  })
})

describe('sameAs in sync', () => {
  it('an incoming id is mapped through my map and theirs; a dropped id never comes back; merging twice is idempotent', () => {
    const mac = state({ people: [person('keep', 'Ada')], sameAs: { drop: 'keep' } })
    const phone = state({ people: [person('drop', 'Ada', [line('l9')])] })
    mergeBundle(mac, refreshStamps(mac, {}, 1, 'Mac'), bundleOf(phone, refreshStamps(phone, {}, 2, 'Phone')), 0)
    expect(mac.people.map((p) => p.id)).toEqual(['keep'])
    expect(mac.people[0].lines.map((l) => l.id)).toEqual(['l9'])
    const snap = JSON.stringify(mac)
    mergeBundle(mac, refreshStamps(mac, {}, 3, 'Mac'), bundleOf(phone, refreshStamps(phone, {}, 2, 'Phone')), 0)
    expect(JSON.stringify(mac)).toBe(snap)
  })
  it("their map collapses my local persons (and travels on to me); clashes keep the smaller target and list a row", () => {
    const mac = state({ people: [person('x', 'Ada'), person('y', 'Ada')], sameAs: { q: 'z' } })
    const phone = state({ people: [person('y', 'Ada')], sameAs: { x: 'y', q: 'b' } })
    const res = mergeBundle(mac, {}, bundleOf(phone, {}), 0)
    expect(mac.people.map((p) => p.id)).toEqual(['y'])
    expect(mac.sameAs).toEqual({ q: 'b', x: 'y' })
    expect(res.conflicts.find((c) => c.kind === 'sameAs')).toMatchObject({ id: 'q', mine: 'z', theirs: 'b', kept: 'theirs' })
  })
  it('incoming stamp keys follow the id (p:X -> p:Y)', () => {
    const mac = state({ people: [person('y', 'Ada old')], sameAs: { x: 'y' } })
    const phone = state({ people: [person('x', 'Ada new')] })
    mergeBundle(mac, refreshStamps(mac, {}, 100, 'Mac'), bundleOf(phone, refreshStamps(phone, {}, 200, 'Phone')), 0)
    expect(mac.people[0].name).toBe('Ada new')
  })
})

describe('review fixes (DS-01, DS-02, DS-04, DS-06)', () => {
  const merged = (mineMap, theirMap) => {
    const mine = state({ sameAs: mineMap })
    mergeBundle(mine, {}, { v: 2, people: [], inventory: [], meetings: [], at: {}, sameAs: theirMap }, 0)
    return mine.sameAs
  }
  it('a reverse pair never makes a 2-cycle: the larger id points at the smaller, either way round', async () => {
    const { resolveSameAs } = await import('../../src/same_person.ts')
    expect(merged({ B: 'A' }, { A: 'B' })).toEqual({ B: 'A' })
    expect(merged({ A: 'B' }, { B: 'A' })).toEqual({ B: 'A' })
    expect(resolveSameAs(merged({ A: 'B' }, { B: 'A' }), 'A')).toBe('A')
  })
  it('a clash X->Y vs X->Z keeps the smaller target and lists it; re-declaring after stays acyclic', async () => {
    const { mergePersons, resolveSameAs } = await import('../../src/same_person.ts')
    const mine = state({ sameAs: { X: 'Z' } })
    const res = mergeBundle(mine, {}, { v: 2, people: [], inventory: [], meetings: [], at: {}, sameAs: { X: 'Y' } }, 0)
    expect(mine.sameAs).toEqual({ X: 'Y' })
    expect(res.conflicts.filter((c) => c.kind === 'sameAs')).toHaveLength(1)
    const s = state({ people: [person('A', 'Ada'), person('B', 'Ada')], sameAs: { A: 'B' } })
    expect(mergePersons(s, 'A', 'B')).toBe(true)
    expect(s.sameAs).toEqual({ B: 'A' })
    expect(resolveSameAs({ A: 'B', B: 'A' }, 'B')).toBe('A')
    expect(resolveSameAs({ A: 'B', B: 'A' }, 'A')).toBe('A')
  })
  it('more threads than the bound: the quietest are dropped and listed', () => {
    const thread = (at) => ({ unread: 0, messages: [{ key: 'k' + at, dir: 'in', text: 'x', at, sentAt: at, state: 'received' }] })
    const chats = Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['p' + i, thread(i + 10)]))
    const mine = state({ chats })
    const res = mergeBundle(mine, {}, { v: 2, people: [], inventory: [], meetings: [], at: {}, chats: { extra: thread(5000) } }, 0)
    expect(Object.keys(mine.chats)).toHaveLength(300)
    expect(mine.chats.p0).toBeUndefined()
    expect(mine.chats.extra).toBeDefined()
    expect(res.conflicts.find((c) => c.kind === 'chat').label).toContain('1 chat thread')
  })
  it('parseBundle refuses a non-finite stamp', () => {
    const b = { v: 1, people: [], inventory: [], meetings: [], at: { 'p:a': 'soon' } }
    expect(parseBundle(b)).toBeNull()
    expect(parseBundle({ ...b, at: { 'p:a': 5 } })).not.toBeNull()
  })
})
