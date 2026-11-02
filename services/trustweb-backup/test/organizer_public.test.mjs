// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Organizer events, the join-sheet side: the optional `logo` event field, the 64 KB body cap of POST /org/event and GET /org/event/<id>/public.
// No fixed port (the server listens on port 0). Example addresses only.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadConfig } from '../config.mjs'
import { LOGO_RE, MAX_LOGO_CHARS, parseEvent } from '../organizer.mjs'
import { createOrgStore } from '../organizer_store.mjs'
import { call, withServer } from './helpers.mjs'
import { APP, BASE, send } from './connect_helpers.mjs'

const ORIGIN = `https://${APP}`
const LINK = `https://${APP}/#ev_host=abc123&n=Harvest`
const ROOM = { orgCreatePerMinute: 10000, orgCreatePerHour: 10000, orgWritePerMinute: 10000, orgWritePerHour: 10000, orgHitPerMinute: 10000, orgPublicPerMinute: 10000 }
const OPTS = { ...BASE, ...ROOM }
const EVENT = { name: 'Harvest Day', from: '2026-10-17 10:00', where: 'Village hall', themes: ['wine'], tagName: 'Harvest' }
const INVITEE = 'guest.one@example.at'
/** A logo of the right shape (the server checks the shape, not the picture). */
const logoOf = (mime = 'png', body = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==') =>
  `data:image/${mime};base64,${body}`
const LOGO = logoOf()
/** A logo of exactly `chars` characters. */
const logoSized = (chars) => {
  const head = 'data:image/png;base64,'
  return head + 'A'.repeat(chars - head.length)
}

const mintOrg = async (port) => {
  const r = await send(port, '/org', { name: 'Example Winery' })
  assert.equal(r.status, 201)
  return r.json
}
const me = (port, o, extra) => send(port, '/org/me', { org: o.org, secret: o.secret }, extra)
const save = (port, o, fields = {}, extra) => send(port, '/org/event', { org: o.org, secret: o.secret, event: EVENT, link: LINK, invitees: [INVITEE], ...fields }, extra)
const hit = (port, event, kind) => send(port, '/org/hit', { event, kind })
const pub = (port, id, extra = {}) => call(port, { url: `/org/event/${id}/public`, ...extra })
const settle = () => new Promise((r) => setTimeout(r, 150)) // lets a background counter write finish

test('LOGO_RE and MAX_LOGO_CHARS are exported with the contract values', () => {
  assert.equal(MAX_LOGO_CHARS, 32768)
  assert.equal(LOGO_RE.source, String.raw`^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$`)
  assert.deepEqual(parseEvent({ ...EVENT, logo: LOGO }).event, { ...EVENT, logo: LOGO })
  assert.deepEqual(parseEvent({ ...EVENT, logo: 'data:image/svg+xml;base64,AAAA' }), { field: 'event.logo' })
})

test('config: ORG_EVENT_MAX_BYTES defaults to 65536 and ORG_PUBLIC_PER_MINUTE to 120', () => {
  const cfg = loadConfig({ backupDir: os.tmpdir() })
  assert.equal(cfg.orgEventMaxBytes, 65536)
  assert.equal(cfg.orgPublicPerMinute, 120)
})

test('event.logo: png, jpeg, webp, gif data urls up to the cap are stored and returned by /org/me inside event', async () => {
  await withServer(0, { ...OPTS, orgMaxEvents: 10 }, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const logos = [logoOf('png'), logoOf('jpeg', 'AAAA'), logoOf('webp', 'AAA='), logoOf('gif', 'AA=='), logoSized(MAX_LOGO_CHARS)]
    for (const logo of logos) assert.equal((await save(srv.port, o, { event: { ...EVENT, logo } })).status, 201)
    const events = (await me(srv.port, o)).json.events
    assert.deepEqual(
      events.map((e) => e.event.logo),
      logos,
    )
    assert.deepEqual(events[0].event, { ...EVENT, logo: logos[0] })
  })
})

