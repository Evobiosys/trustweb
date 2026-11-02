// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Organizer hardening: the ORG_DAYS sweeper, counters flushed in the background, GET /org/event/<id>/public. No fixed port (port 0).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createOrgStore } from '../organizer_store.mjs'
import { call, withServer } from './helpers.mjs'
import { APP, BASE, DAY, T0, send } from './connect_helpers.mjs'

const LINK = `https://${APP}/#ev_host=abc123&n=Sample`
const ROOM = { orgCreatePerMinute: 10000, orgCreatePerHour: 10000, orgWritePerMinute: 10000, orgWritePerHour: 10000, orgHitPerMinute: 10000 }
const OPTS = { ...BASE, ...ROOM }
const EVENT = { name: 'Sample Meetup', from: '2030-01-01 10:00', where: 'Sample Hall' }
const SECRET = 'S'.repeat(43)
/** A 1x1 transparent PNG. */
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const limitsOf = () => ({ events: 3, invitees: 25 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const tmpFile = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'tworg-')), 'organizers.json')
const onDisk = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))
const clock = (start = T0) => {
  const c = { t: start, now: () => c.t }
  return c
}

const mint = async (port) => (await send(port, '/org', { name: 'Sample Org' })).json
const save = (port, o, fields = {}) => send(port, '/org/event', { org: o.org, secret: o.secret, event: EVENT, link: LINK, invitees: [], ...fields })
const pub = (port, id, extra = {}) => call(port, { url: `/org/event/${id}/public`, ...extra })

// ---- (b) sweeper

test('sweep: drops an org untouched for ORG_DAYS, keeps one written to or opened via me() since; its events stop counting', async () => {
  const c = clock()
  const file = await tmpFile()
  const store = await createOrgStore({ file, max: 10, limitsOf, now: c.now, days: 365, flushMs: 0 })
  const idle = (await store.create('Idle', SECRET)).org
  const written = (await store.create('Written', SECRET)).org
  const opened = (await store.create('Opened', SECRET)).org
  const { id } = await store.saveEvent(idle, SECRET, { event: EVENT, link: LINK, invitees: [] })
  c.t = T0 + 200 * DAY
  await store.saveEvent(written, SECRET, { event: EVENT, link: LINK, invitees: [] })
  c.t = T0 + 300 * DAY
  assert.equal((await store.me(opened, SECRET)).kind, 'ok')
  c.t = T0 + 366 * DAY
  assert.deepEqual(await store.sweep(), { removed: 1 })
  assert.equal(store.size(), 2)
  assert.equal((await store.me(idle, SECRET)).kind, 'forbidden')
  assert.equal(store.publicOf(id), null)
  store.hit(id, 'opened') // a no-op, never a throw
  const disk = await onDisk(file)
  assert.deepEqual(Object.keys(disk.orgs).sort(), [opened, written].sort())
  await store.close()
})

test('sweep: nothing to drop writes nothing; days <= 0 never sweeps', async () => {
  const c = clock()
  const file = await tmpFile()
  const store = await createOrgStore({ file, max: 10, limitsOf, now: c.now, days: 0, flushMs: 0 })
  await store.create('Kept', SECRET)
  c.t = T0 + 10_000 * DAY
  assert.deepEqual(await store.sweep(), { removed: 0 })
  assert.equal(store.size(), 1)
  await store.close()
})

test('sweep in the server: runs on ORG_SWEEP_MS, honours ORG_DAYS', async () => {
  const c = clock()
  await withServer(0, { ...OPTS, now: c.now, orgDays: 1, orgSweepMs: 20 }, async ({ srv }) => {
    const o = await mint(srv.port)
    assert.equal((await send(srv.port, '/org/me', o)).status, 200)
    c.t = T0 + 2 * DAY
    await sleep(120)
    assert.equal((await send(srv.port, '/org/me', o)).status, 403)
  })
})

// ---- (c) counters flushed in the background

test('hit: no write per request; the counters reach the file on the next flush tick', async () => {
  const file = await tmpFile()
  const store = await createOrgStore({ file, max: 10, limitsOf, flushMs: 60_000 })
  const { org } = await store.create('Counted', SECRET)
  const { id } = await store.saveEvent(org, SECRET, { event: EVENT, link: LINK, invitees: [] })
  for (let i = 0; i < 50; i++) store.hit(id, 'opened')
  await sleep(80)
  assert.equal((await onDisk(file)).orgs[org].events[id].counts.opened, 0, 'no per-request write')
  assert.equal((await store.me(org, SECRET)).events[0].counts.opened, 50, 'memory is current')
  await store.flush()
  assert.equal((await onDisk(file)).orgs[org].events[id].counts.opened, 50)
  store.hit(id, 'joined')
  await store.close() // close flushes what is left
  assert.equal((await onDisk(file)).orgs[org].events[id].counts.joined, 1)
})

