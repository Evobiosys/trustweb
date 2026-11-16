// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Name directory (wave 43c social-hosting): PUT /directory stores a signed name record, GET /directory?q=<first last> finds it by exact normalised name,
// DELETE withdraws it, POST /directory/intent leaves a signed "intend to connect" for a key, POST /directory/intents pulls and clears them. No fixed port.
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startServer } from '../server.mjs'
import { HOST, call, withServer } from './helpers.mjs'

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function b58(bytes) {
  let n = BigInt('0x' + Buffer.from(bytes).toString('hex'))
  let out = ''
  while (n > 0n) { out = ALPHABET[Number(n % 58n)] + out; n /= 58n }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out }
  return out
}
const SPKI = Buffer.from('302a300506032b6570032100', 'hex')
function identity() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(SPKI.length)
  const did = `did:peer:2.Vz${b58(Buffer.concat([Buffer.from([0xed, 0x01]), raw]))}.Ez6LSx.SeyJ0IjoiZG0ifQ`
  return { did, sign: (s) => crypto.sign(null, Buffer.from(s), privateKey).toString('base64url') }
}
const norm = (f, l) => `${f} ${l}`.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
function record(id, over = {}) {
  const r = { first: 'Ada', last: 'Lovelace', key: id.did, ts: Date.now(), open: true, srv: true, ...over }
  const sig = id.sign(`tw-name-v1\n${norm(r.first, r.last)}\n${r.key}\n${r.ts}\n${r.open ? 1 : 0}\n${r.srv ? 1 : 0}`)
  return { v: 1, ...r, hosts: [], sig }
}
function intent(from, to, over = {}) {
  const i = { to: to.did, from: { first: 'Ada', last: 'Lovelace', key: from.did }, ts: Date.now(), ...over }
  return { ...i, sig: from.sign(`tw-intent-v1\n${i.to}\n${i.from.key}\n${norm(i.from.first, i.from.last)}\n${i.ts}`) }
}
const J = { 'Content-Type': 'application/json' }
// A DELETE body needs its Content-Length spelled out (Node sends none by default for DELETE).
const delCall = (port, obj) => { const body = JSON.stringify(obj); return call(port, { method: 'DELETE', url: '/directory', headers: { ...J, 'Content-Length': String(Buffer.byteLength(body)) }, body }) }
const put = (port, rec) => call(port, { method: 'PUT', url: '/directory', headers: J, body: JSON.stringify({ rec }) })
const find = (port, q) => call(port, { url: `/directory?q=${encodeURIComponent(q)}` })
const del = (port, id, ts = Date.now()) => delCall(port, { key: id.did, ts, sig: id.sign(`tw-del-v1\n${id.did}\n${ts}`) })
const send = (port, i) => call(port, { method: 'POST', url: '/directory/intent', headers: J, body: JSON.stringify({ intent: i }) })
const pull = (port, id, ts = Date.now(), who = id) => call(port, { method: 'POST', url: '/directory/intents', headers: J, body: JSON.stringify({ key: id.did, ts, sig: who.sign(`tw-pull-v1\n${id.did}\n${ts}`) }) })

test('publish, then find by first+last in any case; an unknown name finds nothing', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const ada = identity()
    assert.equal((await put(srv.port, record(ada))).status, 204)
    for (const q of ['ada lovelace', 'ADA  LOVELACE', 'Ada Lovelace']) {
      const r = await find(srv.port, q)
      assert.equal(r.status, 200)
      assert.deepEqual(r.json.records.map((x) => [x.first, x.last, x.key, x.open]), [['Ada', 'Lovelace', ada.did, true]])
    }
    assert.deepEqual((await find(srv.port, 'grace hopper')).json.records, [])
  })
})

test('no prefix search and no enumeration: a part of a name finds nothing; a missing or huge q is a 400', async () => {
  await withServer(0, {}, async ({ srv }) => {
    await put(srv.port, record(identity()))
    assert.deepEqual((await find(srv.port, 'ada')).json.records, [])
    assert.deepEqual((await find(srv.port, 'ada love')).json.records, [])
    assert.equal((await call(srv.port, { url: '/directory' })).status, 400)
    assert.equal((await find(srv.port, 'x'.repeat(200))).status, 400)
  })
})

test('a record with a bad or foreign signature, a changed field or a bad shape is refused with 400 and stores nothing', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const ada = identity(); const eve = identity()
    const good = record(ada)
    for (const bad of [{ ...good, last: 'Babbage' }, { ...good, ts: good.ts + 1 }, { ...good, sig: 'AAAA' }, { ...record(eve), key: ada.did }, { ...good, v: 2 }, { ...good, hosts: 'x' }, 'x', null]) {
      assert.equal((await put(srv.port, bad)).status, 400)
    }
    assert.deepEqual((await find(srv.port, 'ada lovelace')).json.records, [])
  })
})

test('a record whose owner did not allow a server (srv false) is refused: hand-off can never publish it', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const r = await put(srv.port, record(identity(), { srv: false }))
    assert.equal(r.status, 400)
    assert.equal(r.json.error, 'bad_request')
  })
})

