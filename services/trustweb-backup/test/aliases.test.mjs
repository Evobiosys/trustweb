// Wave 6e names: aliases, reserved names, locked grants, the READ intent (contract 10.9). No fixed port (the servers listen on port 0).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAX_NAMES, answerFor, fieldsFor, namesOf, planClaim, planGrant, planRelease, planRemove } from '../connect_aliases.mjs'
import { isReserved, parseReservedList, reservedChecker } from '../connect_names.mjs'
import { nameIntent } from '../connect.mjs'
import { createConnectStore } from '../connect_store.mjs'
import { createConnectStore as createStore6b } from './fixtures/connect_store_6b.mjs'
import { call, withServer } from './helpers.mjs'
import { APP, BASE, DAY, ENV_RESERVED, LONG, LONG2, OTHER_SECRET, T0, admin, claim, connect, grant, inTempDir, mint, readStore, who } from './connect_helpers.mjs'

const S = 's'.repeat(43)
const CODE = (c) => c.repeat(22)
const reserved = reservedChecker(ENV_RESERVED)
const set = (...names) => ({ kind: 'set', names })
const NOOP = { kind: 'noop' }
const refused = (kind) => ({ kind })

// ---------------------------------------------------------------- pure rules

test('planClaim: new primary, replace (6b), alias, no-primary alias, idempotent re-claims', () => {
  const t = (held, name, alias = false, extra = {}) => planClaim({ held, name, alias, reserved, takenByOther: false, ...extra })
  assert.deepEqual(t([], 'ada'), set('ada'))
  assert.deepEqual(t(['ada'], 'grace'), set('grace'), 'a different primary REPLACES the old one (it is freed)')
  assert.deepEqual(t(['ada', 'a2'], 'grace'), set('grace', 'a2'), 'the aliases stay')
  assert.deepEqual(t(['ada'], 'a2', true), set('ada', 'a2'))
  assert.deepEqual(t([], 'solo', true), set('solo'), 'an alias with no primary becomes the primary')
  assert.deepEqual(t(['ada'], 'ada'), NOOP)
  assert.deepEqual(t(['ada'], 'ada', true), NOOP, 'the primary claimed as an alias: nothing to add')
  assert.deepEqual(t(['ada', 'a2'], 'a2', true), NOOP)
  assert.equal(MAX_NAMES, 3)
})

test('planClaim: promotion is a swap that keeps the count, so it never reaches the cap (C4)', () => {
  const t = (held, name) => planClaim({ held, name, alias: false, reserved, takenByOther: false })
  assert.deepEqual(t(['ada', 'a2'], 'a2'), set('a2', 'ada'))
  assert.deepEqual(t(['ada', 'a2', 'a3'], 'a3'), set('a3', 'ada', 'a2'))
  assert.equal(t(['ada', 'a2', 'a3'], 'a3').names.length, 3)
})

test('planClaim: the cap, and the order locked > reserved > taken > cap (C6)', () => {
  const full = ['ada', 'a2', 'a3']
  assert.deepEqual(planClaim({ held: full, name: 'a4', alias: true, reserved, takenByOther: false }), refused('too_many'))
  assert.deepEqual(planClaim({ held: full, name: 'a4', alias: false, reserved, takenByOther: false }), set('a4', 'a2', 'a3'), 'a primary replace keeps the count')
  assert.deepEqual(planClaim({ held: full, name: 'jakob', alias: true, reserved, takenByOther: true }), refused('reserved'), 'reserved is judged before taken')
  assert.deepEqual(planClaim({ held: full, name: 'a4', alias: true, reserved, takenByOther: true }), refused('taken'), 'taken before the cap')
  assert.deepEqual(planClaim({ held: ['japossert'], name: 'jakob', alias: false, reserved, takenByOther: true }), refused('locked'), 'locked before reserved and taken')
  assert.deepEqual(planClaim({ held: ['japossert'], name: 'grace', alias: false, reserved, takenByOther: false }), refused('locked'))
})

test('planClaim: locked names. Re-claiming one is idempotent; adding an alias beside one is fine; replacing or promoting past one is not', () => {
  const t = (held, name, alias = false) => planClaim({ held, name, alias, reserved, takenByOther: false })
  assert.deepEqual(t(['japossert'], 'japossert'), NOOP, 'idempotence comes BEFORE the locked check')
  assert.deepEqual(t(['japossert', 'jakob'], 'jakob', true), NOOP)
  assert.deepEqual(t(['japossert'], 'grace', true), set('japossert', 'grace'))
  assert.deepEqual(t(['japossert', 'grace'], 'grace'), refused('locked'), 'promoting an alias past a locked primary')
  assert.deepEqual(t(['bob', 'jakob'], 'jakob'), set('jakob', 'bob'), 'a locked ALIAS may be promoted: nothing is freed')
  assert.deepEqual(t(['jakob', 'bob'], 'bob'), refused('locked'))
  assert.deepEqual(t(['bob'], 'jakob'), refused('reserved'), 'not held: still reserved')
})