test('hit: the timer flushes on its own, once per tick however many hits came in', async () => {
  const file = await tmpFile()
  const store = await createOrgStore({ file, max: 10, limitsOf, flushMs: 40 })
  const { org } = await store.create('Ticked', SECRET)
  const { id } = await store.saveEvent(org, SECRET, { event: EVENT, link: LINK, invitees: [] })
  const before = store.writes()
  for (let i = 0; i < 30; i++) store.hit(id, 'tagged')
  await sleep(150)
  assert.equal((await onDisk(file)).orgs[org].events[id].counts.tagged, 30)
  assert.ok(store.writes() - before <= 2, `${store.writes() - before} writes for 30 hits`)
  const idle = store.writes()
  await sleep(120)
  assert.equal(store.writes(), idle, 'a clean store is not rewritten')
  await store.close()
})

test('hit in the server: POST /org/hit stays 204 and lands on disk after ORG_HIT_FLUSH_MS', async () => {
  await withServer(0, { ...OPTS, orgHitFlushMs: 30 }, async ({ srv, backupDir }) => {
    const o = await mint(srv.port)
    const { id } = (await save(srv.port, o)).json
    for (let i = 0; i < 5; i++) assert.equal((await send(srv.port, '/org/hit', { event: id, kind: 'joined' })).status, 204)
    await sleep(120)
    const disk = JSON.parse(await fs.readFile(path.join(backupDir, 'organizers.json'), 'utf8'))
    assert.equal(disk.orgs[o.org].events[id].counts.joined, 5)
  })
})

// ---- (d) GET /org/event/<id>/public

test('GET /org/event/<id>/public: {name, logo} and nothing else; logo null when none', async () => {
  await withServer(0, OPTS, async ({ srv, lines }) => {
    const o = await mint(srv.port)
    const withLogo = (await save(srv.port, o, { event: { ...EVENT, logo: LOGO, organizer: 'Sample Org' }, invitees: ['someone@example.org'] })).json.id
    const plain = (await save(srv.port, o)).json.id
    const r = await pub(srv.port, withLogo)
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { name: 'Sample Meetup', logo: LOGO })
    assert.ok(!r.text.includes('example.org') && !r.text.includes(o.org) && !r.text.includes('counts'))
    assert.deepEqual((await pub(srv.port, plain)).json, { name: 'Sample Meetup', logo: null })
    assert.deepEqual(lines.filter((l) => /GET|POST/.test(l)), [], 'never logged')
  })
})

test('GET /org/event/<id>/public: unknown or malformed id 404, other methods 405, rate limited per address', async () => {
  await withServer(0, { ...OPTS, orgHitPerMinute: 2 }, async ({ srv }) => {
    assert.equal((await pub(srv.port, '0123456789abcdef')).status, 404)
    assert.equal((await pub(srv.port, 'XYZ')).status, 404)
    const post = await send(srv.port, '/org/event/0123456789abcdef/public', {})
    assert.equal(post.status, 405)
    assert.equal(post.headers.allow, 'GET')
    assert.equal((await pub(srv.port, '0123456789abcdef', { ip: '198.51.100.7' })).status, 404)
    assert.equal((await pub(srv.port, '0123456789abcdef', { ip: '198.51.100.7' })).status, 404)
    assert.equal((await pub(srv.port, '0123456789abcdef', { ip: '198.51.100.7' })).status, 429)
  })
})

test('event.logo: only a small png, jpeg or webp data URL; anything else is 400 field event.logo', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mint(srv.port)
    const bad = [
      'https://cdn.example.org/logo.png', // a third-party fetch would tell that host who opened the sheet
      'data:image/svg+xml;base64,PHN2Zy8+', // svg can carry script
      'data:image/png,notbase64',
      `data:image/png;base64,${'A'.repeat(9000)}`,
      42,
    ]
    for (const logo of bad) {
      const r = await save(srv.port, o, { event: { ...EVENT, logo } })
      assert.equal(r.status, 400, String(logo).slice(0, 40))
      assert.equal(r.json.field, 'event.logo')
    }
    assert.equal((await save(srv.port, o, { event: { ...EVENT, logo: LOGO } })).status, 201)
  })
})
