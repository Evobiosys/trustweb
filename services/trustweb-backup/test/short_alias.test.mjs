// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Short alias routes: POST /s registers token -> did (secret of a connect code), GET /s/<token> redirects or answers JSON. No fixed port.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { call, withServer } from './helpers.mjs'
import { APP, BASE, JSON_H, OTHER_SECRET, mint, send } from './connect_helpers.mjs'

const TOKEN = 'abcdefghij'
const DID = 'did:peer:2.Vz6MkAlice'
const DID2 = 'did:peer:2.Vz6MkAliceNew'
const SUCC = { old: DID, new: DID2, at: 1_800_000_000_000, sig: 'sig-base64url' }
const post = (port, body, extra) => send(port, '/s', body, extra)
const get = (port, token, extra = {}) => call(port, { url: `/s/${token}`, ...extra })
const JSON_ACCEPT = { Accept: 'application/json' }

test('POST /s registers the alias; GET /s/<token> 302s to the app with ?alias=', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const r = await post(srv.port, { ...a, token: TOKEN, did: DID })
    assert.equal(r.status, 201)
    const g = await get(srv.port, TOKEN)
    assert.equal(g.status, 302)
    assert.equal(g.headers.location, `https://${APP}/?alias=${TOKEN}`)
    assert.equal(g.headers['x-robots-tag'], 'noindex, nofollow')
  })
})

test('GET with Accept: application/json answers {did, succession}', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    await post(srv.port, { ...a, token: TOKEN, did: DID })
    const plain = await get(srv.port, TOKEN, { headers: JSON_ACCEPT })
    assert.equal(plain.status, 200)
    assert.deepEqual(plain.json, { did: DID, succession: null })
    assert.equal((await post(srv.port, { ...a, token: TOKEN, did: DID2, succession: SUCC })).status, 200)
    assert.deepEqual((await get(srv.port, TOKEN, { headers: JSON_ACCEPT })).json, { did: DID2, succession: SUCC })
  })
})

test('POST /s: wrong secret 403, token of another code 403, bad token or did 400', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port)
    assert.equal((await post(srv.port, { code: a.code, secret: OTHER_SECRET, token: TOKEN, did: DID })).status, 403)
    assert.equal((await post(srv.port, { ...a, token: TOKEN, did: DID })).status, 201)
    const taken = await post(srv.port, { ...b, token: TOKEN, did: 'did:peer:2.Vz6MkMallory' })
    assert.equal(taken.status, 403, 'a token already held by another code is refused like a wrong secret')
    for (const token of ['', 'ABCDEFGHIJ', 'abcdefghi1', 'abcdefghijk', 5]) assert.equal((await post(srv.port, { ...a, token, did: DID })).status, 400, String(token))
    for (const did of ['', 5, 'x'.repeat(600)]) assert.equal((await post(srv.port, { ...a, token: 'bcdefghijk', did })).status, 400, String(did).slice(0, 8))
    assert.equal((await post(srv.port, { ...a, token: 'bcdefghijk', did: DID, succession: { old: 1 } })).status, 400)
    assert.equal((await get(srv.port, TOKEN)).status, 302, 'the first registration still stands')
  })
})

test('GET /s: unknown, bad shape and a foreign host answer the same 404', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    await post(srv.port, { ...a, token: TOKEN, did: DID })
    const unknown = await get(srv.port, 'zzzzzzzzzz')
    const bad = await get(srv.port, 'No%20Token!')
    const json = await get(srv.port, 'zzzzzzzzzz', { headers: JSON_ACCEPT })
    assert.equal(unknown.status, 404)
    assert.equal(bad.status, 404)
    assert.equal(json.status, 404)
    assert.equal(bad.text, unknown.text)
    assert.equal(json.text, unknown.text)
    assert.equal(unknown.headers['cache-control'], 'no-store')
  })
})

test('rate limit like /who: reads from one address end in the plain 429; writes in the JSON 429', async () => {
  await withServer(0, { ...BASE, connectGetPerMinute: 3, connectPerMinute: 4 }, async ({ srv }) => {
    const codes = []
    for (let i = 0; i < 3; i += 1) codes.push((await get(srv.port, 'zzzzzzzzzz')).status)
    assert.deepEqual(codes, [404, 404, 404])
    assert.equal((await get(srv.port, 'zzzzzzzzzz')).status, 429)
    const a = await mint(srv.port)
    const writes = []
    for (let i = 0; i < 4; i += 1) writes.push((await post(srv.port, { ...a, token: 'bcdefghijk', did: DID })).status)
    assert.equal(writes.at(-1), 429)
  })
})

test('the store survives a restart (short_aliases.json in the backup dir, no secret in it)', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    await post(srv.port, { ...a, token: TOKEN, did: DID })
    const saved = JSON.parse(await fs.readFile(path.join(backupDir, 'short_aliases.json'), 'utf8'))
    assert.equal(saved.aliases[TOKEN].did, DID)
    assert.ok(!JSON.stringify(saved).includes(a.secret), 'no secret on disk')
  })
})

test('method gate: PUT /s 405, POST /s/<token> 405', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    assert.equal((await call(srv.port, { method: 'PUT', url: '/s', headers: JSON_H, body: '{}' })).status, 405)
    assert.equal((await call(srv.port, { method: 'POST', url: `/s/${TOKEN}` })).status, 405)
  })
})

test('POST /s: at most 3 tokens per code (409), re-registering one of them is fine', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    for (const token of ['aaaaaaaaaa', 'bbbbbbbbbb', 'cccccccccc']) assert.equal((await post(srv.port, { ...a, token, did: DID })).status, 201)
    const fourth = await post(srv.port, { ...a, token: 'dddddddddd', did: DID })
    assert.equal(fourth.status, 409)
    assert.equal(fourth.json.error, 'too_many_aliases')
    assert.equal((await post(srv.port, { ...a, token: 'aaaaaaaaaa', did: DID2 })).status, 200)
  })
})