test('the server never stores hosts[] (it is the fallback, not a host): it comes back empty', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const ada = identity()
    assert.equal((await put(srv.port, { ...record(ada), hosts: ['did:a', 'did:b'] })).status, 204)
    assert.deepEqual((await find(srv.port, 'ada lovelace')).json.records[0].hosts, [])
  })
})

test('the newest ts per key wins; an older record is accepted (204) but does not replace it', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const ada = identity(); const t = Date.now()
    await put(srv.port, record(ada, { ts: t, open: true }))
    await put(srv.port, record(ada, { ts: t - 5000, open: false }))
    assert.deepEqual((await find(srv.port, 'ada lovelace')).json.records.map((r) => [r.ts, r.open]), [[t, true]])
    await put(srv.port, record(ada, { ts: t + 5000, open: false }))
    assert.deepEqual((await find(srv.port, 'ada lovelace')).json.records.map((r) => [r.ts, r.open]), [[t + 5000, false]])
  })
})

test('two people with the same name both show (a name is a claim, not an identity); at most 10', async () => {
  await withServer(0, {}, async ({ srv }) => {
    for (let i = 0; i < 12; i += 1) await put(srv.port, record(identity()))
    assert.equal((await find(srv.port, 'ada lovelace')).json.records.length, 10)
  })
})

test('a name change by the same key removes the old name from the index', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const ada = identity(); const t = Date.now()
    await put(srv.port, record(ada, { ts: t }))
    await put(srv.port, record(ada, { ts: t + 1, first: 'Augusta', last: 'King' }))
    assert.deepEqual((await find(srv.port, 'ada lovelace')).json.records, [])
    assert.equal((await find(srv.port, 'augusta king')).json.records.length, 1)
  })
})

test('DELETE withdraws with a signed request; a foreign or stale signature changes nothing', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const ada = identity(); const eve = identity()
    await put(srv.port, record(ada))
    assert.equal((await delCall(srv.port, { key: ada.did, ts: Date.now(), sig: eve.sign('x') })).status, 400)
    assert.equal((await del(srv.port, ada, Date.now() - 10 * 60_000)).status, 400)
    assert.equal((await find(srv.port, 'ada lovelace')).json.records.length, 1)
    assert.equal((await del(srv.port, ada)).status, 204)
    assert.deepEqual((await find(srv.port, 'ada lovelace')).json.records, [])
    assert.equal((await del(srv.port, ada)).status, 204)
  })
})

test('an intent waits for its key; only that key can pull it, once', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const ada = identity(); const ben = identity(); const eve = identity()
    assert.equal((await send(srv.port, intent(ada, ben))).status, 204)
    assert.equal((await pull(srv.port, ben, Date.now(), eve)).status, 400)
    assert.equal((await pull(srv.port, ben, Date.now() - 10 * 60_000)).status, 400)
    const got = await pull(srv.port, ben)
    assert.equal(got.status, 200)
    assert.deepEqual(got.json.intents.map((i) => [i.to, i.from.key, i.from.first]), [[ben.did, ada.did, 'Ada']])
    assert.deepEqual((await pull(srv.port, ben)).json.intents, [])
    assert.deepEqual((await pull(srv.port, ada)).json.intents, [])
  })
})

test('a forged intent (wrong signer, changed target) is refused; one sender cannot fill a mailbox past 20', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const ada = identity(); const ben = identity(); const eve = identity()
    assert.equal((await send(srv.port, { ...intent(ada, ben), to: eve.did })).status, 400)
    assert.equal((await send(srv.port, { ...intent(eve, ben), from: { first: 'Ada', last: 'Lovelace', key: ada.did } })).status, 400)
    for (let i = 0; i < 25; i += 1) await send(srv.port, intent(identity(), ben))
    assert.equal((await pull(srv.port, ben)).json.intents.length, 20)
  })
})

test('the same sender asking twice leaves one intent, the newest', async () => {
  await withServer(0, {}, async ({ srv }) => {
    const ada = identity(); const ben = identity(); const t = Date.now()
    await send(srv.port, intent(ada, ben, { ts: t })); await send(srv.port, intent(ada, ben, { ts: t + 1 }))
    assert.deepEqual((await pull(srv.port, ben)).json.intents.map((i) => i.ts), [t + 1])
  })
})

test('records and intents survive a restart (the store is a file)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twdir-'))
  const cfg = { dir: path.join(dir, 'backup'), hostedDir: path.join(dir, 'hosted'), allowedHosts: [HOST, '127.0.0.1'], port: 0, log: () => undefined, hostedMinFreeBytes: 0 }
  const ada = identity(); const ben = identity()
  const first = await startServer(cfg)
  await put(first.port, record(ada)); await send(first.port, intent(ada, ben))
  await first.close()
  const second = await startServer(cfg)
  try {
    assert.equal((await find(second.port, 'ada lovelace')).json.records.length, 1)
    assert.equal((await pull(second.port, ben)).json.intents.length, 1)
  } finally {
    await second.close()
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 })
  }
})

test('a wrong method answers 405', async () => {
  await withServer(0, {}, async ({ srv }) => {
    assert.equal((await call(srv.port, { method: 'PATCH', url: '/directory', headers: J, body: '{}' })).status, 405)
  })
})
