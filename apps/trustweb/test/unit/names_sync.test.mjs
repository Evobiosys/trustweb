/**
 * The names a connect code holds (src/names_sync.ts, wave 6e, pin P1): the three intents and their bodies, the answers (including the
 * 409 reasons), what is learned as LOCKED, the shape checks on whatever the server answers, the throttled READ, and the shared 429 cooldown.
 * A fake fetch stands in for POST /name; the real service is wired by the orchestrator after the merge.
 */
import { ClaimError, createConnectKeeper } from '../../src/connect_code.ts'
import {
  NAMES_READ_GAP_MS, answerMatches, bodyOf, callNames, cleanName, createNamesSync, heldNames, isLocked, isSendableName, namesOf, readNamesAnswer, withNames,
} from '../../src/names_sync.ts'

const ORIGIN = 'https://app.trustintheweb.org'
const CODE = 'AbCdEfGhIjKlMnOpQrStUv'
const SECRET = 'S'.repeat(43)
const NOW = 1_800_000_000_000
const record = (over = {}) => ({ code: CODE, secret: SECRET, url: ORIGIN + '/?connect=x', updatedAt: NOW, ...over })
const NONE = { name: '', aliases: [], locked: [] }

function fake(answers) {
  const calls = []
  const f = async (url, init) => {
    const a = typeof answers === 'function' ? answers(calls.length + 1, init) : answers[Math.min(calls.length, answers.length - 1)]
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : null })
    if (a === 'offline') throw new TypeError('offline')
    return { status: a.status, ok: a.status < 300, json: async () => (a.body === undefined ? Promise.reject(new Error('no json')) : a.body) }
  }
  return { f, calls }
}
const ok200 = (name, aliases = [], extra = {}) => ({ status: 200, body: { name, aliases, ...extra } })
const err409 = (error) => ({ status: 409, body: { error, message: 'x', field: 'name' } })
const deps = (f, over = {}) => ({ origin: ORIGIN, fetch: f, now: () => NOW, ...over })

describe('the body of each intent', () => {
  it('READ: code and secret only', () => expect(JSON.parse(bodyOf(record(), { kind: 'read' }))).toEqual({ code: CODE, secret: SECRET }))
  it('CLAIM: the name; alias:true only for an alias', () => {
    expect(JSON.parse(bodyOf(record(), { kind: 'claim', name: 'ada', alias: false }))).toEqual({ code: CODE, secret: SECRET, name: 'ada' })
    expect(JSON.parse(bodyOf(record(), { kind: 'claim', name: 'ada2', alias: true }))).toEqual({ code: CODE, secret: SECRET, name: 'ada2', alias: true })
  })
  it('RELEASE: release:"<name>", never the legacy empty name', () => {
    expect(JSON.parse(bodyOf(record(), { kind: 'release', name: 'ada' }))).toEqual({ code: CODE, secret: SECRET, release: 'ada' })
  })
  it('exactly one intent per body: never a name together with a release', () => {
    for (const i of [{ kind: 'read' }, { kind: 'claim', name: 'ada', alias: true }, { kind: 'release', name: 'ada' }]) {
      const b = JSON.parse(bodyOf(record(), i))
      expect(Number('name' in b) + Number('release' in b)).toBeLessThanOrEqual(1)
    }
  })
})

describe('names that may be sent', () => {
  it('cleanName: no @, lowercase, trimmed', () => expect(cleanName(' @Ada.L ')).toBe('ada.l'))
  it('isSendableName: valid shape and not a code', () => {
    expect(isSendableName('ada')).toBe(true)
    for (const bad of ['', 'ab', 'Ada', 'ada-', 'a'.repeat(31), CODE, '@ada']) expect(isSendableName(bad)).toBe(false)
  })
})

