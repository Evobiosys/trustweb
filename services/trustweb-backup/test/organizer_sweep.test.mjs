// Organizer store housekeeping: hit counters flushed in the background (ORG_HIT_FLUSH_MS), /org/me touching `updated` (ORG_TOUCH_HOURS) and the sweeper
// honouring ORG_DAYS (ORG_SWEEP_MS). No fixed port (the server listens on port 0).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createOrgStore } from '../organizer_store.mjs'
import { withServer } from './helpers.mjs'
import { APP, BASE, DAY, T0, inTempDir, send } from './connect_helpers.mjs'

const LINK = `https://${APP}/#ev_host=abc123&n=Wine`
const EVENT = { name: 'Weinlese Wachau', from: '2026-10-17 10:00', where: 'Dürnstein' }
const ROOM = { orgCreatePerMinute: 10000, orgCreatePerHour: 10000, orgWritePerMinute: 10000, orgWritePerHour: 10000, orgHitPerMinute: 10000 }
const OPTS = { ...BASE, ...ROOM }
const S = 'S'.repeat(43)
const HOUR = 3_600_000
const limitsOf = () => ({ events: 3, invitees: 25 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'))
const ino = async (file) => (await fs.stat(file)).ino

const mintOrg = async (port) => {
  const r = await send(port, '/org', { name: 'Weingut Gruber' })
  assert.equal(r.status, 201)
  return r.json
}
const me = (port, o) => send(port, '/org/me', { org: o.org, secret: o.secret })

/** Polls `check` every 20 ms for up to 1 s. */
async function until(check) {
  for (let i = 0; i < 50; i += 1) {
    if (await check()) return
    await sleep(20)
  }
  assert.fail('condition not reached within 1 s')
}

test('hit only counts in memory: three hits leave the file untouched; flush() writes all three; a clean flush() writes nothing', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'organizers.json')
    const store = await createOrgStore({ file, max: 10, limitsOf, flushMs: 500 })
    try {
      const { org } = await store.create('Gruber', S)
      const { id } = await store.saveEvent(org, S, { event: EVENT, link: LINK, invitees: [] })
      const before = await ino(file)
      store.hit(id, 'opened')
      store.hit(id, 'opened')
      store.hit(id, 'joined')
      await sleep(100)
      assert.equal(await ino(file), before, 'no write per hit')
      assert.deepEqual((await readJson(file)).orgs[org].events[id].counts, { opened: 0, joined: 0, tagged: 0 })
      await store.flush()
      assert.deepEqual((await readJson(file)).orgs[org].events[id].counts, { opened: 2, joined: 1, tagged: 0 })
      const after = await ino(file)
      await store.flush()
      assert.equal(await ino(file), after, 'a clean flush writes nothing')
    } finally {
      await store.close()
    }
  })
})

test('the timer flushes on its own; a full commit carries pending counters and clears dirty', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'organizers.json')
    const store = await createOrgStore({ file, max: 10, limitsOf, flushMs: 20 })
    try {
      const { org } = await store.create('Gruber', S)
      const { id } = await store.saveEvent(org, S, { event: EVENT, link: LINK, invitees: [] })
      store.hit(id, 'tagged')
      await until(async () => (await readJson(file)).orgs[org].events[id].counts.tagged === 1)
    } finally {
      await store.close()
    }
    const slow = await createOrgStore({ file, max: 10, limitsOf, flushMs: 60_000 })
    try {
      const { org } = await slow.create('Zweiter', S)
      const { id } = await slow.saveEvent(org, S, { event: EVENT, link: LINK, invitees: [] })
      slow.hit(id, 'opened')
      await slow.saveEvent(org, S, { id, event: EVENT, link: LINK, invitees: ['a@x.at'] })
      assert.equal((await readJson(file)).orgs[org].events[id].counts.opened, 1)
      const after = await ino(file)
      await slow.flush()
      assert.equal(await ino(file), after, 'the commit cleared dirty')
    } finally {
      await slow.close()
    }
  })
})

test('a failed background write keeps the counters dirty and the next flush retries', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'organizers.json')
    const store = await createOrgStore({ file, max: 10, limitsOf, flushMs: 60_000 })
    try {
      const { org } = await store.create('Gruber', S)
      const { id } = await store.saveEvent(org, S, { event: EVENT, link: LINK, invitees: [] })
      store.hit(id, 'joined')
      await fs.rm(file)
      await fs.mkdir(file) // the rename now fails
      await assert.rejects(store.flush())
      await fs.rmdir(file)
      await store.flush()
      assert.equal((await readJson(file)).orgs[org].events[id].counts.joined, 1)
    } finally {
      await store.close()
    }
  })
})

test('server: a hit right before close() reaches the file (close flushes)', async () => {
  await withServer(0, { ...OPTS, orgHitFlushMs: 60_000 }, async ({ srv, backupDir }) => {
    const file = path.join(backupDir, 'organizers.json')
    const o = await mintOrg(srv.port)
    const ev = await send(srv.port, '/org/event', { org: o.org, secret: o.secret, event: EVENT, link: LINK, invitees: [] })
    assert.equal((await send(srv.port, '/org/hit', { event: ev.json.id, kind: 'opened' })).status, 204)
    assert.equal((await readJson(file)).orgs[o.org].events[ev.json.id].counts.opened, 0, 'not yet on disk')
    await srv.close()
    const reopened = await createOrgStore({ file, max: 10, limitsOf })
    try {
      assert.equal((await reopened.me(o.org, o.secret)).events[0].counts.opened, 1)
    } finally {
      await reopened.close()
    }
  })
})

