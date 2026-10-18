/** One username for all devices, the pure part (src/sync_code.ts + sync_core.ts + connect_code.ts keeper): bundle, parse, merge rules, owner flag, opens-on. */
import { bundleOf, mergeBundle, parseBundle, refreshStamps } from '../../src/sync_core.ts'
import { codesForBundle, mergeCodes, opensOn, parseCodeField, repairOtherCodes, validLongUrl, winnerOf, withoutCodes } from '../../src/sync_code.ts'
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
    expect(b.otherCodes).toEqual([rec('B', { relayed: true })]) // F16: B came from another device, the receiver cannot name it
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
    w.otherCodes = [rec('B', { fromDid: DID_B })]
    expect(parseBundle(w).otherCodes).toEqual([rec('B', { relayed: true })])
    expect(validLongUrl(`${ORIGIN}/?connect=x#frag`)).toBe(false)
    expect(parseCodeField(rec('A', { owner: 'other' })).owner).toBeUndefined()
  })
  it('the code never becomes a conflict: a changed code leaves syncReview alone', () => {
    const a = state({ connectCode: rec('A', { name: 'ada' }) })
    const b = state({ connectCode: rec('B', { name: 'bob' }) })
    const res = mergeBundle(a, refreshStamps(a, {}, 5, 'T'), parseBundle(wire(b)), 0)
    expect(res.conflicts).toEqual([])
  })
  it('the display name travels, the newer stamp wins and the difference is listed like a messenger link (F12)', () => {
    const a = state({ me: { name: 'J', displayName: 'Old' } })
    const b = state({ me: { name: 'J', displayName: 'New' } })
    const stamps = refreshStamps(b, {}, 500, 'T')
    const res = mergeBundle(a, refreshStamps(a, {}, 100, 'T'), parseBundle(JSON.parse(JSON.stringify(bundleOf(b, stamps)))), 0)
    expect(a.me.displayName).toBe('New')
    expect(res.conflicts).toMatchObject([{ kind: 'name', kept: 'theirs', mine: 'Old', theirs: 'New' }])
    const c = state({ me: { name: 'J', displayName: 'Mine' } })
    const kept = mergeBundle(c, refreshStamps(c, {}, 900, 'T'), parseBundle(JSON.parse(JSON.stringify(bundleOf(b, stamps)))), 0)
    expect(c.me.displayName).toBe('Mine')
    expect(kept.conflicts).toMatchObject([{ kind: 'name', kept: 'mine' }])
  })
  it('a display name without a timestamp on the other side is skipped; a pairing that does not share sends none (D3)', () => {
    const a = state({ me: { name: 'J', displayName: 'Old' } })
    const w = wire(state({ me: { name: 'J', displayName: 'New' } }))
    delete w.at['n:me']
    expect(mergeBundle(a, refreshStamps(a, {}, 100, 'T'), parseBundle(w), 0).conflicts).toEqual([])
    expect(a.me.displayName).toBe('Old')
    expect(bundleOf(state({ me: { name: 'J', displayName: 'New' } }), {}, false).displayName).toBeUndefined()
  })
})