test('event.logo: anything else is 400 field event.logo and nothing is stored', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const bad = [
      logoOf('svg+xml'), // wrong mime
      'data:text/plain;base64,AAAA',
      'data:image/PNG;base64,AAAA',
      'data:image/png,AAAA', // not base64
      'data:image/png;base64,', // empty body
      'data:image/png;base64,AA-_', // url-safe alphabet
      'data:image/png;base64,AA AA',
      'data:image/png;base64,AAAA===',
      `${LOGO}\n`,
      ` ${LOGO}`,
      'https://example.at/logo.png',
      '',
      logoSized(MAX_LOGO_CHARS + 1), // over the cap
      5,
      null,
      true,
      [LOGO],
      { src: LOGO },
    ]
    for (const logo of bad) {
      const r = await save(srv.port, o, { event: { ...EVENT, logo } })
      assert.equal(r.status, 400, JSON.stringify(logo)?.slice(0, 60))
      assert.deepEqual([r.json.error, r.json.field], ['bad_request', 'event.logo'])
    }
    assert.deepEqual((await me(srv.port, o)).json.events, [])
  })
})

test('event.logo: an update without logo drops it; counts are kept', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o, { event: { ...EVENT, logo: LOGO } })).json
    await hit(srv.port, id, 'joined')
    await hit(srv.port, id, 'opened')
    const upd = await save(srv.port, o, { id })
    assert.equal(upd.status, 200)
    assert.deepEqual(upd.json.counts, { opened: 1, joined: 1, tagged: 0 })
    const [one] = (await me(srv.port, o)).json.events
    assert.deepEqual(one.event, EVENT)
    assert.equal('logo' in one.event, false)
    assert.deepEqual(one.counts, { opened: 1, joined: 1, tagged: 0 })
    assert.deepEqual(Object.keys((await pub(srv.port, id)).json), ['name'])
  })
})

test('bodies: about 20 KB is accepted on /org/event (201) and still 413 on /org/me; ORG_EVENT_MAX_BYTES is honoured', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const logo = logoSized(20 * 1024)
    const ok = await save(srv.port, o, { event: { ...EVENT, logo } })
    assert.equal(ok.status, 201)
    assert.equal((await pub(srv.port, ok.json.id)).json.logo, logo)
    const meBig = await send(srv.port, '/org/me', { org: o.org, secret: o.secret, pad: 'p'.repeat(20 * 1024) })
    assert.equal(meBig.status, 413)
    assert.equal(meBig.json.error, 'too_large')
    const hitBig = await send(srv.port, '/org/hit', { event: ok.json.id, kind: 'opened', pad: 'p'.repeat(20 * 1024) })
    assert.equal(hitBig.status, 413)
  })
  await withServer(0, { ...OPTS, orgEventMaxBytes: 8192 }, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    assert.equal((await save(srv.port, o, { event: { ...EVENT, logo: logoSized(10 * 1024) } })).status, 413)
    assert.equal((await save(srv.port, o, { event: { ...EVENT, logo: LOGO } })).status, 201)
  })
})

test('GET /org/event/<id>/public: 200 {name} without a logo and {name, logo} with one, nothing else', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const plain = (await save(srv.port, o, { event: { ...EVENT, to: '2026-10-18', conditions: 'Bring boots', organizer: 'Example Org' } })).json.id
    const withLogo = (await save(srv.port, o, { event: { ...EVENT, name: 'Harvest With Logo', logo: LOGO } })).json.id
    const a = await pub(srv.port, plain)
    assert.equal(a.status, 200)
    assert.match(a.headers['content-type'], /^application\/json/)
    assert.equal(a.headers['cache-control'], 'no-store')
    assert.deepEqual(Object.keys(a.json), ['name'])
    assert.deepEqual(a.json, { name: 'Harvest Day' })
    const b = await pub(srv.port, withLogo, { headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' } })
    assert.equal(b.status, 200)
    assert.deepEqual(Object.keys(b.json), ['name', 'logo'])
    assert.deepEqual(b.json, { name: 'Harvest With Logo', logo: LOGO })
  })
})

