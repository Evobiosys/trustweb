import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { startServer } from '../server.mjs'

const { newRandomKey, backupNow, restore, BackupNotFound } = await import(pathToFileURL(process.env.BACKUP_JS).href)

const ID = 'a'.repeat(64)
const TOKEN = 'b'.repeat(64)

async function withServer(options, body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twbackup-'))
  const srv = await startServer({ dir, port: 0, log: () => {}, ...options })
  try {
    await body({ srv, dir, base: `http://127.0.0.1:${srv.port}/backup/` })
  } finally {
    await srv.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
}

/** Raw request, so tests can set Host and Origin (fetch forbids Host). */
function raw(srv, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.port, method, path: url, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

test('PUT then GET returns the same bytes; update with the same token works', async () => {
  await withServer({}, async ({ base }) => {
    const put = (bytes, token = TOKEN) =>
      fetch(base + ID, { method: 'PUT', headers: { 'X-Write-Token': token }, body: bytes })
    assert.equal((await put(Buffer.from('one'))).status, 204)
    assert.equal(Buffer.from(await (await fetch(base + ID)).arrayBuffer()).toString(), 'one')
    assert.equal((await put(Buffer.from('two'))).status, 204)
    assert.equal(Buffer.from(await (await fetch(base + ID)).arrayBuffer()).toString(), 'two')
  })
})

test('GET unknown id is 404; malformed id or token is 400; other methods 405', async () => {
  await withServer({}, async ({ srv, base }) => {
    assert.equal((await fetch(base + 'c'.repeat(64))).status, 404)
    assert.equal((await fetch(base + '../../etc/passwd')).status, 400)
    assert.equal((await fetch(base + 'ABC')).status, 400)
    assert.equal((await fetch(base + 'A'.repeat(64))).status, 400)
    assert.equal((await fetch(base + ID, { method: 'PUT', body: 'x' })).status, 400)
    assert.equal((await fetch(base + ID, { method: 'PUT', headers: { 'X-Write-Token': 'zz' }, body: 'x' })).status, 400)
    assert.equal((await fetch(base + ID, { method: 'PUT', headers: { 'X-Write-Token': TOKEN } })).status, 400)
    assert.equal((await fetch(base + ID, { method: 'DELETE' })).status, 405)
    assert.equal((await raw(srv, { url: '/health', headers: { Host: 'localhost' } })).status, 200)
  })
})

test('wrong write token is 403 and the stored backup stays intact', async () => {
  await withServer({}, async ({ base }) => {
    await fetch(base + ID, { method: 'PUT', headers: { 'X-Write-Token': TOKEN }, body: 'keep me' })
    const res = await fetch(base + ID, { method: 'PUT', headers: { 'X-Write-Token': 'c'.repeat(64) }, body: 'overwrite' })
    assert.equal(res.status, 403)
    assert.equal(await (await fetch(base + ID)).text(), 'keep me')
  })
})

test('oversize body is 413 (declared and streamed), exactly at the cap is accepted', async () => {
  await withServer({ maxBytes: 1000 }, async ({ srv, base }) => {
    const headers = { 'X-Write-Token': TOKEN }
    assert.equal((await fetch(base + ID, { method: 'PUT', headers, body: Buffer.alloc(1000, 1) })).status, 204)
    assert.equal((await fetch(base + ID, { method: 'PUT', headers, body: Buffer.alloc(1001, 1) })).status, 413)
    // Chunked upload without Content-Length: the streamed byte count must trigger the cap.
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: srv.port, method: 'PUT', path: `/backup/${ID}`, headers: { ...headers, 'Transfer-Encoding': 'chunked' } },
        (r) => { r.resume(); r.on('end', () => resolve(r.statusCode)) },
      )
      req.on('error', reject)
      req.write(Buffer.alloc(600, 1))
      req.write(Buffer.alloc(600, 1))
      req.end()
    })
    assert.equal(res, 413)
    assert.equal((await fetch(base + ID)).status, 200) // old content still there
  })
})

