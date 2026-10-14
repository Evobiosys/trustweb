/** Device sync, the pure part (src/sync_core.ts): stamps, merge, chunks, pairing code, fingerprint. */
import {
  CHUNK_BYTES, bundleOf, countsOf, fingerprintOf, fromChunks, mergeBundle, pairingCode, parseBundle, parsePairingCode, refreshStamps, stampsAfterMerge, toChunks,
} from '../../src/sync_core.ts'

const line = (id, text = id) => ({ id, text, tag: 'note', audience: 'close', status: 'current', notedAt: 1, checkedAt: 1 })
const person = (id, name, lines = []) => ({ id, name, context: '', ring: 'friend', metAt: 1, lines })
const state = (over = {}) => ({ v: 1, me: { name: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const item = (id, text, extra = {}) => ({ id, text, audience: 'close', included: true, createdAt: 1, ...extra })
const DID = 'did:peer:2.' + 'Vz6Mk'.repeat(10)

describe('stamps', () => {
  it('a new entity gets now, an unchanged one keeps its stamp, an edited one gets the new now', () => {
    const s = state({ people: [person('a', 'Ada')] })
    const t1 = refreshStamps(s, {}, 100)
    expect(t1['p:a'].at).toBe(100)
    expect(refreshStamps(s, t1, 200)['p:a'].at).toBe(100)
    s.people[0].name = 'Ada L'
    expect(refreshStamps(s, t1, 300)['p:a'].at).toBe(300)
  })
})

describe('merge', () => {
  it('adds unknown ids both ways and deletes nothing', () => {
    const mac = state({ people: [person('a', 'Ada')], inventory: [item('r1', 'Bike')] })
    const phone = state({ people: [person('b', 'Ben')], meetings: [{ id: 'm1', about: 'Ben' }] })
    const res = mergeBundle(mac, refreshStamps(mac, {}, 1), bundleOf(phone, refreshStamps(phone, {}, 1)), 0)
    expect(res).toMatchObject({ added: 2, updated: 0, conflicts: [] })
    expect(mac.people.map((p) => p.id)).toEqual(['a', 'b'])
    expect(mac.inventory).toHaveLength(1)
    expect(mac.meetings).toHaveLength(1)
  })
  it('the same id keeps the newer version; note lines are united; a both-sides edit is a conflict', () => {
    const mine = state({ people: [person('a', 'Ada old', [line('l1')])] })
    const theirs = state({ people: [person('a', 'Ada new', [line('l2')])] })
    const myStamps = refreshStamps(mine, {}, 100)
    const res = mergeBundle(mine, myStamps, bundleOf(theirs, refreshStamps(theirs, {}, 200)), 50)
    expect(mine.people[0].name).toBe('Ada new')
    expect(mine.people[0].lines.map((l) => l.id).sort()).toEqual(['l1', 'l2'])
    expect(res.updated).toBe(1)
    expect(res.conflicts).toHaveLength(1)
    expect(res.conflicts[0]).toMatchObject({ kind: 'person', kept: 'theirs', label: 'Ada new' })
  })
  it('an older remote version loses; an edit on one side only is no conflict', () => {
    const mine = state({ people: [person('a', 'Mine')] })
    const theirs = state({ people: [person('a', 'Theirs')] })
    const res = mergeBundle(mine, refreshStamps(mine, {}, 300), bundleOf(theirs, refreshStamps(theirs, {}, 100)), 200)
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
    const sa = refreshStamps(a, {}, 1), sb = refreshStamps(b, {}, 1)
    mergeBundle(a, sa, bundleOf(b, sb), 0)
    const again = mergeBundle(a, stampsAfterMerge(a, sa, bundleOf(b, sb), 2), bundleOf(b, sb), 0)
    expect(again).toMatchObject({ added: 0, updated: 0 })
    const back = mergeBundle(b, sb, bundleOf(a, stampsAfterMerge(a, sa, bundleOf(b, sb), 2)), 0)
    expect(back.added).toBe(1)
    expect(b.people.map((p) => p.id).sort()).toEqual(['a', 'b'])
  })
  it('counts people, lines, resources, meetings', () => {
    expect(countsOf({ people: [person('a', 'A', [line('1'), line('2')])], inventory: [item('r', 'x')], meetings: [] })).toEqual({ people: 1, lines: 2, resources: 1, meetings: 0 })
  })
})

describe('chunks and bundle shape', () => {
  it('a big record round-trips in pieces under the size bound', () => {
    const big = state({ people: Array.from({ length: 800 }, (_, i) => person('p' + i, 'Person ' + i + ' ü', [line('l' + i, 'x'.repeat(150))])) })
    const bundle = bundleOf(big, refreshStamps(big, {}, 1))
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
