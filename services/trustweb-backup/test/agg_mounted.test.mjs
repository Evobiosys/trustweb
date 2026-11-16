// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Chain 43c: the real server (server.mjs) answers BOTH wave-43c route groups: the community dashboard aggregate and the name directory. Example data only.
import test from 'node:test'
import assert from 'node:assert/strict'
import { call, withServer } from './helpers.mjs'

const J = { 'Content-Type': 'application/json' }
const slot = (n) => String(n).padStart(2, '0').repeat(8)

test('server.mjs mounts /community/agg: three members post, the counts come back; a lone community answers 404', async () => {
  await withServer(0, {}, async ({ srv }) => {
    for (let i = 1; i <= 3; i++) {
      const r = await call(srv.port, { method: 'POST', url: '/community/agg', headers: J, body: JSON.stringify({ communityId: 'iyg', slot: slot(i), tiles: ['events', 'docs'] }) })
      assert.equal(r.status, 204)
    }
    const got = await call(srv.port, { url: '/community/agg/iyg' })
    assert.equal(got.status, 200)
    assert.equal(got.json.n, 3)
    assert.equal(got.json.tiles.events, 3)
    assert.equal((await call(srv.port, { url: '/community/agg/nobody' })).status, 404)
  })
})

test('the same server still answers the name directory (GET /directory without q is a 400, not a 404)', async () => {
  await withServer(0, {}, async ({ srv }) => {
    assert.equal((await call(srv.port, { url: '/directory' })).status, 400)
  })
})
