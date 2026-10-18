// Wave 15: the per-address cap on claimed names, the allow-list, the 30-day rest of a freed name and the previous-holder marker. No fixed port.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createConnectStore } from '../connect_store.mjs'
import { capFor, parseNameCapAllow } from '../name_cap.mjs'
import { ipKey } from '../limits.mjs'
import { call, withServer } from './helpers.mjs'
import { BASE, DAY, T0, claim, inTempDir, mint, readStore } from './connect_helpers.mjs'

const CAPPED = { ...BASE, nameCap: 3 }
const openCode = (port, code) => call(port, { url: `/c/${code}` })

test('name cap: the 4th claim from one address in 30 days (over several codes) is 429 name-cap with `until`; another address is fine; the window frees it', async () => {
  let t = T0
  await withServer(0, { ...CAPPED, now: () => t }, async ({ srv }) => {
    for (const n of ['ada', 'bob', 'cyd']) {
      assert.equal((await claim(srv.port, { name: n, ...(await mint(srv.port)) })).status, 200, n)
      t += DAY
    }
    const d = await mint(srv.port)
    const hit = await claim(srv.port, { name: 'dee', ...d })
    assert.equal(hit.status, 429)
    assert.equal(hit.json.error, 'name-cap')
    assert.equal(hit.json.until, T0 + 30 * DAY, 'the oldest claim leaves the window then')
    assert.equal((await claim(srv.port, { name: 'dee', ...d }, { ip: '203.0.113.9' })).status, 200, 'another address')
    t = T0 + 30 * DAY + 1
    assert.equal((await claim(srv.port, { name: 'eve', ...(await mint(srv.port)) })).status, 200, 'the first claim has left the window')
  })
})

test('name cap: promoting a held alias, a repeat claim and a read are no claims; a release does not give a claim back', async () => {
  await withServer(0, CAPPED, async ({ srv }) => {
    const a = await mint(srv.port)
    await claim(srv.port, { name: 'ada', ...a })
    await claim(srv.port, { name: 'bob', alias: true, ...a })
    for (let i = 0; i < 5; i += 1) assert.equal((await claim(srv.port, { name: i % 2 ? 'ada' : 'bob', ...a })).status, 200, 'promote swap')
    assert.equal((await claim(srv.port, { name: 'bob', alias: true, ...a })).status, 200)
    assert.equal((await claim(srv.port, { ...a })).status, 200, 'read')
    await claim(srv.port, { name: 'cyd', alias: true, ...a }) // 3rd claim
    assert.equal((await claim(srv.port, { release: 'cyd', ...a })).status, 200)
    assert.equal((await claim(srv.port, { name: 'dee', alias: true, ...a })).status, 429, 'releasing does not give the claim back')
  })
})

test('name cap: IPv6 counts by /64; the count survives a restart (persisted beside the names)', async () => {
  assert.equal(ipKey('2001:db8:1:2:aaaa::1'), ipKey('2001:db8:1:2:bbbb::9'))
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'connect.json')
    const t = T0
    const open = () => createConnectStore({ file, ttlMs: 365 * DAY, touchMs: DAY, max: 100, now: () => t })
    const secret = 's'.repeat(43)
    const addr = '2001:db8:1:2::/64'
    let store = await open()
    for (const n of ['ada', 'bob', 'cyd']) {
      const { code } = await store.mint('https://x.test/?connect=1', secret)
      assert.equal((await store.claim(code, secret, { name: n, addr, cap: 3 })).kind, 'named')
    }
    store = await open()
    const { code } = await store.mint('https://x.test/?connect=2', secret)
    assert.deepEqual(await store.claim(code, secret, { name: 'dee', addr, cap: 3 }), { kind: 'name_cap', until: T0 + 30 * DAY })
    assert.equal((await store.claim(code, secret, { name: 'dee', addr, cap: 4 })).kind, 'named', 'a higher cap lets it through')
    assert.equal(Object.values(JSON.parse(await fs.readFile(file, 'utf8')).claims)[0].length, 4)
  })
})

test('allow-list: parse keeps usable entries; capFor picks the highest matching cap by address, prefix or code', () => {
  const list = parseNameCapAllow(JSON.stringify([
    { addr: '203.0.113.7', cap: 20, note: 'organizer X, approved 2026-10-18' },
    { prefix: '2001:db8:1:', cap: 50, note: 'p' },
    { code: 'C'.repeat(22), cap: 9, note: 'c' },
    { addr: '198.51.100.1', cap: 0 },
    { cap: 5 },
    'junk',
  ]))
  assert.equal(list.length, 3)
  assert.equal(capFor(list, '203.0.113.7', 'x', 3), 20)
  assert.equal(capFor(list, '2001:db8:1:2::/64', 'x', 3), 50)
  assert.equal(capFor(list, '192.0.2.1', 'C'.repeat(22), 3), 9)
  assert.equal(capFor(list, '192.0.2.1', 'x', 3), 3)
  assert.equal(capFor(list, '203.0.113.7', 'x', 30), 30, 'never lowers the base')
  assert.deepEqual(parseNameCapAllow('not json'), [])
  assert.deepEqual(parseNameCapAllow('{}'), [])
})

test('allow-list file: an approved code claims past 3; SIGHUP re-reads the file', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'allow.json')
    await fs.writeFile(file, '[]')
    await withServer(0, { ...CAPPED, nameCapAllow: file }, async ({ srv }) => {
      for (const n of ['ada', 'bob', 'cyd']) await claim(srv.port, { name: n, ...(await mint(srv.port)) })
      const d = await mint(srv.port)
      assert.equal((await claim(srv.port, { name: 'dee', ...d })).status, 429)
      await fs.writeFile(file, JSON.stringify([{ code: d.code, cap: 10, note: 'organizer test, approved today' }]))
      process.emit('SIGHUP')
      assert.equal((await claim(srv.port, { name: 'dee', ...d })).status, 200)
    })
  })
})

test('rest: a freed name rests 30 days for other codes, the former holder reclaims at once; /c/ of the new holder carries prev=1 for 180 days', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, `https://app.example.test/?connect=did%3Apeer%3A2.second&id=p-2#t=x`)
    await claim(srv.port, { name: 'ada', ...a })
    await claim(srv.port, { release: 'ada', ...a })
    t += 10 * DAY
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 409, 'resting')
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200, 'the former holder reclaims at once')
    await claim(srv.port, { release: 'ada', ...a })
    t += 31 * DAY
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 200)
    assert.match((await openCode(srv.port, b.code)).headers.location, /[?&]prev=1(&|#|$)/)
    assert.match((await openCode(srv.port, b.code)).headers.location, /#t=x$/, 'the fragment stays')
    assert.doesNotMatch((await openCode(srv.port, a.code)).headers.location, /prev=1/)
    assert.equal(typeof (await readStore(backupDir)).codes[b.code].previousHolderAt, 'number')
    t += 181 * DAY
    assert.doesNotMatch((await openCode(srv.port, b.code)).headers.location, /prev=1/, 'after 180 days the marker is gone')
  })
})