test('planRelease: frees one name, promotes the first alias, legacy null = the primary, a name not held is a no-op, locked names are refused', () => {
  const t = (held, name) => planRelease({ held, name, reserved })
  assert.deepEqual(t(['ada', 'a2', 'a3'], 'ada'), set('a2', 'a3'))
  assert.deepEqual(t(['ada', 'a2', 'a3'], 'a3'), set('ada', 'a2'))
  assert.deepEqual(t(['ada', 'a2'], null), set('a2'))
  assert.deepEqual(t(['ada'], null), set())
  assert.deepEqual(t([], null), NOOP)
  assert.deepEqual(t(['ada'], 'other'), NOOP)
  assert.deepEqual(t(['japossert', 'grace'], 'japossert'), refused('locked'))
  assert.deepEqual(t(['japossert', 'grace'], null), refused('locked'))
  assert.deepEqual(t(['japossert', 'grace'], 'grace'), set('japossert'))
  assert.deepEqual(t(['bob', 'jakob'], 'jakob'), refused('locked'))
})

test('planGrant (admin): demotes the old primary, adds an alias, swaps a held alias, idempotent, taken, cap', () => {
  const t = (held, name, alias = false, takenByOther = false) => planGrant({ held, name, alias, takenByOther })
  assert.deepEqual(t([], 'japossert'), set('japossert'))
  assert.deepEqual(t(['ada'], 'japossert'), set('japossert', 'ada'), 'the old primary becomes an alias')
  assert.deepEqual(t(['ada'], 'jakob', true), set('ada', 'jakob'))
  assert.deepEqual(t([], 'jakob', true), set('jakob'))
  assert.deepEqual(t(['ada', 'a2'], 'a2'), set('a2', 'ada'))
  assert.deepEqual(t(['ada'], 'ada'), NOOP)
  assert.deepEqual(t(['ada', 'a2'], 'a2', true), NOOP)
  assert.deepEqual(t(['ada'], 'x1x', false, true), refused('taken'))
  assert.deepEqual(t(['a', 'b', 'c'], 'new', false), refused('too_many'), 'no room to demote the primary')
  assert.deepEqual(t(['a', 'b', 'c'], 'new', true), refused('too_many'))
  assert.deepEqual(t(['a', 'b', 'c'], 'c'), set('c', 'a', 'b'), 'a swap needs no room')
})

test('planRemove (admin): removes any held name, locked or not; promotes; not held is refused', () => {
  assert.deepEqual(planRemove({ held: ['japossert', 'grace'], name: 'japossert' }), set('grace'))
  assert.deepEqual(planRemove({ held: ['ada', 'a2'], name: 'a2' }), set('ada'))
  assert.deepEqual(planRemove({ held: ['ada'], name: 'zzz' }), refused('not_held'))
  assert.deepEqual(planRemove({ held: [], name: 'zzz' }), refused('not_held'))
})

test('entry helpers: namesOf / fieldsFor / answerFor (aliases are omitted when empty)', () => {
  assert.deepEqual(namesOf({ name: 'a', aliases: ['b', 'c'] }), ['a', 'b', 'c'])
  assert.deepEqual(namesOf({}), [])
  assert.deepEqual(namesOf({ aliases: ['x'] }), ['x'])
  assert.deepEqual(fieldsFor([]), {})
  assert.deepEqual(fieldsFor(['a']), { name: 'a' })
  assert.deepEqual(fieldsFor(['a', 'b']), { name: 'a', aliases: ['b'] })
  assert.deepEqual(answerFor([]), { name: '', aliases: [], locked: [] })
  assert.deepEqual(answerFor(['a', 'b']), { name: 'a', aliases: ['b'], locked: [] })
  assert.deepEqual(answerFor(['a', 'jakob', 'b', 'admin'], reserved), { name: 'a', aliases: ['jakob', 'b', 'admin'], locked: ['jakob', 'admin'] }, 'locked = the held names that are reserved, in held order')
})

// ---------------------------------------------------------------- reserved names

test('reservedChecker: built-in UNION env, compared after "." "_" "-" are removed; the built-in isReserved is unchanged', () => {
  for (const name of ['japossert', 'ja-possert', 'ja.po_ssert', 'jakob', 'ja-kob', 'j.a.k.o.b', 'admin', 'ad-min', 'no-reply', 'trust_web']) assert.equal(reserved(name), true, name)
  for (const name of ['jakobs', 'jak', 'possert', 'grace', 'ada']) assert.equal(reserved(name), false, name)
  assert.equal(isReserved('jakob'), false, 'the built-in list alone still does not hold jakob')
  assert.equal(reservedChecker()('jakob'), false)
  assert.equal(reservedChecker(['  JaKob  ', ''])('ja-kob'), true, 'entries are lowercased and trimmed')
  assert.deepEqual(parseReservedList(' JaPossert , jakob,, '), ['japossert', 'jakob'])
  assert.deepEqual(parseReservedList(undefined), [])
  assert.deepEqual(parseReservedList(''), [])
})

// ---------------------------------------------------------------- the intent of a POST /name body

