// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 21: POST /names/cap-request (an organizer asks the steward for a higher name cap) and the agentic split of the claim cap (X-TW-Agent: 1).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { call, withServer } from './helpers.mjs'
import { BASE, T0, claim, mint, send } from './connect_helpers.mjs'

const ask = (port, body, extra) => send(port, '/names/cap-request', body, extra)
const lines = async (dir) => (await fs.readFile(path.join(dir, 'name_cap_requests.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l))
const named = async (port, name = 'ada') => {
  const m = await mint(port)
  assert.equal((await claim(port, { name, ...m })).status, 200)
  return m
}

test('cap request: 202 {at}, one JSONL line next to the allow-list with capped reason and wanted; a second the same day is 429', async () => {
  await withServer(0, (dir) => ({ ...BASE, nameCapAllow: path.join(dir, 'allow.json'), now: () => T0 }), async ({ srv, dir }) => {
    const m = await named(srv.port)
    const r = await ask(srv.port, { ...m, name: 'ada', reason: 'x'.repeat(400), wanted: 999 }, { ip: '2001:db8:1:2:aaaa::1' })
    assert.equal(r.status, 202)
    assert.equal(r.json.at, T0)
    assert.deepEqual(await lines(dir), [{ at: T0, address: '2001:db8:1:2::/64', name: 'ada', reason: 'x'.repeat(280), wanted: 50 }])
    const again = await ask(srv.port, { ...m, name: 'ada', reason: 'again', wanted: 5 }, { ip: '2001:db8:1:2:bbbb::9' })
    assert.equal(again.status, 429, 'same /64')
    assert.equal((await lines(dir)).length, 1)
  })
})

test('cap request: needs the secret, a held name, a reason and a count', async () => {
  await withServer(0, { ...BASE }, async ({ srv }) => {
    const m = await named(srv.port)
    const ok = { ...m, name: 'ada', reason: 'meetup', wanted: 10 }
    assert.equal((await ask(srv.port, { ...ok, secret: 'B'.repeat(43) })).status, 403)
    assert.equal((await ask(srv.port, { ...ok, name: 'bob' })).status, 400, 'not a name this code holds')
    assert.equal((await ask(srv.port, { ...ok, reason: '' })).status, 400)
    assert.equal((await ask(srv.port, { ...ok, wanted: 0 })).status, 400)
    const bare = await mint(srv.port)
    assert.equal((await ask(srv.port, { ...bare, name: 'ada', reason: 'x', wanted: 5 })).status, 400, 'a code without a name')
    assert.equal((await ask(srv.port, ok, { ip: '203.0.113.5' })).status, 202, 'failed asks did not burn the daily request')
  })
})

test('agent claims count toward their own cap of the same size; manual claims are unchanged', async () => {
  await withServer(0, { ...BASE, nameCap: 3 }, async ({ srv, lines: log }) => {
    const agent = { headers: { 'X-TW-Agent': '1' } }
    for (const n of ['ada', 'bob', 'cyd']) assert.equal((await claim(srv.port, { name: n, ...(await mint(srv.port)) }, agent)).status, 200, n)
    assert.equal((await claim(srv.port, { name: 'dee', ...(await mint(srv.port)) }, agent)).status, 429, 'the 4th agentic claim')
    for (const n of ['eve', 'fay', 'gil']) assert.equal((await claim(srv.port, { name: n, ...(await mint(srv.port)) })).status, 200, `manual ${n}`)
    assert.equal((await claim(srv.port, { name: 'hal', ...(await mint(srv.port)) })).status, 429, 'the 4th manual claim')
    assert.equal(log.filter((l) => l.includes('agent: true')).length, 3)
  })
})
