// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 24b: a renamed-away username is HELD for 2 years (not an alias): others get 409 {held, until}, the owner may re-take it. No fixed port.
import test from 'node:test'
import assert from 'node:assert/strict'
import { withServer } from './helpers.mjs'
import { BASE, DAY, T0, claim, mint, readStore, who } from './connect_helpers.mjs'

const HOLD = 730 * DAY
const LONG_LIVED = { ...BASE, connectTtlDays: 2000 } // the codes outlive the 2 years

test('hold: renaming blocks the old name for 2 years for other codes (409 held + until), the link stops working, nobody gets it at day 731 earlier than due', async () => {
  let t = T0
  await withServer(0, { ...LONG_LIVED, now: () => t }, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port)
    await claim(srv.port, { name: 'ada', ...a })
    assert.equal((await claim(srv.port, { name: 'ada2', ...a })).status, 200, 'the rename')
    assert.equal((await who(srv.port, 'ada', { host: 'app.example.test' })).status, 404, 'not an alias: the old link stops')
    t += 100 * DAY
    const hit = await claim(srv.port, { name: 'ada', ...b })
    assert.equal(hit.status, 409)
    assert.equal(hit.json.held, true)
    assert.equal(hit.json.until, T0 + HOLD)
    assert.deepEqual((await readStore(backupDir)).holds.ada, { until: T0 + HOLD, code: a.code })
    t = T0 + HOLD - 1
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 409, 'still held the last millisecond')
    t = T0 + HOLD
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 200, 'free after 2 years')
  })
})

test('hold: the owner re-takes the held name within the 2 years; the hold is gone then', async () => {
  let t = T0
  await withServer(0, { ...LONG_LIVED, now: () => t }, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port)
    await claim(srv.port, { name: 'ada', ...a })
    await claim(srv.port, { name: 'ada2', ...a })
    t += 5 * DAY
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200)
    assert.equal((await readStore(backupDir)).holds.ada, undefined)
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 409, 'taken by the owner again, not held')
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).json.held, undefined)
  })
})

test('hold: an explicit release holds nothing (the 30-day rest applies); a later rename holds the old name', async () => {
  await withServer(0, { ...BASE, now: () => T0 }, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    await claim(srv.port, { name: 'ada', ...a })
    await claim(srv.port, { release: 'ada', ...a })
    assert.equal((await readStore(backupDir)).holds?.ada, undefined)
    await claim(srv.port, { name: 'bob', ...a })
    await claim(srv.port, { name: 'cyd', ...a })
    assert.equal((await readStore(backupDir)).holds.bob.until, T0 + HOLD)
  })
})
