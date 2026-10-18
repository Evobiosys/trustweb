/** One username for all devices, the pure part (src/sync_code.ts + sync_core.ts + connect_code.ts keeper): bundle, parse, merge rules, owner flag, opens-on. */
import { bundleOf, mergeBundle, parseBundle, refreshStamps } from '../../src/sync_core.ts'
import { codesForBundle, mergeCodes, opensOn, parseCodeField, repairOtherCodes, validLongUrl, winnerOf } from '../../src/sync_code.ts'
import { createConnectKeeper, readConnectRecord, registrationDue, shortToShow } from '../../src/connect_code.ts'

const ORIGIN = 'https://app.trustintheweb.org'
const DID_A = 'did:peer:2.' + 'Vz6MkA'.repeat(8)
const DID_B = 'did:peer:2.' + 'Vz6MkB'.repeat(8)
const code = (c) => c.repeat(22)
const rec = (c, over = {}) => ({ code: code(c), secret: c.repeat(43), url: `${ORIGIN}/?connect=${encodeURIComponent(DID_A)}&id=p`, updatedAt: 1000, ...over })
const state = (over = {}) => ({ v: 1, me: { name: 'J', displayName: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const wire = (s) => JSON.parse(JSON.stringify(bundleOf(s, refreshStamps(s, {}, 1, 'T'))))

describe('the bundle carries the code', () => {
  it('connectCode + otherCodes travel without the local fields; a pairing that does not share sends none', () => {
    const s = state({ connectCode: rec('A', { name: 'ada', owner: 'other', fromDid: DID_B, stale: true, touchedAt: 5 }), otherCodes: [rec('B', { fromDid: DID_B }), rec('A')] })
    const b = parseBundle(wire(s))
    expect(b.connectCode).toEqual(rec('A', { name: 'ada' }))
    expect(b.otherCodes).toEqual([rec('B')])
    expect(codesForBundle(s, false)).toEqual({})
    expect(bundleOf(s, {}, false).connectCode).toBeUndefined()
  })
  it('parseBundle drops only a malformed code field, never the bundle; a url off our hosts is malformed', () => {
    const s = state({ people: [{ id: 'a', name: 'Ada', lines: [] }], connectCode: rec('A') })
    for (const bad of [{ secret: 'short' }, { url: 'http://app.trustintheweb.org/?connect=x' }, { url: 'https://evil.test/?connect=x' }, { code: 'no' }]) {
      const w = wire(s)
      w.connectCode = { ...w.connectCode, ...bad }
      const b = parseBundle(w)
      expect(b.people).toHaveLength(1)
      expect(b.connectCode).toBeUndefined()
    }
    const w = wire(s)
    w.otherCodes = [rec('B'), { junk: 1 }, rec('B')]
    expect(parseBundle(w).otherCodes).toEqual([rec('B')])
    expect(validLongUrl(`${ORIGIN}/?connect=x#frag`)).toBe(false)
    expect(parseCodeField(rec('A', { owner: 'other' })).owner).toBeUndefined()
  })
  it('the code never becomes a conflict: a changed code leaves syncReview alone', () => {
    const a = state({ connectCode: rec('A', { name: 'ada' }) })
    const b = state({ connectCode: rec('B', { name: 'bob' }) })
    const res = mergeBundle(a, refreshStamps(a, {}, 5, 'T'), parseBundle(wire(b)), 0)
    expect(res.conflicts).toEqual([])
  })
  it('the display name travels, the newer stamp wins', () => {
    const a = state({ me: { name: 'J', displayName: 'Old' } })
    const b = state({ me: { name: 'J', displayName: 'New' } })
    const stamps = refreshStamps(b, {}, 500, 'T')
    mergeBundle(a, refreshStamps(a, {}, 100, 'T'), parseBundle(JSON.parse(JSON.stringify(bundleOf(b, stamps)))), 0)
    expect(a.me.displayName).toBe('New')
    const c = state({ me: { name: 'J', displayName: 'Mine' } })
    mergeBundle(c, refreshStamps(c, {}, 900, 'T'), parseBundle(JSON.parse(JSON.stringify(bundleOf(b, stamps)))), 0)
    expect(c.me.displayName).toBe('Mine')
  })
})

describe('mergeCodes', () => {
  it('a device with no code adopts the incoming one as owner other and rereads its names', () => {
    const s = state()
    const m = mergeCodes(s, { connectCode: rec('A', { name: 'ada' }) }, DID_B, true)
    expect(s.connectCode).toMatchObject({ code: code('A'), owner: 'other', fromDid: DID_B, name: 'ada' })
    expect(m).toMatchObject({ reread: true, first: true })
    expect(m.settle).toBeUndefined()
  })
  it('the same code: the newer updatedAt wins url + secret (owner other only when the url moved); names are not taken from the bundle', () => {
    const s = state({ connectCode: rec('A', { name: 'ada' }) })
    const url2 = `${ORIGIN}/?connect=${encodeURIComponent(DID_B)}&id=q`
    mergeCodes(s, { connectCode: rec('A', { url: url2, secret: 'Z'.repeat(43), updatedAt: 2000, name: 'other-name' }) }, DID_B, false)
    expect(s.connectCode).toMatchObject({ url: url2, secret: 'Z'.repeat(43), updatedAt: 2000, name: 'ada', owner: 'other', fromDid: DID_B })
    const t = state({ connectCode: rec('A') })
    mergeCodes(t, { connectCode: rec('A', { secret: 'Y'.repeat(43), updatedAt: 3000 }) }, DID_B, false)
    expect(t.connectCode.secret).toBe('Y'.repeat(43))
    expect(t.connectCode.owner).toBeUndefined()
    const u = state({ connectCode: rec('A', { updatedAt: 9000 }) })
    mergeCodes(u, { connectCode: rec('A', { url: url2, updatedAt: 2000 }) }, DID_B, false)
    expect(u.connectCode.url).not.toBe(url2)
  })
  it('two codes on the first sync: more names wins, tie goes to the older updatedAt, then the smaller code; the loser lands in otherCodes', () => {
    expect(winnerOf(rec('A', { name: 'a1', aliases: ['a2'] }), rec('B', { name: 'b1' })).code).toBe(code('A'))
    expect(winnerOf(rec('A', { name: 'a1', updatedAt: 5 }), rec('B', { name: 'b1', updatedAt: 3 })).code).toBe(code('B'))
    expect(winnerOf(rec('B', { name: 'x' }), rec('A', { name: 'y' })).code).toBe(code('A'))
    const mine = state({ connectCode: rec('A', { name: 'ada' }) })
    const m = mergeCodes(mine, { connectCode: rec('B', { name: 'bob', aliases: ['bo2'] }) }, DID_B, true)
    expect(m.settle).toMatchObject({ winnerIsMine: false })
    expect(mine.connectCode).toMatchObject({ code: code('B'), owner: 'other' })
    expect(mine.otherCodes.map((r) => r.code)).toEqual([code('A')])
    const win = state({ connectCode: rec('B', { name: 'bob', aliases: ['bo2'] }) })
    const w = mergeCodes(win, { connectCode: rec('A', { name: 'ada' }) }, DID_A, true)
    expect(w.settle).toMatchObject({ winnerIsMine: true })
    expect(win.connectCode.owner).toBeUndefined()
    expect(win.otherCodes[0]).toMatchObject({ code: code('A'), owner: 'other', fromDid: DID_A })
  })
  it('later syncs with different codes keep both; incoming otherCodes join, deduplicated, never the main code', () => {
    const s = state({ connectCode: rec('A'), otherCodes: [rec('C')] })
    const m = mergeCodes(s, { connectCode: rec('B'), otherCodes: [rec('C'), rec('A'), rec('D')] }, DID_B, false)
    expect(m.settle).toBeUndefined()
    expect(s.otherCodes.map((r) => r.code)).toEqual([code('C'), code('B'), code('D')])
    expect(s.connectCode.code).toBe(code('A'))
  })
  it('boot repair drops bad and duplicate otherCodes', () => {
    const s = state({ connectCode: rec('A'), otherCodes: [rec('A'), { x: 1 }, rec('B'), rec('B')] })
    expect(repairOtherCodes(s)).toBe(true)
    expect(s.otherCodes.map((r) => r.code)).toEqual([code('B')])
    expect(repairOtherCodes(s)).toBe(false)
    const t = state({ otherCodes: ['junk'] })
    expect(repairOtherCodes(t)).toBe(true)
    expect(t.otherCodes).toBeUndefined()
  })
})

describe('owner other: the keeper does nothing', () => {
  const other = rec('A', { owner: 'other', updatedAt: 1 })
  it('a record of another device is never due, whatever its url or age; a stale one shows no short link', () => {
    expect(registrationDue(other, 'https://elsewhere/?connect=zz', 10 ** 15)).toBe(false)
    expect(shortToShow(ORIGIN, other, 'x', 10 ** 15)).toBe(`${ORIGIN}/c/${code('A')}`)
    expect(shortToShow(ORIGIN, { ...other, stale: true }, 'x', 10 ** 15)).toBeNull()
  })
  it('ensure() sends nothing for it, and never mints on a 403', async () => {
    const calls = []
    const keeper = createConnectKeeper({
      origin: ORIGIN, now: () => 10 ** 15, fetch: async (u, i) => { calls.push([u, i]); return { status: 403, json: async () => ({ error: 'forbidden' }) } },
      load: () => other, store: () => { throw new Error('no write') },
    })
    expect(await keeper.ensure(`${ORIGIN}/?connect=${DID_A}`)).toBe(true)
    expect(calls).toEqual([])
  })
  it('a code that arrives during a mint wins: the mint answer is not stored (U19)', async () => {
    let held
    const stored = []
    const keeper = createConnectKeeper({
      origin: ORIGIN, now: () => 10 ** 15,
      fetch: async () => { held = rec('A', { owner: 'other' }); return { status: 201, json: async () => ({ code: code('M'), secret: 'M'.repeat(43) }) } },
      load: () => held, store: (r) => stored.push(r),
    })
    expect(await keeper.ensure(`${ORIGIN}/?connect=${DID_A}`)).toBe(false)
    expect(stored).toEqual([])
  })
  it('the reader keeps owner, fromDid, stale, touchedAt', () => {
    expect(readConnectRecord(rec('A', { owner: 'other', fromDid: DID_B, stale: true, touchedAt: 7 }))).toMatchObject({ owner: 'other', fromDid: DID_B, stale: true, touchedAt: 7 })
    expect(readConnectRecord(rec('A', { owner: 'bogus' })).owner).toBeUndefined()
  })
})

describe('which device the link opens on', () => {
  const pairs = [{ did: 'sync-1', askDid: DID_B }, { did: 'sync-2' }]
  it('this device, a linked device, or another one', () => {
    const url = (d) => `${ORIGIN}/?connect=${encodeURIComponent(d)}`
    expect(opensOn(url(DID_A), DID_A, pairs)).toEqual({ kind: 'this' })
    expect(opensOn(url(DID_B), DID_A, pairs)).toEqual({ kind: 'device', did: 'sync-1' })
    expect(opensOn(url('did:peer:2.unknown'), DID_A, pairs)).toEqual({ kind: 'other' })
    expect(opensOn('garbage', DID_A, pairs)).toEqual({ kind: 'other' })
  })
})