describe('mergeCodes', () => {
  it('a device with no code adopts the incoming one as owner other and rereads its names', () => {
    const s = state()
    const m = mergeCodes(s, { connectCode: rec('A', { name: 'ada' }) }, DID_B)
    expect(s.connectCode).toMatchObject({ code: code('A'), owner: 'other', fromDid: DID_B, name: 'ada' })
    expect(m).toEqual({ reread: true })
  })
  it('the same code: the newer updatedAt wins the url, the newer secretAt the secret (two clocks); names are not taken from the bundle (F8, U9)', () => {
    const s = state({ connectCode: rec('A', { name: 'ada' }) })
    const url2 = `${ORIGIN}/?connect=${encodeURIComponent(DID_B)}&id=q`
    mergeCodes(s, { connectCode: rec('A', { url: url2, updatedAt: 2000, name: 'other-name' }) }, DID_B)
    expect(s.connectCode).toMatchObject({ url: url2, updatedAt: 2000, secret: 'A'.repeat(43), name: 'ada', owner: 'other', fromDid: DID_B })
    // a renewed secret alone changes the secret and ends a stale mark, nothing else
    const t = state({ connectCode: rec('A', { stale: true }) })
    mergeCodes(t, { connectCode: rec('A', { secret: 'Y'.repeat(43), secretAt: 3000, updatedAt: 1000 }) }, DID_B)
    expect(t.connectCode).toMatchObject({ secret: 'Y'.repeat(43), secretAt: 3000 })
    expect(t.connectCode.owner).toBeUndefined()
    expect(t.connectCode.stale).toBeUndefined()
    // a newer updatedAt without a newer secretAt keeps the secret (an older secret never wins by the url's clock)
    const u = state({ connectCode: rec('A', { secretAt: 5000, secret: 'K'.repeat(43) }) })
    mergeCodes(u, { connectCode: rec('A', { url: url2, updatedAt: 9000, secretAt: 1000 }) }, DID_B)
    expect(u.connectCode).toMatchObject({ url: url2, secret: 'K'.repeat(43) })
    const v = state({ connectCode: rec('A', { updatedAt: 9000 }) })
    mergeCodes(v, { connectCode: rec('A', { url: url2, updatedAt: 2000 }) }, DID_B)
    expect(v.connectCode.url).not.toBe(url2)
  })
  it('winnerOf: more names wins, a tie goes to the older updatedAt, then the smaller code', () => {
    expect(winnerOf(rec('A', { name: 'a1', aliases: ['a2'] }), rec('B', { name: 'b1' })).code).toBe(code('A'))
    expect(winnerOf(rec('A', { name: 'a1', updatedAt: 5 }), rec('B', { name: 'b1', updatedAt: 3 })).code).toBe(code('B'))
    expect(winnerOf(rec('B', { name: 'x' }), rec('A', { name: 'y' })).code).toBe(code('A'))
  })
  it('two different codes: both kept, this device stays on its own, nothing decided until the names are read (F1)', () => {
    const mine = state({ connectCode: rec('A', { name: 'ada' }) })
    const m = mergeCodes(mine, { connectCode: rec('B', { name: 'bob', aliases: ['bo2'] }) }, DID_B)
    expect(m).toEqual({ reread: true, ask: { mine: code('A'), theirs: code('B') } })
    expect(mine.connectCode.code).toBe(code('A'))
    expect(mine.otherCodes).toMatchObject([{ code: code('B'), owner: 'other', fromDid: DID_B }])
    // the same again at a later sync (postponed pick, D2): nothing is added twice, the question comes back
    expect(mergeCodes(mine, { connectCode: rec('B', { name: 'bob' }) }, DID_B).ask).toBeDefined()
    expect(mine.otherCodes).toHaveLength(1)
  })
  it('incoming otherCodes join, deduplicated, never the main code; a relayed one names no device (F16)', () => {
    const s = state({ connectCode: rec('A'), otherCodes: [rec('C')] })
    const m = mergeCodes(s, { connectCode: rec('B'), otherCodes: [rec('C'), rec('A'), rec('D'), rec('E', { relayed: true })] }, DID_B)
    expect(m.ask).toBeDefined()
    expect(s.otherCodes.map((r) => r.code)).toEqual([code('C'), code('B'), code('D'), code('E')])
    expect(s.otherCodes.map((r) => r.fromDid)).toEqual([undefined, DID_B, DID_B, ''])
    expect(s.otherCodes.some((r) => r.relayed)).toBe(false)
    expect(s.connectCode.code).toBe(code('A'))
  })
  it('a pairing that does not share contributes no code and no name (F2): withoutCodes', () => {
    const w = parseBundle(wire(state({ connectCode: rec('A', { name: 'ada' }), otherCodes: [rec('B')], me: { name: 'J', displayName: 'Zed' } })))
    expect(w.connectCode).toBeDefined()
    const cut = withoutCodes(w)
    expect([cut.connectCode, cut.otherCodes, cut.displayName]).toEqual([undefined, undefined, undefined])
    expect(cut.at).toEqual(w.at)
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
  it('the reader keeps owner, fromDid, stale, touchedAt, shared, secretAt', () => {
    expect(readConnectRecord(rec('A', { owner: 'other', fromDid: DID_B, stale: true, touchedAt: 7, shared: true, secretAt: 9 }))).toMatchObject({ owner: 'other', fromDid: DID_B, stale: true, touchedAt: 7, shared: true, secretAt: 9 })
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