test('nameIntent: exactly one intent; every mix is a 400 naming the field', () => {
  assert.deepEqual(nameIntent({}), { intent: 'read' })
  assert.deepEqual(nameIntent({ name: 'ada' }), { intent: 'claim', name: 'ada', alias: false })
  assert.deepEqual(nameIntent({ name: 'ada', alias: false }), { intent: 'claim', name: 'ada', alias: false })
  assert.deepEqual(nameIntent({ name: 'ada', alias: true }), { intent: 'claim', name: 'ada', alias: true })
  assert.deepEqual(nameIntent({ release: 'ada' }), { intent: 'release', name: 'ada' })
  assert.deepEqual(nameIntent({ name: '' }), { intent: 'release', name: null }, 'the legacy release of the primary')
  assert.deepEqual(nameIntent({ name: '', alias: false }), { intent: 'release', name: null })
  assert.deepEqual(nameIntent({ name: '', alias: true }), { field: 'alias' })
  assert.deepEqual(nameIntent({ alias: true }), { field: 'alias' }, 'alias alone is not a READ')
  assert.deepEqual(nameIntent({ alias: false }), { field: 'alias' })
  assert.deepEqual(nameIntent({ name: 'ada', alias: 'yes' }), { field: 'alias' })
  assert.deepEqual(nameIntent({ name: 'ada', alias: null }), { field: 'alias' })
  assert.deepEqual(nameIntent({ name: 'ada', release: 'ada' }), { field: 'release' })
  assert.deepEqual(nameIntent({ name: '', release: 'ada' }), { field: 'release' })
  assert.deepEqual(nameIntent({ release: 'ada', alias: true }), { field: 'alias' })
  assert.deepEqual(nameIntent({ release: '' }), { field: 'release' }, 'release needs a name that has the shape of one')
  assert.deepEqual(nameIntent({ release: 'Ada' }), { field: 'release' })
  assert.deepEqual(nameIntent({ release: null }), { field: 'release' })
  assert.deepEqual(nameIntent({ release: 5 }), { field: 'release' })
  for (const name of ['Ada', '@ada', 'ab', 5, null, [], {}, true]) assert.deepEqual(nameIntent({ name }), { field: 'name' }, String(name))
  assert.deepEqual(nameIntent({ name: 'admin' }), { intent: 'claim', name: 'admin', alias: false }, 'reserved is not a SHAPE error any more')
})

// ---------------------------------------------------------------- over HTTP: aliases

test('aliases: add up to two, READ shows them, /who/ resolves every name, a third alias is 409 too_many_names, the file keeps `name` + `aliases`', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    assert.deepEqual((await claim(srv.port, { name: 'ada', ...a })).json, { name: 'ada', aliases: [], locked: [] })
    assert.deepEqual((await claim(srv.port, { name: 'ada.two', alias: true, ...a })).json, { name: 'ada', aliases: ['ada.two'], locked: [] })
    assert.deepEqual((await claim(srv.port, { name: 'ada.three', alias: true, ...a })).json, { name: 'ada', aliases: ['ada.two', 'ada.three'], locked: [] })
    const over = await claim(srv.port, { name: 'ada.four', alias: true, ...a })
    assert.equal(over.status, 409)
    assert.deepEqual(over.json, { error: 'too_many_names', message: 'A code can hold up to 3 names.', field: 'name' })
    assert.deepEqual((await claim(srv.port, a)).json, { name: 'ada', aliases: ['ada.two', 'ada.three'], locked: [] }, 'READ')
    for (const name of ['ada', 'ada.two', 'ada.three']) assert.equal((await who(srv.port, name)).headers.location, `https://${APP}/c/${a.code}`, name)
    assert.equal((await who(srv.port, 'ada.four')).status, 404)
    const stored = (await readStore(backupDir)).codes[a.code]
    assert.equal(stored.name, 'ada')
    assert.deepEqual(stored.aliases, ['ada.two', 'ada.three'])
  })
})

test('aliases: an alias with no primary becomes the primary; re-claiming a held name is 200 and changes nothing (not even the last-use time)', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    assert.deepEqual((await claim(srv.port, { name: 'solo', alias: true, ...a })).json, { name: 'solo', aliases: [], locked: [] })
    assert.deepEqual((await claim(srv.port, { name: 'two2', alias: true, ...a })).json, { name: 'solo', aliases: ['two2'], locked: [] })
    const before = (await readStore(backupDir)).codes[a.code]
    t += DAY / 2
    assert.equal((await claim(srv.port, { name: 'solo', ...a })).status, 200)
    assert.equal((await claim(srv.port, { name: 'two2', alias: true, ...a })).status, 200)
    assert.equal((await claim(srv.port, { name: 'solo', alias: true, ...a })).status, 200)
    assert.deepEqual((await readStore(backupDir)).codes[a.code], before, 'a no-op writes nothing')
  })
})

