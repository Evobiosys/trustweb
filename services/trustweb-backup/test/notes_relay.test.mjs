// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Notes relay (wave 32): POST /notes/relay stores an opaque encrypted blob for a recipient, GET lists/fetches it, DELETE removes it. No fixed port.
import test from 'node:test'
import assert from 'node:assert/strict'
import { call, withServer, T, T2 } from './helpers.mjs'

const ANNA = 'did:peer:2.VzAnna'
const BEN = 'did:peer:2.VzBen'
const DAY = 86_400_000
const JSON_H = { 'Content-Type': 'application/json' }
const blobOf = (n = 40) => Buffer.alloc(n, 7)
const letter = (over = {}) => {
  const raw = over.raw ?? blobOf()
  return { to: BEN, from: ANNA, blob: raw.toString('base64'), size: raw.length, expires: Date.now() + DAY, ...over, raw: undefined }
}
const post = (port, body, token = T) => call(port, { method: 'POST', url: '/notes/relay', headers: { ...JSON_H, 'X-Relay-Token': token }, body: JSON.stringify(body) })
const list = (port, token = T2, who = BEN) => call(port, { url: `/notes/relay?for=${encodeURIComponent(who)}`, headers: { 'X-Relay-Token': token } })
const one = (port, id, token = T2, who = BEN) => call(port, { url: `/notes/relay?for=${encodeURIComponent(who)}&id=${id}`, headers: { 'X-Relay-Token': token } })
const del = (port, id, token = T2, who = BEN) => call(port, { method: 'DELETE', url: `/notes/relay?for=${encodeURIComponent(who)}&id=${id}`, headers: { 'X-Relay-Token': token } })

test('post, list, fetch, delete: the blob comes back byte for byte and is gone after DELETE', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const raw = Buffer.from('opaque ciphertext, not note text')
    const made = await post(srv.port, letter({ raw }))
    assert.equal(made.status, 201)
    assert.match(made.json.id, /^[0-9a-f]{32}$/)
    const l = await list(srv.port)
    assert.equal(l.status, 200)
    assert.deepEqual(l.json.items.map((i) => ({ id: i.id, from: i.from, size: i.size })), [{ id: made.json.id, from: ANNA, size: raw.length }])
    assert.equal(l.json.items[0].blob, undefined)
    const got = await one(srv.port, made.json.id)
    assert.equal(got.status, 200)
    assert.deepEqual(Buffer.from(got.json.blob, 'base64'), raw)
    assert.equal((await del(srv.port, made.json.id)).status, 204)
    assert.equal((await one(srv.port, made.json.id)).status, 404)
    assert.deepEqual((await list(srv.port)).json.items, [])
  })
})

test('the server writes the blob to disk as given: the plain text never appears in the store', async () => {
  await withServer(0, {}, async ({ srv, backupDir }) => {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await post(srv.port, letter({ raw: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) }))
    const all = []
    const walk = async (d) => { for (const e of await fs.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else all.push(await fs.readFile(p, 'utf8')) } }
    await walk(path.join(backupDir, 'notes_relay'))
    assert.ok(all.length > 0)
    assert.ok(all.every((t) => !t.includes(BEN + ' says')))
  })
})

test('only the recipient token opens the mailbox; a wrong token, an unknown recipient and a missing token answer the same 404', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const made = await post(srv.port, letter())
    assert.equal((await list(srv.port, T2)).status, 200) // first reader claims the mailbox
    const wrong = await list(srv.port, 'e'.repeat(64))
    const unknown = await list(srv.port, T2, 'did:peer:2.VzNobody')
    const none = await call(srv.port, { url: `/notes/relay?for=${BEN}` })
    for (const r of [wrong, unknown, none]) assert.equal(r.status, 404)
    assert.equal(wrong.text, unknown.text)
    assert.equal(wrong.text, none.text)
    assert.equal((await one(srv.port, made.json.id, 'e'.repeat(64))).status, 404)
    assert.equal((await del(srv.port, made.json.id, 'e'.repeat(64))).status, 404)
  })
})

test('a sender token is claimed by the first post for that sender; another token for the same sender answers 404', async () => {
  await withServer(0, {}, async ({ srv }) => {
    assert.equal((await post(srv.port, letter(), T)).status, 201)
    assert.equal((await post(srv.port, letter(), 'e'.repeat(64))).status, 404)
    assert.equal((await post(srv.port, letter(), T)).status, 201)
  })
})

test('malformed posts answer 400: bad token shape, bad did, bad base64, wrong size, expiry past 30 days or already over', async () => {
  await withServer(0, {}, async ({ srv }) => {
    assert.equal((await post(srv.port, letter(), 'short')).status, 400)
    assert.equal((await post(srv.port, letter({ to: '' }))).status, 400)
    assert.equal((await post(srv.port, letter({ from: 5 }))).status, 400)
    assert.equal((await post(srv.port, letter({ blob: '***' }))).status, 400)
    assert.equal((await post(srv.port, letter({ size: 3 }))).status, 400)
    assert.equal((await post(srv.port, letter({ expires: Date.now() + 31 * DAY }))).status, 400)
    assert.equal((await post(srv.port, letter({ expires: Date.now() - 1000 }))).status, 400)
    assert.equal((await call(srv.port, { method: 'POST', url: '/notes/relay', headers: { ...JSON_H, 'X-Relay-Token': T }, body: 'not json' })).status, 400)
  })
})

test('a blob over the per-blob cap answers 413', async () => {
  await withServer(0, { notesRelayMaxBlobBytes: 100 }, async ({ srv }) => {
    assert.equal((await post(srv.port, letter({ raw: blobOf(101) }))).status, 413)
    assert.equal((await post(srv.port, letter({ raw: blobOf(100) }))).status, 201)
  })
})

test('a recipient holds at most the per-recipient count; the next post answers the uniform 404', async () => {
  await withServer(0, { notesRelayMaxPerRecipient: 3 }, async ({ srv }) => {
    for (let i = 0; i < 3; i++) assert.equal((await post(srv.port, letter())).status, 201)
    const full = await post(srv.port, letter())
    assert.equal(full.status, 404)
    assert.equal(full.text, (await list(srv.port, 'e'.repeat(64), 'did:peer:2.VzNobody')).text)
    const l = await list(srv.port)
    await del(srv.port, l.json.items[0].id)
    assert.equal((await post(srv.port, letter())).status, 201)
  })
})

test('expired blobs are gone for the recipient', async () => {
  let t = 1_800_000_000_000
  await withServer(0, { now: () => t }, async ({ srv }) => {
    const made = await post(srv.port, letter({ expires: t + 1000 }))
    assert.equal(made.status, 201)
    assert.equal((await list(srv.port)).json.items.length, 1)
    t += 2000
    assert.deepEqual((await list(srv.port)).json.items, [])
    assert.equal((await one(srv.port, made.json.id)).status, 404)
  })
})

test('the relay has its own rate limit per network address', async () => {
  await withServer(0, { notesRelayPerMinute: 3 }, async ({ srv }) => {
    for (let i = 0; i < 3; i++) await list(srv.port)
    const r = await list(srv.port)
    assert.equal(r.status, 429)
    assert.ok(r.headers['retry-after'])
  })
})

test('the relay routes log nothing, not even the method and status', async () => {
  await withServer(0, {}, async ({ srv, lines }) => {
    await post(srv.port, letter())
    await list(srv.port)
    assert.deepEqual(lines, [])
  })
})