describe('the answer, checked', () => {
  it('{name, aliases}', () => expect(readNamesAnswer({ name: 'ada', aliases: ['ada2'] }, NONE)).toEqual({ name: 'ada', aliases: ['ada2'], locked: [] }))
  it('a 6b answer with the name only still reads (no aliases)', () => expect(readNamesAnswer({ name: 'ada' }, NONE)).toEqual({ name: 'ada', aliases: [], locked: [] }))
  it('an empty primary is allowed', () => expect(readNamesAnswer({ name: '', aliases: [] }, NONE)).toEqual(NONE))
  it('the locked array of the answer is authoritative: only held names, and a name that is no longer reserved loses its lock', () => {
    expect(readNamesAnswer({ name: 'ada', aliases: ['ada2'], locked: ['ada2', 'gone'] }, NONE).locked).toEqual(['ada2'])
    expect(readNamesAnswer({ name: 'ada', aliases: [], locked: [] }, { ...NONE, locked: ['ada'] }).locked).toEqual([])
  })
  it('an older answer without `locked` keeps what a 409 name_locked taught, for the names still held', () => {
    expect(readNamesAnswer({ name: 'ada', aliases: [] }, { ...NONE, locked: ['ada'] }).locked).toEqual(['ada'])
    expect(readNamesAnswer({ name: 'bob', aliases: [] }, { ...NONE, locked: ['ada'] }).locked).toEqual([])
  })
  it.each([
    ['not an object', 5], ['null', null], ['name not a string', { name: 5 }], ['bad name', { name: 'A!' }], ['aliases not an array', { name: 'ada', aliases: 'x' }],
    ['three aliases', { name: 'ada', aliases: ['ada2', 'ada3', 'ada4'] }], ['a code as a name', { name: CODE }],
  ])('rejects %s', (_n, json) => expect(readNamesAnswer(json, NONE)).toBeNull())
  it('invalid and repeated aliases are dropped, the primary is not repeated among them', () => {
    expect(readNamesAnswer({ name: 'ada', aliases: ['ada', 'A!', 'ada2', 'ada2'] }, NONE).aliases).toEqual(['ada2'])
  })
  it('answerMatches: a claim holds, a release is gone, a read always', () => {
    const n = { name: 'ada', aliases: ['ada2'], locked: [] }
    expect(answerMatches({ kind: 'claim', name: 'ada', alias: false }, n)).toBe(true)
    expect(answerMatches({ kind: 'claim', name: 'ada2', alias: false }, n)).toBe(false)
    expect(answerMatches({ kind: 'claim', name: 'ada2', alias: true }, n)).toBe(true)
    expect(answerMatches({ kind: 'claim', name: 'bob', alias: true }, n)).toBe(false)
    expect(answerMatches({ kind: 'release', name: 'ada' }, n)).toBe(false)
    expect(answerMatches({ kind: 'release', name: 'bob' }, n)).toBe(true)
    expect(answerMatches({ kind: 'read' }, NONE)).toBe(true)
  })
})

describe('the record and its names', () => {
  it('namesOf / withNames round-trip, empty parts are removed, locked only for held names', () => {
    const r = withNames(record(), { name: 'ada', aliases: ['ada2'], locked: ['ada', 'gone'] })
    expect(r).toMatchObject({ name: 'ada', aliases: ['ada2'], lockedNames: ['ada'] })
    expect(namesOf(r)).toEqual({ name: 'ada', aliases: ['ada2'], locked: ['ada'] })
    const cleared = withNames(r, NONE)
    expect('name' in cleared || 'aliases' in cleared || 'lockedNames' in cleared).toBe(false)
    expect(namesOf(null)).toEqual(NONE)
  })
  it('heldNames lists the primary first; isLocked', () => {
    expect(heldNames({ name: 'ada', aliases: ['b1b'], locked: [] })).toEqual(['ada', 'b1b'])
    expect(heldNames({ name: '', aliases: ['b1b'], locked: [] })).toEqual(['b1b'])
    expect(isLocked({ name: 'ada', aliases: [], locked: ['ada'] }, 'ada')).toBe(true)
  })
})

