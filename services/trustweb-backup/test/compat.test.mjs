import test from 'node:test'
import assert from 'node:assert/strict'
import { call, withServer } from './helpers.mjs'

const P = 8975
const PACK = 'e'.repeat(64)
const KEY_TOKEN = 'f'.repeat(64)
const put = (body, token = KEY_TOKEN, id = PACK) => call(P, { method: 'PUT', url: `/backup/${id}`, headers: { 'X-Write-Token': token }, body })
const get = (headers = {}, id = PACK) => call(P, { url: `/backup/${id}`, headers })

test('late transcript: a pack slot is created first (pending) and replaced later by the same token; a stranger cannot replace it', async () => {
  await withServer(P, {}, async () => {
    assert.equal((await put('pending-pack')).status, 204)
    const pending = await get()
    assert.equal(pending.text, 'pending-pack')
    assert.equal((await put('evil', 'a'.repeat(64))).status, 403)
    assert.equal((await put('full-pack-with-transcript')).status, 204) // the SAME token replaces it
    const done = await get()
    assert.equal(done.text, 'full-pack-with-transcript')
    assert.notEqual(done.headers.etag, pending.headers.etag)
  })
})

test('GET sends ETag + Last-Modified; If-None-Match gives 304 with no body, a changed pack gives 200 and a new ETag', async () => {
  await withServer(P, {}, async () => {
    await put('v1')
    const first = await get()
    assert.equal(first.status, 200)
    assert.match(first.headers.etag, /^"[0-9a-f]{32}"$/)
    assert.ok(!Number.isNaN(Date.parse(first.headers['last-modified'])))
    assert.equal(first.headers['cache-control'], 'no-store')
    const same = await get({ 'If-None-Match': first.headers.etag })
    assert.equal(same.status, 304)
    assert.equal(same.body.length, 0)
    assert.equal(same.headers.etag, first.headers.etag)
    // a list, weak prefix and * are understood
    assert.equal((await get({ 'If-None-Match': `"zzz", W/${first.headers.etag}` })).status, 304)
    assert.equal((await get({ 'If-None-Match': '*' })).status, 304)
    assert.equal((await get({ 'If-None-Match': '"other"' })).status, 200)
    assert.equal((await put('v1')).status, 204) // same bytes again: same ETag, still 304
    assert.equal((await get({ 'If-None-Match': first.headers.etag })).status, 304)
    await put('v2')
    const changed = await get({ 'If-None-Match': first.headers.etag })
    assert.equal(changed.status, 200)
    assert.equal(changed.text, 'v2')
    assert.notEqual(changed.headers.etag, first.headers.etag)
    assert.equal((await get({ 'If-None-Match': first.headers.etag }, 'd'.repeat(64))).status, 404) // unknown id stays 404
  })
})

test('the old routes keep their behaviour: plain-text answers, 405 Allow header, health, 400 for odd paths', async () => {
  await withServer(P, {}, async () => {
    assert.equal((await call(P, { url: '/health' })).text, 'ok')
    assert.equal((await call(P, { url: '/backup/health' })).text, 'ok')
    const del = await call(P, { method: 'DELETE', url: `/backup/${PACK}` })
    assert.equal(del.status, 405)
    assert.equal(del.headers.allow, 'GET, PUT')
    assert.equal(del.text, 'method not allowed')
    const odd = await call(P, { url: '/backup/not-an-id' })
    assert.equal(odd.status, 400)
    assert.equal(odd.text, 'bad id')
    assert.equal((await call(P, { url: '/something/else/entirely' })).status, 400)
    const forbidden = await put('x')
    assert.equal(forbidden.status, 204)
    const wrong = await put('y', 'a'.repeat(64))
    assert.equal(wrong.status, 403)
    assert.equal(wrong.text, 'forbidden')
  })
})

test('the request deadline: a stalled /backup upload is cut at SHORT_REQUEST_MS (the old 30 s, shortened here), a long route is not', async () => {
  await withServer(P, { shortRequestMs: 200, longRequestMs: 5000, uploadIdleMs: 4000 }, async () => {
    const outcome = await new Promise((resolve) => {
      const http = globalThis.process.getBuiltinModule('node:http')
      const req = http.request({ host: '127.0.0.1', port: P, method: 'PUT', path: `/backup/${PACK}`, headers: { Host: 'app.example.test', 'X-Write-Token': KEY_TOKEN, 'Transfer-Encoding': 'chunked' } }, (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      })
      req.on('error', () => resolve('reset'))
      req.write('partial')
      setTimeout(() => resolve('still open'), 1500)
    })
    assert.ok(outcome === 408 || outcome === 'reset', `backup upload outcome ${outcome}`)
    const long = await new Promise((resolve) => {
      const http = globalThis.process.getBuiltinModule('node:http')
      const req = http.request({ host: '127.0.0.1', port: P, method: 'PUT', path: `/hosted/${'a'.repeat(64)}/rec/${'1'.repeat(32)}`, headers: { Host: 'app.example.test', 'X-Write-Token': KEY_TOKEN, 'X-Seconds': '5', 'Transfer-Encoding': 'chunked' } }, (res) => {
        res.resume()
        res.on('end', () => resolve(`status ${res.statusCode}`))
      })
      req.on('error', () => resolve('reset'))
      req.write('partial')
      setTimeout(() => {
        resolve('still open after 1 s')
        req.destroy()
      }, 1000)
    })
    assert.equal(long, 'still open after 1 s')
  })
})
