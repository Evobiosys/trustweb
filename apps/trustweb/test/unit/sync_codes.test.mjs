/** One username for all devices, the network part (src/sync_codes.ts) against a small fake of the service (connect.mjs rules: move, rotate, caps). */
import { careForCodes, dropCode, makePrimary, moveHere, openHere, pickCode, releaseName, rotateCodes, settleCodes } from '../../src/sync_codes.ts'
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
  const moved = new Set() // a name moves once in 30 days
  const touched = []
  const key = (n) => n.replace(/[01]/g, 'o')
  const answer = (c) => ({ name: names[c][0] ?? '', aliases: names[c].slice(1), locked: [] })
  const fetch = async (url, init) => {
    calls.push({ url, init })
    if (down) throw new TypeError('offline')
    const res = (status, body) => ({ status, ok: status < 300, json: async () => body })
    if (url.includes('/c/')) { touched.push(url.split('/c/')[1]); return { status: names[url.split('/c/')[1]] ? 302 : 404, type: 'opaqueredirect' } }
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
      if (moved.has(b.move)) return res(409, { error: 'name_moved' })
      if (Object.entries(names).some(([c, list]) => c !== b.code && c !== b.from.code && list.some((n) => key(n) === key(b.move)))) return res(409, { error: 'name_taken' })
      moved.add(b.move)
      names[b.from.code] = names[b.from.code].filter((n) => n !== b.move)
      names[b.code] = b.as === 'primary' ? [b.move, ...names[b.code]] : [...names[b.code], b.move]
      return res(200, answer(b.code))
    }
    if (b.release) { names[b.code] = names[b.code].filter((n) => n !== b.release); return res(200, answer(b.code)) }
    if (b.name) { names[b.code] = [b.name, ...names[b.code].filter((n) => n !== b.name)]; return res(200, answer(b.code)) }
    return res(200, answer(b.code))
  }
  return { fetch, calls, names, secrets, touched }
}
const mk = (srv, s) => ({ origin: ORIGIN, fetch: srv.fetch, now: () => NOW, state: () => s, save: () => { s.saves = (s.saves ?? 0) + 1 }, log: () => {} })
const state = (over = {}) => ({ v: 1, me: { name: 'J', displayName: 'J' }, people: [], peers: [], inventory: [], log: [], meetings: [], ...over })
const held = (r) => [r.name, ...(r.aliases ?? [])].filter(Boolean)

const secrets = () => ({ [code('A')]: 'A'.repeat(43), [code('B')]: 'B'.repeat(43) })
/** Merges B's record into a device that holds A, then settles: the state is the device's. */
async function meet(namesA, namesB, { mineOver = {}, theirsOver = {}, bundleNames = namesB, down = false } = {}) {
  const srv = fakeServer({ [code('A')]: namesA, [code('B')]: namesB }, secrets(), down)
  const s = state({ connectCode: rec('A', { name: namesA[0], aliases: namesA.slice(1), ...mineOver }) })
  // the bundle's own count of names is deliberately not the truth (F1)
  const m = mergeCodes(s, { connectCode: rec('B', { name: bundleNames[0], aliases: bundleNames.slice(1), ...theirsOver }) }, DID_B)
  await settleCodes(mk(srv, s), m)
  return { srv, s, m }
}