describe('callNames: one POST /name per intent', () => {
  it('claims the primary and answers the names', async () => {
    const { f, calls } = fake([ok200('ada')])
    expect(await callNames(deps(f), record(), { kind: 'claim', name: 'ada', alias: false })).toEqual({ ok: true, names: { name: 'ada', aliases: [], locked: [] } })
    expect(calls[0].url).toBe(`${ORIGIN}/name`)
    expect(calls[0].body).toEqual({ code: CODE, secret: SECRET, name: 'ada' })
    expect(calls[0].init.referrerPolicy).toBe('no-referrer')
    expect(calls[0].init.credentials).toBe('omit')
  })
  it('adds an alias; with no primary the alias becomes the primary (the answer shows it)', async () => {
    expect((await callNames(deps(fake([ok200('ada', ['ada2'])]).f), record({ name: 'ada' }), { kind: 'claim', name: 'ada2', alias: true })).ok).toBe(true)
    expect((await callNames(deps(fake([ok200('ada2')]).f), record(), { kind: 'claim', name: 'ada2', alias: true })).ok).toBe(true)
  })
  it('releases the primary: the first alias is promoted (the answer says so)', async () => {
    const out = await callNames(deps(fake([ok200('ada2')]).f), record({ name: 'ada', aliases: ['ada2'] }), { kind: 'release', name: 'ada' })
    expect(out).toEqual({ ok: true, names: { name: 'ada2', aliases: [], locked: [] } })
  })
  it('READ: asks with no name and keeps what the server holds', async () => {
    const { f, calls } = fake([ok200('japossert', ['jakob'])])
    const out = await callNames(deps(f), record(), { kind: 'read' })
    expect(out).toEqual({ ok: true, names: { name: 'japossert', aliases: ['jakob'], locked: [] } })
    expect(calls[0].body).toEqual({ code: CODE, secret: SECRET })
  })
  it.each([
    [409, 'name_taken', ClaimError.Taken], [409, 'reserved', ClaimError.Reserved], [409, 'name_locked', ClaimError.NameLocked], [409, 'name_held', ClaimError.NameHeld], [409, 'too_many_names', ClaimError.TooManyNames],
    [409, undefined, ClaimError.Taken], [403, 'forbidden', ClaimError.Forgotten], [429, undefined, ClaimError.RateLimited], [429, 'name-cap', ClaimError.NameCap], [400, 'bad_request', ClaimError.BadName],
    [500, undefined, ClaimError.Server], [503, undefined, ClaimError.Server],
  ])('status %i %s is %s', async (status, error, expected) => {
    const out = await callNames(deps(fake([{ status, body: error ? { error } : {} }]).f), record(), { kind: 'claim', name: 'ada', alias: false })
    expect(out).toMatchObject({ ok: false, error: expected })
  })
  it('a bad name never reaches the network; offline is Network; a 200 that does not show the claim is Server; a 200 that is no answer is Server', async () => {
    const { f, calls } = fake([ok200('ada')])
    expect(await callNames(deps(f), record(), { kind: 'claim', name: 'Ada', alias: false })).toEqual({ ok: false, error: ClaimError.BadName })
    expect(await callNames(deps(f), record(), { kind: 'release', name: 'x' })).toEqual({ ok: false, error: ClaimError.BadName })
    expect(calls).toHaveLength(0)
    expect(await callNames(deps(fake(['offline']).f), record(), { kind: 'read' })).toEqual({ ok: false, error: ClaimError.Network })
    expect(await callNames(deps(fake([ok200('bob')]).f), record(), { kind: 'claim', name: 'ada', alias: false })).toEqual({ ok: false, error: ClaimError.Server })
    expect(await callNames(deps(fake([{ status: 200, body: { name: 5 } }]).f), record(), { kind: 'read' })).toEqual({ ok: false, error: ClaimError.Server })
  })
  it('sends nothing from a page that is not an app origin', async () => {
    const { f, calls } = fake([ok200('ada')])
    expect(await callNames(deps(f, { origin: 'http://127.0.0.1:8984' }), record(), { kind: 'read' })).toEqual({ ok: false, error: ClaimError.Network })
    expect(calls).toHaveLength(0)
  })
  it('a name_locked on a release teaches that name is locked; on a plain primary claim it teaches the held primary is', async () => {
    const held = record({ name: 'japossert', aliases: ['jakob'] })
    const rel = await callNames(deps(fake([err409('name_locked')]).f), held, { kind: 'release', name: 'jakob' })
    expect(rel).toMatchObject({ ok: false, error: ClaimError.NameLocked, names: { locked: ['jakob'] } })
    const claim = await callNames(deps(fake([err409('name_locked')]).f), held, { kind: 'claim', name: 'other', alias: false })
    expect(claim).toMatchObject({ ok: false, error: ClaimError.NameLocked, names: { locked: ['japossert'] } })
    const alias = await callNames(deps(fake([err409('name_locked')]).f), held, { kind: 'claim', name: 'other', alias: true })
    expect(alias.names).toBeUndefined()
  })
})