test('aliases: a different primary REPLACES the old one and frees it (6b); the aliases stay; promoting an alias swaps', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, LONG2)
    await claim(srv.port, { name: 'ada', ...a })
    await claim(srv.port, { name: 'ada.two', alias: true, ...a })
    assert.deepEqual((await claim(srv.port, { name: 'grace', ...a })).json, { name: 'grace', aliases: ['ada.two'], locked: [] })
    assert.equal((await who(srv.port, 'ada')).status, 404, 'the replaced primary is free at once')
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 200)
    assert.deepEqual((await claim(srv.port, { name: 'ada.two', ...a })).json, { name: 'ada.two', aliases: ['grace'], locked: [] }, 'PROMOTE: the alias becomes the primary, the old primary an alias')
    await claim(srv.port, { name: 'ada.three', alias: true, ...a })
    assert.deepEqual((await claim(srv.port, { name: 'ada.three', ...a })).json, { name: 'ada.three', aliases: ['ada.two', 'grace'], locked: [] }, 'a full code can still promote (the count stays 3)')
  })
})

test('aliases: release frees one name; the primary release promotes the first alias; the legacy {name: ""} does the same; a name not held is a 200 no-op', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    for (const [name, alias] of [['ada', false], ['ada.two', true], ['ada.three', true]]) await claim(srv.port, { name, alias, ...a })
    assert.deepEqual((await claim(srv.port, { release: 'ada.three', ...a })).json, { name: 'ada', aliases: ['ada.two'], locked: [] })
    assert.equal((await who(srv.port, 'ada.three')).status, 404)
    assert.deepEqual((await claim(srv.port, { release: 'ada', ...a })).json, { name: 'ada.two', aliases: [], locked: [] }, 'the first alias is promoted')
    assert.equal((await who(srv.port, 'ada')).status, 404)
    assert.equal((await who(srv.port, 'ada.two')).status, 302)
    assert.deepEqual((await claim(srv.port, { release: 'nobody', ...a })).json, { name: 'ada.two', aliases: [], locked: [] }, 'not held: 200, unchanged')
    await claim(srv.port, { name: 'bak.up', alias: true, ...a })
    assert.deepEqual((await claim(srv.port, { name: '', ...a })).json, { name: 'bak.up', aliases: [], locked: [] }, 'legacy release of the primary promotes')
    assert.deepEqual((await readStore(backupDir)).codes[a.code].aliases, undefined, 'an empty alias list is not written')
    assert.deepEqual((await claim(srv.port, { name: '', ...a })).json, { name: '', aliases: [], locked: [] })
    assert.deepEqual((await claim(srv.port, { name: '', ...a })).json, { name: '', aliases: [], locked: [] }, 'idempotent')
    assert.equal((await readStore(backupDir)).codes[a.code].name, undefined)
  })
})

test('aliases: a name held by another code is name_taken as primary and as alias, whichever role the holder has; a release frees it', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, LONG2)
    await claim(srv.port, { name: 'ada', ...a })
    await claim(srv.port, { name: 'ada.two', alias: true, ...a })
    for (const alias of [false, true]) for (const name of ['ada', 'ada.two']) assert.equal((await claim(srv.port, { name, alias, ...b })).status, 409, `${name} alias=${alias}`)
    assert.deepEqual((await claim(srv.port, { name: 'ada.two', ...b })).json.error, 'name_taken')
    await claim(srv.port, { release: 'ada.two', ...a })
    assert.deepEqual((await claim(srv.port, { name: 'ada.two', alias: true, ...b })).json, { name: 'ada.two', aliases: [], locked: [] })
  })
})

test('aliases: every shape error is a 400 naming the field, BEFORE the secret is looked at', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const field = async (body) => {
      const r = await claim(srv.port, body)
      assert.equal(r.status, 400, JSON.stringify(body))
      return r.json.field
    }
    assert.equal(await field({ name: 'ada', alias: 'yes', ...a }), 'alias')
    assert.equal(await field({ alias: true, ...a }), 'alias')
    assert.equal(await field({ name: '', alias: true, ...a }), 'alias')
    assert.equal(await field({ release: 'ada', alias: true, ...a }), 'alias')
    assert.equal(await field({ name: 'ada', release: 'ada', ...a }), 'release')
    assert.equal(await field({ release: 'Ada', ...a }), 'release')
    assert.equal(await field({ release: '', ...a }), 'release')
    assert.equal(await field({ name: 'Ada', ...a }), 'name')
    assert.equal(await field({ name: 'ada', alias: true, code: 'short', secret: a.secret }), 'code')
    assert.equal(await field({ release: 'ada', code: a.code, secret: 'x' }), 'secret')
    assert.equal(await field({ code: a.code }), 'secret', 'a READ without a secret')
    assert.equal(await field({ name: 'Ada', code: a.code, secret: OTHER_SECRET }), 'name', 'a bad shape is a 400 even with a wrong secret')
  })
})