test('rate limit: 429 after the window quota, per client; X-Forwarded-For separates clients via loopback proxy', async () => {
  await withServer({ rateLimit: 3, rateWindowMs: 60000 }, async ({ srv }) => {
    const get = (xff) => raw(srv, { url: `/backup/${'d'.repeat(64)}`, headers: xff ? { 'X-Forwarded-For': xff } : {} })
    assert.deepEqual([(await get('1.1.1.1')).status, (await get('1.1.1.1')).status, (await get('1.1.1.1')).status], [404, 404, 404])
    assert.equal((await get('1.1.1.1')).status, 429)
    // Spoofed leading entries do not help: only the last entry (the proxy's) counts.
    assert.equal((await get('9.9.9.9, 1.1.1.1')).status, 429)
    assert.equal((await get('2.2.2.2')).status, 404)
  })
})

test('bad Host is 421; foreign Origin is 403; own Origin works', async () => {
  await withServer({ allowedHosts: ['app.example.test', '127.0.0.1'] }, async ({ srv }) => {
    const url = `/backup/${'e'.repeat(64)}`
    assert.equal((await raw(srv, { url, headers: { Host: 'evil.example.com' } })).status, 421)
    assert.equal((await raw(srv, { url, headers: { Host: 'evil.example.com:8960' } })).status, 421)
    assert.equal((await raw(srv, { url, headers: { Host: 'app.example.test' } })).status, 404)
    assert.equal((await raw(srv, { url, headers: { Host: 'app.example.test', Origin: 'https://evil.example.com' } })).status, 403)
    assert.equal((await raw(srv, { url, headers: { Host: 'app.example.test', Origin: 'https://app.example.test' } })).status, 404)
  })
})

test('end to end with backup.ts: stored file holds no plaintext; restore works; wrong key is not found', async () => {
  await withServer({}, async ({ dir, base }) => {
    const key = await newRandomKey()
    const payload = { inventory: [{ name: 'Motorbike' }], notes: ['secret note'] }
    await backupNow(key, payload, base)
    assert.deepEqual(await restore(key, base), payload)
    await assert.rejects(async () => restore(await newRandomKey(), base), BackupNotFound)
    const files = await fs.readdir(path.join(dir, 'blobs'))
    assert.equal(files.length, 1)
    const stored = await fs.readFile(path.join(dir, 'blobs', files[0]))
    assert.equal(stored.includes(Buffer.from('Motorbike')), false)
    assert.equal(stored.includes(Buffer.from('secret note')), false)
    assert.equal((await fs.readdir(path.join(dir, 'tmp'))).length, 0) // atomic write left nothing behind
    // Another key cannot overwrite this slot: simulate by presenting a different token for the same id.
    const res = await fetch(base + files[0].replace('.bin', ''), { method: 'PUT', headers: { 'X-Write-Token': 'f'.repeat(64) }, body: 'x' })
    assert.equal(res.status, 403)
    assert.deepEqual(await restore(key, base), payload)
  })
})

test('concurrent first PUTs with different tokens: exactly one wins, the other gets 403', async () => {
  await withServer({}, async ({ base }) => {
    const put = (token) => fetch(base + ID, { method: 'PUT', headers: { 'X-Write-Token': token }, body: token })
    const statuses = (await Promise.all([put('1'.repeat(64)), put('2'.repeat(64))])).map((r) => r.status).sort()
    assert.deepEqual(statuses, [204, 403])
  })
})

test('slot cap: new ids refused with 507, existing ids still updatable', async () => {
  await withServer({ maxBlobs: 1 }, async ({ base }) => {
    const headers = { 'X-Write-Token': TOKEN }
    assert.equal((await fetch(base + ID, { method: 'PUT', headers, body: 'a' })).status, 204)
    assert.equal((await fetch(base + 'c'.repeat(64), { method: 'PUT', headers, body: 'a' })).status, 507)
    assert.equal((await fetch(base + ID, { method: 'PUT', headers, body: 'b' })).status, 204)
  })
})