test('GET /org/event/<id>/public never carries an invitee address, the org code, the secret or the link', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o, { event: { ...EVENT, logo: LOGO }, invitees: [INVITEE, 'guest.two@example.at'] })).json
    await hit(srv.port, id, 'joined')
    const r = await pub(srv.port, id)
    assert.equal(r.status, 200)
    for (const secret of [INVITEE, 'guest.two@example.at', '@example.at', o.org, o.secret, LINK, 'ev_host', 'Village hall', 'counts', 'joined', 'invitees']) {
      assert.ok(!r.text.includes(secret), secret)
    }
  })
})

test('GET /org/event/<id>/public: an unknown, deleted or wrongly shaped id is the same 404 not_found', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o)).json
    const gone = (await save(srv.port, o)).json.id
    assert.equal((await send(srv.port, '/org/event', { org: o.org, secret: o.secret, id: gone, delete: true })).status, 204)
    const unknown = await pub(srv.port, 'f'.repeat(16))
    assert.equal(unknown.status, 404)
    assert.equal(unknown.json.error, 'not_found')
    const urls = [
      `/org/event/${gone}/public`,
      `/org/event/${id.toUpperCase()}/public`,
      `/org/event/${id.slice(1)}/public`,
      `/org/event/${id}0/public`,
      `/org/event/${'g'.repeat(16)}/public`,
      '/org/event//public',
      `/org/event/${id}/public/`,
      `/org/event/${id}/publicx`,
      `/org/event/${id}`,
      `/org/event/${id}/public?x=1`.replace(id, 'f'.repeat(16)),
    ]
    for (const url of urls) {
      const r = await call(srv.port, { url })
      assert.equal(r.status, 404, url)
      assert.equal(r.text, unknown.text, url)
    }
    assert.equal((await pub(srv.port, id)).status, 200)
  })
})

test('GET /org/event/<id>/public: any other method is 405 with Allow: GET', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o)).json
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const r = await call(srv.port, { method, url: `/org/event/${id}/public`, headers: { 'Content-Type': 'application/json', Connection: 'close' }, body: method === 'HEAD' ? undefined : '{}' })
      assert.equal(r.status, 405, method)
      assert.equal(r.headers.allow, 'GET', method)
    }
    assert.equal((await call(srv.port, { method: 'POST', url: '/org/event', headers: { Connection: 'close' } })).status, 415) // POST /org/event is untouched
  })
})

test('GET /org/event/<id>/public: Origin of another host, a non-https origin and Sec-Fetch-Site cross-site are 403 forbidden_origin', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o, { event: { ...EVENT, logo: LOGO } })).json
    for (const headers of [{ Origin: 'https://evil.example' }, { Origin: `http://${APP}` }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'Cross-Site', Origin: ORIGIN }]) {
      const r = await pub(srv.port, id, { headers })
      assert.equal(r.status, 403, JSON.stringify(headers))
      assert.equal(r.json.error, 'forbidden_origin')
      assert.ok(!r.text.includes('Harvest'))
    }
    for (const headers of [{ Origin: ORIGIN }, { 'Sec-Fetch-Site': 'same-origin' }, { 'Sec-Fetch-Site': 'none' }, {}]) {
      assert.equal((await pub(srv.port, id, { headers })).status, 200, JSON.stringify(headers))
    }
  })
})