test('READ: returns the names and changes nothing (no write, no last-use refresh); a wrong secret and an unknown code are the same 403', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    await claim(srv.port, { name: 'ada', ...a })
    const file = path.join(backupDir, 'connect.json')
    const before = await fs.readFile(file, 'utf8')
    const mtime = (await fs.stat(file)).mtimeMs
    t += 300 * DAY
    const read = await claim(srv.port, a)
    assert.deepEqual(read.json, { name: 'ada', aliases: [], locked: [] })
    assert.equal(await fs.readFile(file, 'utf8'), before)
    assert.equal((await fs.stat(file)).mtimeMs, mtime)
    const wrong = await claim(srv.port, { code: a.code, secret: OTHER_SECRET })
    const unknown = await claim(srv.port, { code: 'A'.repeat(22), secret: a.secret })
    assert.equal(wrong.status, 403)
    assert.equal(unknown.text, wrong.text)
    assert.deepEqual(wrong.headers['content-type'], unknown.headers['content-type'])
  })
})

// ---------------------------------------------------------------- reserved and locked over HTTP

test('RESERVED: the env list and the built-in list refuse with 409 reserved (also squashed), as primary and as alias; a name the code holds is exempt', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    for (const name of ['japossert', 'jakob', 'ja-kob', 'ja.po_ssert', 'admin', 'no-reply']) {
      for (const alias of [false, true]) {
        const r = await claim(srv.port, { name, alias, ...a })
        assert.equal(r.status, 409, `${name} ${alias}`)
        assert.deepEqual(r.json, { error: 'reserved', message: 'That name is reserved.', field: 'name' })
      }
    }
    assert.equal((await claim(srv.port, { name: 'jakobs', ...a })).status, 200, 'only the exact squashed name is reserved')
  })
})

test('NO ORACLE: for a wrong secret a reserved name, a taken name and a free name answer with the same bytes (403); with the secret they differ', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, LONG2)
    await claim(srv.port, { name: 'taken.one', ...a })
    const wrong = { code: b.code, secret: OTHER_SECRET }
    const answers = []
    for (const name of ['jakob', 'taken.one', 'free.one']) answers.push(await claim(srv.port, { name, ...wrong }))
    assert.ok(answers.every((r) => r.status === 403))
    assert.equal(new Set(answers.map((r) => r.text)).size, 1)
    assert.deepEqual(await Promise.all(['jakob', 'taken.one', 'free.one'].map(async (name) => (await claim(srv.port, { name, ...b })).status)), [409, 409, 200])
  })
})

test('LOCKED: a granted reserved name cannot be released or replaced by the app; re-claiming it is 200; an alias beside it is allowed and removable', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    assert.deepEqual((await grant(srv, a.code, 'japossert')).json, { name: 'japossert', aliases: [], locked: ['japossert'] })
    assert.equal((await who(srv.port, 'japossert')).status, 302)
    const locked = { error: 'name_locked', message: 'That name is reserved for you; ask to change it.', field: 'name' }
    const refusal = async (body) => {
      const r = await claim(srv.port, { ...body, ...a })
      assert.equal(r.status, 409, JSON.stringify(body))
      assert.deepEqual(r.json, locked)
    }
    await refusal({ name: 'grace' })
    await refusal({ release: 'japossert' })
    await refusal({ name: '' })
    assert.deepEqual((await claim(srv.port, { name: 'japossert', ...a })).json, { name: 'japossert', aliases: [], locked: ['japossert'] }, 'idempotent re-claim of a held reserved name')
    assert.deepEqual((await claim(srv.port, { name: 'grace', alias: true, ...a })).json, { name: 'japossert', aliases: ['grace'], locked: ['japossert'] })
    await refusal({ name: 'grace' }) // promoting past the locked primary
    assert.deepEqual((await claim(srv.port, { release: 'grace', ...a })).json, { name: 'japossert', aliases: [], locked: ['japossert'] })
    assert.deepEqual((await grant(srv, a.code, 'jakob', true)).json, { name: 'japossert', aliases: ['jakob'], locked: ['japossert', 'jakob'] })
    await refusal({ release: 'jakob' })
    assert.equal((await claim(srv.port, { name: 'jakob', alias: true, ...a })).status, 200)
    await refusal({ name: 'jakob' })
    assert.deepEqual((await claim(srv.port, a)).json, { name: 'japossert', aliases: ['jakob'], locked: ['japossert', 'jakob'] })
  })
})

test('LOCKED is told to the app: every 200 of POST /name and of the admin routes carries `locked`, the held names that are reserved (this is how the app draws a lock and hides Release)', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    assert.deepEqual((await claim(srv.port, a)).json, { name: '', aliases: [], locked: [] })
    await claim(srv.port, { name: 'ada', ...a })
    await claim(srv.port, { name: 'ada.two', alias: true, ...a })
    assert.deepEqual((await claim(srv.port, a)).json.locked, [], 'nothing granted: nothing locked')
    assert.deepEqual((await grant(srv, a.code, 'japossert')).json, { name: 'japossert', aliases: ['ada', 'ada.two'], locked: ['japossert'] }, 'the answer of the grant itself')
    assert.deepEqual((await claim(srv.port, a)).json, { name: 'japossert', aliases: ['ada', 'ada.two'], locked: ['japossert'] }, 'READ: the unlocked aliases are absent')
    assert.deepEqual((await claim(srv.port, { release: 'ada.two', ...a })).json.locked, ['japossert'], 'the 200 of a release carries it too')
    await grant(srv, a.code, 'jakob', true)
    assert.deepEqual((await claim(srv.port, a)).json, { name: 'japossert', aliases: ['ada', 'jakob'], locked: ['japossert', 'jakob'] })
    assert.deepEqual((await claim(srv.port, { name: 'ada', alias: true, ...a })).json.locked, ['japossert', 'jakob'], 'a no-op answer too')
    const del = await admin(srv, { method: 'DELETE', body: { code: a.code, name: 'japossert' } })
    assert.deepEqual(del.json, { name: 'ada', aliases: ['jakob'], locked: ['jakob'] })
    await admin(srv, { method: 'DELETE', body: { code: a.code, name: 'jakob' } })
    assert.deepEqual((await claim(srv.port, a)).json, { name: 'ada', aliases: [], locked: [] }, 'after the admin removed the grants nothing is locked')
  })
})