test('me() refreshes `updated` only when older than touchMs, in memory; the file changes only on flush', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'organizers.json')
    let t = T0
    const store = await createOrgStore({ file, max: 10, limitsOf, flushMs: 60_000, touchMs: HOUR, now: () => t })
    try {
      const { org } = await store.create('Gruber', S)
      const first = await ino(file)
      t += HOUR / 2
      assert.equal((await store.me(org, S)).kind, 'ok')
      await store.flush()
      assert.equal(await ino(file), first, 'young: no touch, nothing to flush')
      assert.equal((await store.me(org, 'T'.repeat(43))).kind, 'forbidden') // a wrong secret never touches
      t += HOUR
      assert.equal((await store.me(org, S)).kind, 'ok')
      assert.equal(await ino(file), first, 'no write on read')
      assert.equal((await readJson(file)).orgs[org].updated, T0)
      await store.flush()
      assert.equal((await readJson(file)).orgs[org].updated, T0 + HOUR * 1.5)
      const second = await ino(file)
      await store.me(org, S)
      await store.flush()
      assert.equal(await ino(file), second, 'just touched: no second write')
    } finally {
      await store.close()
    }
  })
})

test('sweep(): an org untouched past ttl goes with its events; a younger one stays; a hit on a swept id changes nothing; idempotent', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'organizers.json')
    let t = T0
    let old
    const store = await createOrgStore({ file, max: 10, limitsOf, flushMs: 60_000, ttlMs: 10 * DAY, touchMs: 30 * DAY, now: () => t }) // touch out of the way: me() below must not write
    try {
      old = await store.create('Alt', S)
      const oldEv = await store.saveEvent(old.org, S, { event: EVENT, link: LINK, invitees: ['a@x.at'] })
      t += 5 * DAY
      const young = await store.create('Jung', S)
      const youngEv = await store.saveEvent(young.org, S, { event: EVENT, link: LINK, invitees: [] })
      t += 6 * DAY
      assert.deepEqual(await store.sweep(), { removed: 1 })
      assert.equal(store.size(), 1)
      assert.equal((await store.me(old.org, S)).kind, 'forbidden')
      assert.equal((await store.me(young.org, S)).events[0].id, youngEv.id)
      const text = await fs.readFile(file, 'utf8')
      assert.ok(!text.includes(old.org) && !text.includes(oldEv.id) && !text.includes('a@x.at'))
      const swept = await ino(file)
      store.hit(oldEv.id, 'opened')
      await store.flush()
      assert.equal(await ino(file), swept, 'a hit on a swept id is a no-op')
      assert.deepEqual(await store.sweep(), { removed: 0 })
      assert.equal(await ino(file), swept, 'nothing removed: no write')
    } finally {
      await store.close()
    }
    const reloaded = await createOrgStore({ file, max: 10, limitsOf })
    try {
      assert.equal(reloaded.size(), 1)
      assert.equal((await reloaded.me(old.org, S)).kind, 'forbidden')
    } finally {
      await reloaded.close()
    }
  })
})

test('server: ORG_DAYS 1 and ORG_SWEEP_MS 30: an org untouched for 2 days is swept and answers the unknown-org 403; a younger one stays', async () => {
  let t = T0
  await withServer(0, { ...OPTS, orgHitFlushMs: 20, orgDays: 1, orgSweepMs: 30, now: () => t }, async ({ srv, backupDir }) => {
    const file = path.join(backupDir, 'organizers.json')
    const old = await mintOrg(srv.port)
    t += 2 * DAY
    const young = await mintOrg(srv.port)
    await until(async () => (await readJson(file)).orgs[old.org] === undefined)
    const swept = await me(srv.port, old)
    const unknown = await me(srv.port, { org: 'A'.repeat(22), secret: old.secret })
    assert.equal(swept.status, 403)
    assert.equal(swept.text, unknown.text, 'no new oracle')
    assert.equal((await me(srv.port, young)).status, 200)
  })
})

test('server: an org kept alive by /org/me reads survives the sweep; an untouched one of the same age does not', async () => {
  let t = T0
  await withServer(0, { ...OPTS, orgHitFlushMs: 20, orgDays: 1, orgSweepMs: 30, orgTouchHours: 1, now: () => t }, async ({ srv, backupDir }) => {
    const file = path.join(backupDir, 'organizers.json')
    const reader = await mintOrg(srv.port)
    const idle = await mintOrg(srv.port)
    t += 12 * HOUR
    assert.equal((await me(srv.port, reader)).status, 200) // older than the touch interval: `updated` moves to now
    await until(async () => (await readJson(file)).orgs[reader.org].updated === T0 + 12 * HOUR)
    t += 18 * HOUR // idle is 30 h old, reader 18 h since its read
    await until(async () => (await readJson(file)).orgs[idle.org] === undefined)
    assert.ok((await readJson(file)).orgs[reader.org])
    assert.equal((await me(srv.port, reader)).status, 200)
  })
})