describe('two different codes meet (F1: read both from the server, the owner picks, nothing moves before)', () => {
  it('this device holds the winner: nothing moves, nothing is asked; the other device is asked', async () => {
    const { srv, s, m } = await meet(['bob', 'bo2'], ['ada'])
    expect(m.choice).toBeUndefined()
    expect(srv.names).toEqual({ [code('A')]: ['bob', 'bo2'], [code('B')]: ['ada'] })
    expect(s.connectCode.code).toBe(code('A'))
    expect(s.otherCodes.map((r) => held(r))).toEqual([['ada']])
  })
  it('this device would lose: the choice carries the names the SERVER holds (not the bundle count); nothing has moved', async () => {
    const { srv, s, m } = await meet(['ada'], ['bob', 'bo2'], { bundleNames: ['bob'] })
    expect(held(m.choice.mine)).toEqual(['ada'])
    expect(held(m.choice.theirs)).toEqual(['bob', 'bo2'])
    expect(srv.names).toEqual({ [code('A')]: ['ada'], [code('B')]: ['bob', 'bo2'] })
    expect(s.connectCode.code).toBe(code('A'))
    expect(srv.calls.filter((c) => c.init?.body && JSON.parse(c.init.body).move)).toHaveLength(0)
  })
  it('a bundle that claims many names is no truth: the server holds none for it, so this device (more names) wins', async () => {
    const { m, s } = await meet(['ada', 'ad2'], [], { bundleNames: ['x1', 'x2', 'x3'] })
    expect(m.choice).toBeUndefined()
    expect(s.connectCode.code).toBe(code('A'))
  })
  it('keep theirs: my names move into it (as aliases), their code becomes the main one (owner other), mine stays listed, emptied (F9)', async () => {
    const { srv, s, m } = await meet(['ada'], ['bob', 'bo2'])
    await pickCode(mk(srv, s), m.choice, 'theirs')
    expect(srv.names).toEqual({ [code('A')]: [], [code('B')]: ['bob', 'bo2', 'ada'] })
    expect(s.connectCode).toMatchObject({ code: code('B'), owner: 'other', name: 'bob', aliases: ['bo2', 'ada'] })
    expect(s.otherCodes.map((r) => [r.code, held(r)])).toEqual([[code('A'), []]])
  })
  it('keep mine: their names move into mine; theirs stays listed, emptied', async () => {
    const { srv, s, m } = await meet(['ada'], ['bob', 'bo2'])
    await pickCode(mk(srv, s), m.choice, 'mine')
    expect(srv.names[code('A')]).toEqual(['ada', 'bob', 'bo2'])
    expect(s.connectCode.code).toBe(code('A'))
    expect(s.otherCodes.map((r) => [r.code, held(r)])).toEqual([[code('B'), []]])
    expect(s.saves).toBeGreaterThan(0)
  })
  it('names beyond the cap stay on the other code, listed in otherCodes', async () => {
    const { srv, s, m } = await meet(['bob', 'bo2'], ['ada', 'ad2'], { theirsOver: { updatedAt: 500 } })
    expect(m.choice).toBeDefined()
    await pickCode(mk(srv, s), m.choice, 'theirs')
    expect(held(s.connectCode)).toEqual(['ada', 'ad2', 'bob'])
    expect(held(s.otherCodes.find((r) => r.code === code('A')))).toEqual(['bo2'])
  })
  it('the loser holds no names: the winner just becomes the main code, no question', async () => {
    const { s, m } = await meet([], ['bob'])
    expect(m.choice).toBeUndefined()
    expect(s.connectCode).toMatchObject({ code: code('B'), owner: 'other' })
    expect(s.otherCodes.map((r) => r.code)).toEqual([code('A')])
  })
  it('offline: both codes stay split, nothing is decided; the next sync asks again (D2)', async () => {
    const { srv, s, m } = await meet(['ada'], ['bob', 'bo2'], { down: true })
    expect(m.choice).toBeUndefined()
    expect(s.connectCode.code).toBe(code('A'))
    expect(s.otherCodes).toHaveLength(1)
    srv.names[code('A')] = ['ada']
    const up = fakeServer({ [code('A')]: ['ada'], [code('B')]: ['bob', 'bo2'] }, secrets())
    const again = mergeCodes(s, { connectCode: rec('B', { name: 'bob' }) }, DID_B)
    await settleCodes(mk(up, s), again)
    expect(again.choice).toBeDefined()
  })
  it('the same code on both sides only rereads the names from the server', async () => {
    const srv = fakeServer({ [code('A')]: ['ada', 'ad2'] }, { [code('A')]: 'A'.repeat(43) })
    const s = state({ connectCode: rec('A', { name: 'ada' }) })
    const m = mergeCodes(s, { connectCode: rec('A', { name: 'wrong' }) }, DID_B)
    await settleCodes(mk(srv, s), m)
    expect(held(s.connectCode)).toEqual(['ada', 'ad2'])
  })
  it('Release on an old link that holds no name any more drops it from the list', () => {
    const s = state({ connectCode: rec('A'), otherCodes: [rec('B')] })
    dropCode(s, () => {}, code('B'))
    expect(s.otherCodes).toBeUndefined()
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
  it('rotateCodes renews ONLY the codes this device owns (a code of another device is left), stores secretAt (not updatedAt) and logs per result', async () => {
    const srv = fakeServer({ [code('A')]: ['ada'], [code('B')]: [] }, { [code('A')]: 'A'.repeat(43), [code('B')]: 'B'.repeat(43) })
    const s = state({ connectCode: rec('A'), otherCodes: [rec('B', { owner: 'other' })] })
    const lines = []
    await rotateCodes({ ...mk(srv, s), log: (l) => lines.push(l) })
    expect(s.connectCode).toMatchObject({ secret: 'N'.repeat(43), secretAt: NOW, updatedAt: 1000 })
    expect(s.otherCodes[0].secret).toBe('B'.repeat(43))
    expect(srv.secrets[code('A')]).toBe('N'.repeat(43))
    expect(srv.secrets[code('B')]).toBe('B'.repeat(43))
    expect(lines).toEqual(['The secret of a public link was renewed'])
    expect(s.pendingRenew).toBeUndefined()
  })
  it('a failed renewal stays pending and is retried by the next care run (F4)', async () => {
    const srv = fakeServer({ [code('A')]: ['ada'] }, { [code('A')]: 'A'.repeat(43) }, true)
    const s = state({ connectCode: rec('A') })
    const lines = []
    await rotateCodes({ ...mk(srv, s), log: (l) => lines.push(l) })
    expect(s.pendingRenew).toEqual([code('A')])
    expect(s.connectCode.secret).toBe('A'.repeat(43))
    expect(lines).toEqual(['Could not renew the secret of a public link; trying again later'])
    const up = fakeServer({ [code('A')]: ['ada'] }, { [code('A')]: 'A'.repeat(43) })
    await careForCodes(mk(up, s))
    expect(s.pendingRenew).toBeUndefined()
    expect(s.connectCode.secret).toBe('N'.repeat(43))
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