describe('createNamesSync: the phone\'s side', () => {
  function setup(answers, over = {}) {
    const box = { value: record(over.record ?? {}) }
    const { f, calls } = fake(answers)
    let now = NOW
    const keeper = createConnectKeeper({ ...deps(f, { now: () => now }), load: () => box.value, store: (r) => { box.value = r } })
    const sync = createNamesSync({ ...deps(f, { now: () => now }), load: () => box.value, store: (r) => { box.value = r }, keeper, ...(over.sync ?? {}) })
    return { sync, box, calls, keeper, tick: (ms) => { now += ms } }
  }
  it('refresh reads the names the operator granted and keeps them in the record; listeners hear once', async () => {
    const { sync, box } = setup([ok200('japossert', ['jakob'], { locked: ['japossert', 'jakob'] })])
    let heard = 0
    sync.onChange(() => { heard += 1 })
    expect((await sync.refresh()).ok).toBe(true)
    expect(box.value).toMatchObject({ name: 'japossert', aliases: ['jakob'] })
    expect(sync.names()).toEqual({ name: 'japossert', aliases: ['jakob'], locked: ['japossert', 'jakob'] })
    expect(box.value.lockedNames).toEqual(['japossert', 'jakob'])
    expect(heard).toBe(1)
    await sync.refresh(true)
    expect(heard).toBe(1) // nothing changed: nobody is told
  })
  it('refresh is throttled, and forced when asked', async () => {
    const { sync, calls, tick } = setup([ok200('ada')])
    await sync.refresh()
    await sync.refresh()
    expect(calls).toHaveLength(1)
    tick(NAMES_READ_GAP_MS)
    await sync.refresh()
    expect(calls).toHaveLength(2)
    await sync.refresh(true)
    expect(calls).toHaveLength(3)
  })
  it('a READ an older server answers with 400 changes nothing and says nothing', async () => {
    const { sync, box } = setup([{ status: 400, body: { error: 'bad_request' } }], { record: { name: 'ada' } })
    expect((await sync.refresh()).ok).toBe(false)
    expect(box.value.name).toBe('ada')
  })
  it('claim and release update the record; a refused locked release remembers the lock', async () => {
    const { sync, box } = setup([ok200('ada', ['ada2', 'ada3']), err409('name_locked'), ok200('ada', ['ada2'])], { record: { name: 'ada', aliases: ['ada2'] } })
    expect((await sync.claim('ada3', true)).ok).toBe(true)
    expect(box.value.aliases).toEqual(['ada2', 'ada3'])
    const refused = await sync.release('ada2')
    expect(refused).toMatchObject({ ok: false, error: ClaimError.NameLocked })
    expect(box.value.lockedNames).toEqual(['ada2'])
    expect(sync.names().locked).toEqual(['ada2'])
    expect((await sync.release('ada3')).ok).toBe(true)
    expect(box.value.aliases).toEqual(['ada2'])
    expect(box.value.lockedNames).toEqual(['ada2'])
  })
  it('with no code nothing is sent; with offer false nothing is sent', async () => {
    const none = setup([ok200('ada')])
    none.box.value = undefined
    expect(await none.sync.claim('ada', false)).toEqual({ ok: false, error: ClaimError.NoCode })
    const off = setup([ok200('ada')], { sync: { offer: false } })
    expect((await off.sync.refresh()).ok).toBe(false)
    expect(off.calls).toHaveLength(0)
  })
  it('a 429 starts the one cooldown the registration keeper shares, and no name call goes out meanwhile', async () => {
    const { sync, keeper, calls, tick } = setup([{ status: 429, body: {} }, ok200('ada')])
    expect(await sync.claim('ada', false)).toMatchObject({ ok: false, error: ClaimError.RateLimited })
    expect(keeper.coolingDown()).toBe(true)
    expect(await sync.claim('ada', false)).toMatchObject({ ok: false, error: ClaimError.RateLimited })
    expect(calls).toHaveLength(1)
    tick(60_000)
    expect((await sync.claim('ada', false)).ok).toBe(true)
  })
  it('an answer for a code that is no longer the stored one is not written into the new record', async () => {
    const { sync, box } = setup([ok200('ada')])
    const p = sync.claim('ada', false)
    box.value = record({ code: 'ZyXwVuTsRqPoNmLkJiHgFe' })
    await p
    expect(box.value.name).toBeUndefined()
  })
})

describe('MOVE (wave 15, devices)', () => {
  const from = { code: 'F'.repeat(22), secret: 'G'.repeat(43) }
  const intent = { kind: 'move', name: 'bob', from, as: 'primary' }
  it('the body names both codes and the target role', () => {
    expect(JSON.parse(bodyOf(record(), intent))).toEqual({ code: CODE, secret: SECRET, move: 'bob', from, as: 'primary' })
  })
  it('a 200 must show the name where asked; the 409 reasons map to their own errors', async () => {
    expect(answerMatches(intent, { name: 'bob', aliases: [], locked: [] })).toBe(true)
    expect(answerMatches({ ...intent, as: 'alias' }, { name: 'ada', aliases: ['bob'], locked: [] })).toBe(true)
    expect(answerMatches(intent, { name: 'ada', aliases: ['bob'], locked: [] })).toBe(false)
    for (const [error, want] of [['alias_cap', ClaimError.AliasCap], ['name_moved', ClaimError.NameMoved], ['not_held', ClaimError.NotHeld]]) {
      const { f } = fake([err409(error)])
      expect(await callNames(deps(f), record(), intent)).toEqual({ ok: false, error: want })
    }
    const { f, calls } = fake([ok200('bob', ['ada'])])
    expect(await callNames(deps(f), record(), intent)).toMatchObject({ ok: true, names: { name: 'bob', aliases: ['ada'] } })
    expect(calls[0].body.move).toBe('bob')
  })
  it('a name that is not sendable is refused before any request', async () => {
    const { f, calls } = fake([ok200('bob')])
    expect(await callNames(deps(f), record(), { ...intent, name: 'No!' })).toEqual({ ok: false, error: ClaimError.BadName })
    expect(calls).toHaveLength(0)
  })
})
