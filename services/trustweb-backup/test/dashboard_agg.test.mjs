// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 43c connect-extras (theta): the community dashboard aggregate. Its own tiny http server on port 0, no fixed port. Example data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { AGG_MIN_MEMBERS, createDashboardAgg, isAggPath } from '../dashboard_agg.mjs'

const APP = 'app.example.test'
const slot = (n) => String(n).padStart(2, '0').repeat(8)
let clock = 1_800_000_000_000

async function withAgg(over, body) {
  const agg = createDashboardAgg({ cfg: { linkHosts: [APP], aggPerMinute: 10000, ...over }, clientOf: () => '203.0.113.7', now: () => clock })
  const server = http.createServer((req, res) => { void agg.handle(req, res) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const call = (method, path, json, headers = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (res) => {
      let t = ''
      res.on('data', (c) => { t += c })
      res.on('end', () => resolve({ status: res.statusCode, json: t ? JSON.parse(t) : null }))
    })
    req.on('error', reject)
    req.end(json === undefined ? undefined : typeof json === 'string' ? json : JSON.stringify(json))
  })
  try { await body(call) } finally { await new Promise((r) => server.close(r)) }
}
const post = (call, communityId, n, tiles) => call('POST', '/community/agg', { communityId, slot: slot(n), tiles })

test('paths', () => {
  assert.equal(isAggPath('/community/agg'), true)
  assert.equal(isAggPath('/community/agg/iyg'), true)
  assert.equal(isAggPath('/community/other'), false)
})

test('below the minimum nothing is answered, from it on the counts', async () => {
  await withAgg({}, async (call) => {
    for (let i = 1; i < AGG_MIN_MEMBERS; i++) assert.equal((await post(call, 'iyg', i, ['events'])).status, 204)
    assert.equal((await call('GET', '/community/agg/iyg')).status, 404)
    assert.equal((await post(call, 'iyg', 90, ['events', 'docs'])).status, 204)
    const got = await call('GET', '/community/agg/iyg')
    assert.equal(got.status, 200)
    assert.deepEqual(got.json, { n: AGG_MIN_MEMBERS, tiles: { events: AGG_MIN_MEMBERS, docs: 1 } })
  })
})

test('a slot counts once: a new post replaces the old one', async () => {
  await withAgg({}, async (call) => {
    for (let i = 1; i <= AGG_MIN_MEMBERS; i++) await post(call, 'iyg', i, ['events'])
    await post(call, 'iyg', 1, ['docs'])
    await post(call, 'iyg', 1, ['docs', 'members'])
    const got = (await call('GET', '/community/agg/iyg')).json
    assert.equal(got.n, AGG_MIN_MEMBERS)
    assert.deepEqual(got.tiles, { events: AGG_MIN_MEMBERS - 1, docs: 1, members: 1 })
  })
})

test('the answer holds counts only: no slot, no list of members', async () => {
  await withAgg({}, async (call) => {
    for (let i = 1; i <= AGG_MIN_MEMBERS; i++) await post(call, 'iyg', i, ['events'])
    const text = JSON.stringify((await call('GET', '/community/agg/iyg')).json)
    assert.ok(!text.includes(slot(1)))
    assert.deepEqual(Object.keys(JSON.parse(text)).sort(), ['n', 'tiles'])
  })
})

test('malformed posts are refused: bad community, slot, tiles, body, method, origin, size', async () => {
  await withAgg({}, async (call) => {
    const bad = (body) => call('POST', '/community/agg', body)
    assert.equal((await bad({ communityId: 'has space', slot: slot(1), tiles: ['events'] })).status, 400)
    assert.equal((await bad({ communityId: 'iyg', slot: 'short', tiles: ['events'] })).status, 400)
    assert.equal((await bad({ communityId: 'iyg', slot: slot(1), tiles: ['nope'] })).status, 400)
    assert.equal((await bad({ communityId: 'iyg', slot: slot(1), tiles: 'events' })).status, 400)
    assert.equal((await bad('not json')).status, 400)
    assert.equal((await call('PUT', '/community/agg', {})).status, 405)
    assert.equal((await call('POST', '/community/agg', { communityId: 'iyg', slot: slot(1), tiles: ['events'] }, { Origin: 'https://evil.example' })).status, 403)
    assert.equal((await bad({ communityId: 'iyg', slot: slot(1), tiles: ['events'], pad: 'x'.repeat(4000) })).status, 413)
  })
})

test('a community with the tiles of nobody shows nothing; tiles are unique and known only', async () => {
  await withAgg({}, async (call) => {
    for (let i = 1; i <= AGG_MIN_MEMBERS; i++) await post(call, 'iyg', i, ['events', 'events'])
    assert.deepEqual((await call('GET', '/community/agg/iyg')).json.tiles, { events: AGG_MIN_MEMBERS })
    assert.equal((await call('GET', '/community/agg/bad%20id')).status, 404)
  })
})

test('old slots expire; the store is bounded', async () => {
  await withAgg({ aggMaxSlots: 5 }, async (call) => {
    for (let i = 1; i <= AGG_MIN_MEMBERS; i++) await post(call, 'iyg', i, ['events'])
    assert.equal((await call('GET', '/community/agg/iyg')).status, 200)
    clock += 91 * 86_400_000
    assert.equal((await call('GET', '/community/agg/iyg')).status, 404)
    for (let i = 1; i <= 8; i++) await post(call, 'big', i, ['events'])
    const n = (await call('GET', '/community/agg/big')).json?.n
    assert.ok(n <= 5, `kept ${n}`)
  })
})

test('rate limit per address', async () => {
  await withAgg({ aggPerMinute: 3 }, async (call) => {
    const codes = []
    for (let i = 0; i < 5; i++) codes.push((await call('GET', '/community/agg/iyg')).status)
    assert.ok(codes.includes(429))
  })
})