test('GET /org/event/<id>/public: ORG_PUBLIC_PER_MINUTE per address (unknown ids count too), 429 rate_limited beyond, another address unaffected', async () => {
  await withServer(0, { ...OPTS, orgPublicPerMinute: 3 }, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o)).json
    assert.equal((await pub(srv.port, id, { ip: '203.0.113.5' })).status, 200)
    assert.equal((await pub(srv.port, 'f'.repeat(16), { ip: '203.0.113.5' })).status, 404)
    assert.equal((await pub(srv.port, id, { ip: '203.0.113.5' })).status, 200)
    const over = await pub(srv.port, id, { ip: '203.0.113.5' })
    assert.equal(over.status, 429)
    assert.equal(over.json.error, 'rate_limited')
    assert.ok(Number(over.headers['retry-after']) >= 1)
    assert.equal((await pub(srv.port, id, { ip: '203.0.113.6' })).status, 200)
    // its own limiter: the organizer's routes are not spent by public reads
    assert.equal((await me(srv.port, o, { ip: '203.0.113.5' })).status, 200)
    assert.equal((await hit(srv.port, id, 'opened')).status, 204)
  })
})

test('GET /org/event/<id>/public changes nothing: no `updated` stamp, no counter, no file write', async () => {
  await withServer(0, OPTS, async ({ srv, backupDir }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o, { event: { ...EVENT, logo: LOGO } })).json
    await hit(srv.port, id, 'tagged')
    await settle()
    const file = path.join(backupDir, 'organizers.json')
    const beforeFile = await fs.readFile(file, 'utf8')
    const beforeMe = (await me(srv.port, o)).json
    for (let i = 0; i < 5; i += 1) assert.equal((await pub(srv.port, id)).status, 200)
    await settle()
    assert.deepEqual((await me(srv.port, o)).json, beforeMe)
    assert.deepEqual(beforeMe.events[0].counts, { opened: 0, joined: 0, tagged: 1 })
    assert.equal(await fs.readFile(file, 'utf8'), beforeFile)
  })
})

test('the store: publicEvent(id) is read-only and returns {name} or {name, logo}, undefined when unknown', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twpub-'))
  try {
    let t = 1_800_000_000_000
    const store = await createOrgStore({ file: path.join(dir, 'org.json'), max: 10, limitsOf: () => ({ events: 3, invitees: 25 }), now: () => (t += 1000) })
    const secret = 'S'.repeat(43)
    const { org } = await store.create('Example Winery', secret)
    const plain = (await store.saveEvent(org, secret, { event: EVENT, link: LINK, invitees: [INVITEE] })).id
    const logo = (await store.saveEvent(org, secret, { event: { ...EVENT, logo: LOGO }, link: LINK, invitees: [INVITEE] })).id
    const before = JSON.stringify(await store.me(org, secret))
    const beforeFile = await fs.readFile(path.join(dir, 'org.json'), 'utf8')
    assert.deepEqual(store.publicEvent(plain), { name: EVENT.name })
    assert.deepEqual(Object.keys(store.publicEvent(plain)), ['name'])
    assert.deepEqual(store.publicEvent(logo), { name: EVENT.name, logo: LOGO })
    assert.equal(store.publicEvent('f'.repeat(16)), undefined)
    assert.equal(store.publicEvent('__proto__'), undefined)
    assert.equal(store.publicEvent('constructor'), undefined)
    await settle()
    assert.equal(JSON.stringify(await store.me(org, secret)), before)
    assert.equal(await fs.readFile(path.join(dir, 'org.json'), 'utf8'), beforeFile)
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 })
  }
})

test('never logged: public reads and logo saves write no "METHOD status" line and nothing with the logo or the name', async () => {
  await withServer(0, OPTS, async ({ srv, lines }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o, { event: { ...EVENT, logo: LOGO } })).json
    await pub(srv.port, id)
    await pub(srv.port, 'f'.repeat(16))
    assert.deepEqual(lines.filter((l) => /POST|GET/.test(l)), [])
    assert.ok(!lines.join('\n').includes(LOGO) && !lines.join('\n').includes(EVENT.name))
  })
})