test('LOCKED: a locked ALIAS beside an unlocked primary can be promoted (nothing is freed) and is then locked in place', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const b = await mint(srv.port)
    await claim(srv.port, { name: 'bob', ...b })
    await grant(srv, b.code, 'jakob', true)
    assert.deepEqual((await claim(srv.port, { name: 'jakob', ...b })).json, { name: 'jakob', aliases: ['bob'], locked: ['jakob'] })
    assert.equal((await claim(srv.port, { name: 'bob', ...b })).status, 409, 'jakob is the primary now and locked')
    assert.deepEqual((await claim(srv.port, { release: 'bob', ...b })).json, { name: 'jakob', aliases: [], locked: ['jakob'] })
  })
})

test('LOCKED by a squatter: a name that was free in 6b ("jakob") and is held when RESERVED_NAMES starts counts as locked at once, and only the admin frees it', async () => {
  await inTempDir(async (dir) => {
    const old = await withServerKeep(dir, { reservedNames: [] })
    const squatter = old.a
    assert.equal((await claim(old.srv.port, { name: 'jakob', ...squatter })).status, 200)
    await old.srv.close()
    const { startServer } = await import('../server.mjs')
    const srv = await startServer({ dir: path.join(dir, 'backup'), allowedHosts: ['app.example.test', '127.0.0.1'], port: 0, log: () => undefined, ...BASE })
    try {
      assert.equal((await claim(srv.port, { name: 'grace', ...squatter })).status, 409)
      assert.equal((await claim(srv.port, { release: 'jakob', ...squatter })).json.error, 'name_locked')
    } finally {
      await srv.close()
    }
  })
})

async function withServerKeep(dir, extra) {
  const { startServer } = await import('../server.mjs')
  const srv = await startServer({ dir: path.join(dir, 'backup'), allowedHosts: ['app.example.test', '127.0.0.1'], port: 0, log: () => undefined, ...BASE, ...extra })
  const a = await mint(srv.port)
  return { srv, a }
}

// ---------------------------------------------------------------- lifetime

test('an expired code takes its aliases with it: /who/ is 404 for all, and another code can claim an alias of an expired but unswept code at once', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, LONG2)
    await claim(srv.port, { name: 'ada', ...a })
    await claim(srv.port, { name: 'ada.two', alias: true, ...a })
    t += 364 * DAY
    assert.equal((await claim(srv.port, b)).status, 200, 'b is alive (minted at T0 as well: refresh it)')
    assert.equal((await connect(srv.port, { ...b, url: LONG2 })).status, 200) // b stays alive
    t += 2 * DAY // a is past 365 days, b is not
    assert.equal((await who(srv.port, 'ada')).status, 404)
    assert.equal((await who(srv.port, 'ada.two')).status, 404)
    assert.deepEqual((await claim(srv.port, { name: 'ada.two', ...b })).json, { name: 'ada.two', aliases: [], locked: [] })
    assert.equal((await claim(srv.port, { name: 'ada', alias: true, ...b })).status, 200)
  })
})

test('concurrency: five parallel alias claims of one code leave exactly three names and two 409s; two codes racing for one alias give one 200', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    const results = await Promise.all(['n1x', 'n2x', 'n3x', 'n4x', 'n5x'].map((name) => claim(srv.port, { name, alias: true, ...a })))
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 200, 409, 409])
    const stored = (await readStore(backupDir)).codes[a.code]
    assert.equal(1 + stored.aliases.length, 3)
    const racers = [await mint(srv.port, LONG2), await mint(srv.port, LONG + '&r=3'), await mint(srv.port, LONG + '&r=4')]
    const race = await Promise.all(racers.map((c) => claim(srv.port, { name: 'raced', alias: true, ...c })))
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409, 409])
  })
})

// ---------------------------------------------------------------- the store: load rules, rollback, 6b compatibility

const entry = (extra = {}) => ({ h: 'a'.repeat(64), url: 'https://x.test/?connect=1', seen: T0, ...extra })
const writeFile = (file, codes) => fs.writeFile(file, JSON.stringify({ v: 1, codes }))
const openAt = (file, now = () => T0, extra = {}) => createConnectStore({ file, ttlMs: 365 * DAY, touchMs: DAY, max: 100, now, ...extra })

