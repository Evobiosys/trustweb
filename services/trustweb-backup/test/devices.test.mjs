// Wave 15 (devices): update url, rotate secret, atomic name move between two codes of one account. No fixed port.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createConnectStore } from '../connect_store.mjs'
import { withServer } from './helpers.mjs'
import { BASE, DAY, LONG, LONG2, T0, claim, connect, grant, inTempDir, mint, readStore, who } from './connect_helpers.mjs'

const mv = (port, to, name, from, extra = {}) => claim(port, { code: to.code, secret: to.secret, move: name, from: { code: from.code, secret: from.secret }, ...extra })
const pair = async (port, names = ['ada']) => {
  const a = await mint(port)
  const b = await mint(port, LONG2)
  for (const [i, n] of names.entries()) await claim(port, { ...a, name: n, alias: i > 0 })
  return { a, b }
}

test('update: POST /connect {code, secret, url} replaces the url (an explicit "Open on this device"); a wrong secret is 403', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    assert.equal((await connect(srv.port, { ...a, url: LONG2 })).status, 200)
    assert.equal((await readStore(backupDir)).codes[a.code].url, LONG2)
    assert.equal((await connect(srv.port, { code: a.code, secret: 'B'.repeat(43), url: LONG })).status, 403)
  })
})

test('rotate: a NEW secret, the old one is dead everywhere, names stay; wrong secret 403; bad shapes 400', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    await claim(srv.port, { ...a, name: 'ada' })
    assert.equal((await connect(srv.port, { code: a.code, secret: 'B'.repeat(43), rotate: true })).status, 403)
    assert.equal((await connect(srv.port, { code: a.code, secret: a.secret, rotate: 'yes' })).json.field, 'rotate')
    const r = await connect(srv.port, { code: a.code, secret: a.secret, rotate: true })
    assert.equal(r.status, 200)
    assert.match(r.json.secret, /^[A-Za-z0-9_-]{43}$/)
    assert.notEqual(r.json.secret, a.secret)
    assert.equal((await claim(srv.port, { ...a })).status, 403, 'the old secret is dead')
    assert.equal((await claim(srv.port, { code: a.code, secret: r.json.secret })).json.name, 'ada')
    assert.equal((await who(srv.port, 'ada')).status, 302)
  })
})

test('move: an alias joins the target as alias; as:primary keeps the old primary as an alias; the source loses it; /who follows', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const { a, b } = await pair(srv.port, ['ada', 'bob'])
    await claim(srv.port, { ...b, name: 'cyd' })
    const r = await mv(srv.port, b, 'bob', a, { as: 'primary' })
    assert.equal(r.status, 200)
    assert.deepEqual([r.json.name, r.json.aliases], ['bob', ['cyd']])
    assert.deepEqual((await claim(srv.port, { ...a })).json, { name: 'ada', aliases: [], locked: [] })
    assert.equal((await who(srv.port, 'bob')).headers.location.endsWith(`/c/${b.code}`), true)
  })
})

test('move: refusals: code === from 400; either wrong secret 403 with one body; name not on from 409; alias cap 409; second move in 30 days 409 name_moved; later fine', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv }) => {
    const { a, b } = await pair(srv.port, ['ada', 'bob'])
    assert.equal((await mv(srv.port, a, 'bob', a)).status, 400)
    const bad1 = await mv(srv.port, { ...b, secret: 'B'.repeat(43) }, 'bob', a)
    const bad2 = await mv(srv.port, b, 'bob', { ...a, secret: 'B'.repeat(43) })
    assert.deepEqual([bad1.status, bad2.status], [403, 403])
    assert.equal(bad1.text, bad2.text)
    assert.equal((await mv(srv.port, b, 'zed', a)).json.error, 'not_held')
    assert.equal((await claim(srv.port, { code: b.code, secret: b.secret, move: 'bob', from: { code: a.code, secret: a.secret }, as: 'x' })).json.field, 'as')
    assert.equal((await mv(srv.port, b, 'bob', a)).status, 200)
    const again = await mv(srv.port, a, 'bob', b)
    assert.equal(again.status, 409)
    assert.deepEqual([again.json.error, again.json.until], ['name_moved', T0 + 30 * DAY])
    t += 30 * DAY + 1
    assert.equal((await mv(srv.port, a, 'bob', b)).status, 200)
  })
})

test('move: alias_cap when the target already holds three names; the cap of claims does not count a move; a locked name moves and stays locked', async () => {
  await withServer(0, { ...BASE, nameCap: 4 }, async ({ srv }) => {
    const { a, b } = await pair(srv.port, ['ada'])
    for (const [i, n] of ['bob', 'cyd', 'dee'].entries()) await claim(srv.port, { ...b, name: n, alias: i > 0 || false })
    assert.deepEqual((await mv(srv.port, b, 'ada', a)).json.error, 'alias_cap')
    assert.equal((await claim(srv.port, { ...a, name: 'eve', alias: true })).status, 429, 'four claims are in the window')
    assert.equal((await mv(srv.port, a, 'bob', b)).status, 200, 'a move needs no claim in the cap')
  })
  await withServer(0, BASE, async ({ srv }) => {
    const { a, b } = await pair(srv.port, [])
    assert.equal((await grant(srv, a.code, 'japossert')).status, 200)
    const r = await mv(srv.port, b, 'japossert', a)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json.locked, ['japossert'])
  })
})

test('move: a failed write puts BOTH codes back (names, map, move stamp); the next move works', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'connect.json')
    const store = await createConnectStore({ file, ttlMs: 365 * DAY, touchMs: DAY, max: 10, now: () => T0 })
    const s1 = 's'.repeat(43)
    const s2 = 't'.repeat(43)
    const a = (await store.mint('https://x.test/?connect=1', s1)).code
    const b = (await store.mint('https://x.test/?connect=2', s2)).code
    await store.claim(a, s1, { name: 'ada' })
    await store.claim(a, s1, { name: 'bob', alias: true })
    await fs.mkdir(`${file}.tmp`) // every write fails now
    await assert.rejects(store.move(b, s2, { name: 'bob', from: { code: a, secret: s1 }, as: 'alias' }))
    assert.deepEqual(await store.read(a, s1), { kind: 'named', name: 'ada', aliases: ['bob'], locked: [] })
    assert.deepEqual(await store.read(b, s2), { kind: 'named', name: '', aliases: [], locked: [] })
    assert.equal(store.codeOf('bob'), a)
    await fs.rmdir(`${file}.tmp`)
    assert.equal((await store.move(b, s2, { name: 'bob', from: { code: a, secret: s1 }, as: 'alias' })).kind, 'named', 'no move stamp was left behind')
    assert.equal(store.codeOf('bob'), b)
  })
})
