/** One username for all devices, the network part (src/sync_codes.ts) against a small fake of the service (connect.mjs rules: move, rotate, caps). */
import { careForCodes, makePrimary, moveHere, openHere, releaseName, rotateCodes, settleCodes } from '../../src/sync_codes.ts'
import { mergeCodes } from '../../src/sync_code.ts'

const ORIGIN = 'https://app.trustintheweb.org'
const DID_A = 'did:peer:2.' + 'Vz6MkA'.repeat(8)
const DID_B = 'did:peer:2.' + 'Vz6MkB'.repeat(8)
const code = (c) => c.repeat(22)
const rec = (c, over = {}) => ({ code: code(c), secret: c.repeat(43), url: `${ORIGIN}/?connect=${encodeURIComponent(DID_A)}&id=p`, updatedAt: 1000, ...over })
const NOW = 1_900_000_000_000

/** names: code -> ordered list; secrets: code -> secret. Same refusals as the service for what these tests touch. */
function fakeServer(names, secrets, down = false) {
  const calls = []
  const answer = (c) => ({ name: names[c][0] ?? '', aliases: names[c].slice(1), locked: [] })
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (down) throw new TypeError('offline')
    const res = (status, body) => ({ status, ok: status < 300, json: async () => body })
    if (url.includes('/c/')) return { status: names[url.split('/c/')[1]] ? 0 : 404, type: 'opaqueredirect' }
    const b = JSON.parse(init.body)
    if (secrets[b.code] !== b.secret) return res(403, { error: 'forbidden' })
    if (url.endsWith('/connect')) {
      if (b.rotate) { secrets[b.code] = 'N'.repeat(43); return res(200, { code: b.code, secret: secrets[b.code] }) }
      return res(200, { code: b.code })
    }
    if (b.move) {
      if (secrets[b.from.code] !== b.from.secret) return res(403, { error: 'forbidden' })
      if (!names[b.from.code].includes(b.move)) return res(409, { error: 'not_held' })
      if (names[b.code].length >= 3) return res(409, { error: 'alias_cap' })
      names[b.from.code] = names[b.from.code].filter((n) => n !== b.move)
      names[b.code] = b.as === 'primary' ? [b.move, ...names[b.code]] : [...names[b.code], b.move]
      return res(200, answer(b.code))
    }
    if (b.release) { names[b.code] = names[b.code].filter((n) => n !== b.release); return res(200, answer(b.code)) }
    if (b.name) { names[b.code] = [b.name, ...names[b.code].filter((n) => n !== b.name)]; return res(200, answer(b.code)) }
    return res(200, answer(b.code))
  }
  return { fetch, calls, names, secrets }
}
const mk = (srv, s) => ({ origin: ORIGIN, fetch: srv.fetch, now: () => NOW, state: () => s, save: () => { s.saves = (s.saves ?? 0) + 1 }, log: () => {} })
const state = (over = {}) => ({ v: 1, me: { name: 'J', displayName: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const held = (r) => [r.name, ...(r.aliases ?? [])].filter(Boolean)

describe('settle two codes on the first sync', () => {
  it('the loser device adopts the winner and its names MOVE into it; an emptied loser is dropped', async () => {
    const srv = fakeServer({ [code('A')]: ['ada'], [code('B')]: ['bob', 'bo2'] }, { [code('A')]: 'A'.repeat(43), [code('B')]: 'B'.repeat(43) })
    const s = state({ connectCode: rec('A', { name: 'ada' }) })
    const m = mergeCodes(s, { connectCode: rec('B', { name: 'bob', aliases: ['bo2'] }) }, DID_B, true)
    await settleCodes(mk(srv, s), m)
    expect(srv.names[code('B')]).toEqual(['bob', 'bo2', 'ada'])
    expect(srv.names[code('A')]).toEqual([])
    expect(s.connectCode).toMatchObject({ code: code('B'), owner: 'other', name: 'bob', aliases: ['bo2', 'ada'] })
    expect(s.otherCodes).toBeUndefined()
    expect(m.merged).toBe(false)
  })
  it('the winner device shows the one-time sheet; names beyond the cap stay on the loser, listed in otherCodes', async () => {
    const srv = fakeServer({ [code('A')]: ['bob', 'bo2'], [code('B')]: ['ada', 'ad2'] }, { [code('A')]: 'A'.repeat(43), [code('B')]: 'B'.repeat(43) })
    const s = state({ connectCode: rec('A', { name: 'bob', aliases: ['bo2'] }) })
    const m = mergeCodes(s, { connectCode: rec('B', { name: 'ada', aliases: ['ad2'] }) }, DID_B, true)
    expect(m.settle.winnerIsMine).toBe(true)
    await settleCodes(mk(srv, s), m)
    expect(srv.names[code('A')]).toEqual(['bob', 'bo2', 'ada'])
    expect(held(s.connectCode)).toEqual(['bob', 'bo2', 'ada'])
    expect(held(s.otherCodes[0])).toEqual(['ad2'])
    expect(m.merged).toBe(true)
    expect(s.saves).toBe(1)
  })
  it('the same code on both sides only rereads the names from the server', async () => {
    const srv = fakeServer({ [code('A')]: ['ada', 'ad2'] }, { [code('A')]: 'A'.repeat(43) })
    const s = state({ connectCode: rec('A', { name: 'ada' }) })
    const m = mergeCodes(s, { connectCode: rec('A', { name: 'wrong' }) }, DID_B, false)
    await settleCodes(mk(srv, s), m)
    expect(held(s.connectCode)).toEqual(['ada', 'ad2'])
  })
  it('a server that is down changes nothing and throws nothing', async () => {
    const srv = fakeServer({}, {}, true)
    const s = state({ connectCode: rec('A', { name: 'ada' }) })
    const m = mergeCodes(s, { connectCode: rec('B', { name: 'bob' }) }, DID_B, true)
    await expect(settleCodes(mk(srv, s), m)).resolves.toBeUndefined()
    expect(s.otherCodes).toHaveLength(1)
  })
})

describe('the actions of My username', () => {
  const setup = () => {
    const srv = fakeServer({ [code('A')]: ['ada'], [code('B')]: ['bob', 'bo2'] }, { [code('A')]: 'A'.repeat(43), [code('B')]: 'B'.repeat(43) })
    const s = state({ connectCode: rec('A', { name: 'ada' }), otherCodes: [rec('B', { name: 'bob', aliases: ['bo2'], fromDid: DID_B })] })
    return { srv, s, d: mk(srv, s) }
  }
  it('Move <name> here: an alias of the main code, the other code is read again', async () => {
    const { srv, s, d } = setup()
    expect((await moveHere(d, 'bo2', s.otherCodes[0])).ok).toBe(true)
    expect(held(s.connectCode)).toEqual(['ada', 'bo2'])
    expect(held(s.otherCodes[0])).toEqual(['bob'])
    expect(srv.names[code('B')]).toEqual(['bob'])
  })
  it('Make <name> the primary: a move as primary from another code (the old primary stays an alias), a swap inside the main code', async () => {
    const { s, d } = setup()
    await makePrimary(d, 'bob', s.otherCodes[0])
    expect(held(s.connectCode)).toEqual(['bob', 'ada'])
    await makePrimary(d, 'ada', null)
    expect(held(s.connectCode)).toEqual(['ada', 'bob'])
  })
  it('a move that would pass three names is refused and changes nothing', async () => {
    const { srv, s, d } = setup()
    srv.names[code('A')] = ['ada', 'a2', 'a3']
    s.connectCode = rec('A', { name: 'ada', aliases: ['a2', 'a3'] })
    const out = await moveHere(d, 'bob', s.otherCodes[0])
    expect(out).toMatchObject({ ok: false, error: 'alias-cap' })
    expect(held(s.connectCode)).toEqual(['ada', 'a2', 'a3'])
  })
  it('Release frees the name on the code that holds it', async () => {
    const { srv, s, d } = setup()
    await releaseName(d, 'bo2', s.otherCodes[0])
    expect(srv.names[code('B')]).toEqual(['bob'])
    expect(held(s.otherCodes[0])).toEqual(['bob'])
  })
  it('Open on this device updates the url, clears the other-device marks and saves; a stale record is NOT replaced by a new code', async () => {
    const { srv, s, d } = setup()
    s.connectCode = rec('A', { name: 'ada', owner: 'other', fromDid: DID_B })
    const url = `${ORIGIN}/?connect=${encodeURIComponent(DID_B)}&id=mine`
    expect(await openHere(d, url)).toBe(true)
    expect(s.connectCode).toMatchObject({ url, code: code('A') })
    expect(s.connectCode.owner).toBeUndefined()
    expect(s.connectCode.fromDid).toBeUndefined()
    expect(JSON.parse(srv.calls.at(-1).init.body)).toMatchObject({ code: code('A'), url })
    srv.secrets[code('A')] = 'Q'.repeat(43)
    s.connectCode = rec('A', { name: 'ada', owner: 'other' })
    const before = srv.calls.length
    expect(await openHere(d, url)).toBe(false)
    expect(srv.calls.length - before).toBe(1)
  })
})

describe('unlink takes the secret back; care keeps other records alive', () => {
  it('rotateCodes stores the new secret of every shared code with a fresh updatedAt', async () => {
    const srv = fakeServer({ [code('A')]: ['ada'], [code('B')]: [] }, { [code('A')]: 'A'.repeat(43), [code('B')]: 'B'.repeat(43) })
    const s = state({ connectCode: rec('A'), otherCodes: [rec('B')] })
    await rotateCodes(mk(srv, s))
    expect(s.connectCode).toMatchObject({ secret: 'N'.repeat(43), updatedAt: NOW })
    expect(s.otherCodes[0].secret).toBe('N'.repeat(43))
    expect(srv.secrets[code('A')]).toBe('N'.repeat(43))
  })
  it('an unlinked device is stale after its next read (the old secret is dead) and the keeper never mints for it', async () => {
    const srv = fakeServer({ [code('A')]: ['ada'] }, { [code('A')]: 'N'.repeat(43) })
    const s = state({ connectCode: rec('A', { owner: 'other', updatedAt: 1, touchedAt: 1 }) })
    await careForCodes(mk(srv, s))
    expect(s.connectCode.stale).toBe(true)
    const calls = srv.calls.length
    await careForCodes(mk(srv, s))
    expect(srv.calls.length).toBe(calls)
  })
  it('care touches an other-device record once per 30 days (GET /c/ + a names read), not before', async () => {
    const srv = fakeServer({ [code('A')]: ['ada'] }, { [code('A')]: 'A'.repeat(43) })
    const s = state({ connectCode: rec('A', { owner: 'other', updatedAt: 1, touchedAt: NOW - 1000 }) })
    await careForCodes(mk(srv, s))
    expect(srv.calls).toHaveLength(0)
    s.connectCode.touchedAt = NOW - 31 * 86_400_000
    await careForCodes(mk(srv, s))
    expect(srv.calls.map((c) => (c.url.includes('/c/') ? 'GET' : 'READ'))).toEqual(['GET', 'READ'])
    expect(s.connectCode.touchedAt).toBe(NOW)
    expect(s.connectCode.stale).toBeUndefined()
  })
})