test('LOAD: an old file (names only) loads unchanged; aliases load; the file is rewritten without an empty aliases list', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'connect.json')
    await writeFile(file, { [CODE('a')]: entry({ name: 'ada' }), [CODE('b')]: entry({ name: 'bob', aliases: ['bob.two', 'bob.three'] }), [CODE('c')]: entry() })
    const store = await openAt(file)
    assert.equal(store.codeOf('ada'), CODE('a'))
    for (const n of ['bob', 'bob.two', 'bob.three']) assert.equal(store.codeOf(n), CODE('b'), n)
    assert.deepEqual(await store.read(CODE('b'), 'x'), { kind: 'forbidden' })
    const saved = JSON.parse(await fs.readFile(file, 'utf8')).codes
    assert.deepEqual(saved[CODE('a')], entry({ name: 'ada' }))
    assert.deepEqual(saved[CODE('b')], entry({ name: 'bob', aliases: ['bob.two', 'bob.three'] }))
    assert.deepEqual(saved[CODE('c')], entry())
  })
})

test('LOAD: the first holder keeps a name across names AND aliases of all codes; a bad or duplicate alias loses only itself; a lost primary promotes the first alias; more than 3 keep the first 3; reserved names stay', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'connect.json')
    await writeFile(file, {
      [CODE('a')]: entry({ name: 'dup.one', aliases: ['shared', 'Bad!', 'dup.one', 'keep.me'] }), // Bad! (shape) and the repeated primary lose only themselves
      [CODE('b')]: entry({ name: 'shared', aliases: ['b2b', 5, null, 'dup.one'] }), // shared is a's: b loses its PRIMARY and promotes b2b
      [CODE('c')]: entry({ name: 'ccc', aliases: ['c2c', 'c3c', 'c4c'] }), // four names: the first three stay
      [CODE('d')]: entry({ name: 'Nope', aliases: ['d2d'] }), // a bad primary: d2d is promoted
      [CODE('e')]: entry({ name: 'admin', aliases: ['jakob'] }), // reserved names survive a load (granted ones must)
      [CODE('f')]: entry({ aliases: 'notalist', name: 5 }),
    })
    const store = await openAt(file)
    const saved = JSON.parse(await fs.readFile(file, 'utf8')).codes
    assert.deepEqual([saved[CODE('a')].name, saved[CODE('a')].aliases], ['dup.one', ['shared', 'keep.me']])
    assert.deepEqual([saved[CODE('b')].name, saved[CODE('b')].aliases], ['b2b', undefined])
    assert.deepEqual([saved[CODE('c')].name, saved[CODE('c')].aliases], ['ccc', ['c2c', 'c3c']])
    assert.deepEqual([saved[CODE('d')].name, saved[CODE('d')].aliases], ['d2d', undefined])
    assert.deepEqual([saved[CODE('e')].name, saved[CODE('e')].aliases], ['admin', ['jakob']])
    assert.deepEqual([saved[CODE('f')].name, saved[CODE('f')].aliases], [undefined, undefined])
    assert.equal(store.codeOf('shared'), CODE('a'))
    assert.equal(store.codeOf('c4c'), null)
    assert.equal(store.size(), 6, 'no code is lost')
  })
})

test('LOAD: an expired entry listed first never takes a name or an alias from the live entry that holds it', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'connect.json')
    await writeFile(file, { [CODE('a')]: entry({ seen: T0 - 400 * DAY, name: 'old.one', aliases: ['both'] }), [CODE('b')]: entry({ name: 'both', aliases: ['old.one'] }) })
    const store = await openAt(file)
    assert.equal(store.codeOf('both'), CODE('b'))
    assert.equal(store.codeOf('old.one'), CODE('b'))
    assert.equal(store.size(), 1)
  })
})

test('STORE: claim / release / grant / remove results, the locked check uses the predicate it was given, and every change is one persisted write', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'connect.json')
    const store = await openAt(file, () => T0, { reserved })
    const made = await store.mint('https://x.test/?connect=1', S)
    const code = made.code
    assert.deepEqual(await store.claim(code, S, { name: 'ada' }), { kind: 'named', name: 'ada', aliases: [], locked: [] })
    assert.deepEqual(await store.claim(code, S, { name: 'ada.two', alias: true }), { kind: 'named', name: 'ada', aliases: ['ada.two'], locked: [] })
    assert.deepEqual(await store.claim(code, S, { name: 'jakob' }), { kind: 'reserved' })
    assert.deepEqual(await store.claim(code, 'x'.repeat(43), { name: 'jakob' }), { kind: 'forbidden' })
    assert.deepEqual(await store.grant(code, 'jakob'), { kind: 'named', name: 'jakob', aliases: ['ada', 'ada.two'], locked: ['jakob'] })
    assert.deepEqual(await store.claim(code, S, { name: 'ada' }), { kind: 'locked' })
    assert.deepEqual(await store.release(code, S, null), { kind: 'locked' })
    assert.deepEqual(await store.grant(code, 'more.names'), { kind: 'too_many' })
    assert.deepEqual(await store.grant('z'.repeat(22), 'x1x'), { kind: 'unknown' })
    assert.deepEqual(await store.remove(code, 'zzz'), { kind: 'not_held' })
    assert.deepEqual(await store.remove(code, 'jakob'), { kind: 'named', name: 'ada', aliases: ['ada.two'], locked: [] })
    assert.deepEqual(await store.remove('z'.repeat(22), 'ada'), { kind: 'unknown' })
    assert.deepEqual(store.holders((n) => n.startsWith('ada')), [{ name: 'ada', code }, { name: 'ada.two', code }])
    const saved = JSON.parse(await fs.readFile(file, 'utf8')).codes[code]
    assert.deepEqual([saved.name, saved.aliases], ['ada', ['ada.two']])
  })
})

test('ROLLBACK: a failed write restores the names (primary, aliases and the name map) and the last-use time', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, LONG2)
    await claim(srv.port, { name: 'ada', ...a })
    await claim(srv.port, { name: 'ada.two', alias: true, ...a })
    const file = path.join(backupDir, 'connect.json')
    const before = await readStore(backupDir)
    await fs.mkdir(`${file}.tmp`) // every write fails
    for (const body of [{ name: 'ada.three', alias: true }, { release: 'ada.two' }, { release: 'ada' }, { name: '' }, { name: 'grace' }, { name: 'ada.two' }]) {
      const r = await claim(srv.port, { ...body, ...a })
      assert.equal(r.status, 500, JSON.stringify(body))
      assert.equal(r.json.error, 'server_error')
    }
    assert.equal((await grant(srv, a.code, 'japossert')).status, 500)
    assert.deepEqual((await claim(srv.port, a)).json, { name: 'ada', aliases: ['ada.two'], locked: [] }, 'READ needs no write and sees the old names')
    assert.equal((await who(srv.port, 'ada')).status, 302)
    assert.equal((await who(srv.port, 'ada.two')).status, 302)
    for (const name of ['ada.three', 'grace', 'japossert']) assert.equal((await who(srv.port, name)).status, 404, name)
    assert.equal((await claim(srv.port, { name: 'ada.two', ...b })).status, 409, 'the restored alias still blocks the others')
    await fs.rmdir(`${file}.tmp`)
    assert.equal((await claim(srv.port, { name: 'grace', ...b })).status, 200)
    assert.deepEqual((await readStore(backupDir)).codes[a.code], before.codes[a.code])
  })
})

test('6b COMPATIBILITY: a connect.json written by the new code loads in the frozen 6b store: primaries resolve, aliases are ignored (they do not resolve after a rollback)', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'connect.json')
    const store = await openAt(file, () => T0, { reserved })
    const { code } = await store.mint('https://x.test/?connect=1', S)
    await store.claim(code, S, { name: 'ada' })
    await store.claim(code, S, { name: 'ada.two', alias: true })
    await store.grant(code, 'japossert')
    const copy = path.join(dir, '6b.json')
    await fs.copyFile(file, copy)
    const old = await createStore6b({ file: copy, ttlMs: 365 * DAY, touchMs: DAY, max: 100, now: () => T0 })
    assert.equal(old.recovered, false)
    assert.equal(old.codeOf('japossert'), code, 'the new primary resolves in 6b')
    assert.equal(old.codeOf('ada'), null, 'the demoted old primary is an alias now: 6b ignores it')
    assert.equal(old.codeOf('ada.two'), null)
    assert.equal(old.peek(code), 'https://x.test/?connect=1')
    assert.equal(old.size(), 1)
  })
})

// ---------------------------------------------------------------- source scan and wiring

test('NO LOGGING by construction (6e): the new modules have no logger, no console, no stream write; the store compares secrets only with timingSafeEqual', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const name of ['connect_aliases.mjs', 'admin.mjs']) {
    const text = (await fs.readFile(path.join(here, '..', name), 'utf8')).split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
    assert.doesNotMatch(text, /console\.|process\.std|\.log\?*\.?\(|\blog\b|\bwarn\b|\berr\.message\b/, name)
  }
  const admin = await fs.readFile(path.join(here, '..', 'admin.mjs'), 'utf8')
  assert.match(admin, /crypto\.timingSafeEqual\(sha256\(/)
  assert.doesNotMatch(admin.replace(/\/\/.*$/gm, ''), /token\)?\s*[!=]==|[!=]==\s*(?:cfg\.)?(?:admin)?[tT]oken/)
})

test('the old reserved-name behaviour stays where it must: a code-shaped or malformed name is still a 400, the 6b names still work through the new answer', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    assert.equal((await claim(srv.port, { name: 'a'.repeat(22), ...a })).status, 400)
    assert.deepEqual((await claim(srv.port, { name: 'grace', ...a })).json, { name: 'grace', aliases: [], locked: [] })
    const r = await call(srv.port, { url: '/who/grace', host: 'app.example.test' })
    assert.equal(r.status, 302)
  })
})
