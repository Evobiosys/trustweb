// Organizer accounts (wave 8): POST /org, /org/me, /org/event, /org/hit and POST /admin/org. No fixed port (the server listens on port 0).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { CODE_RE } from '../connect_names.mjs'
import { SECRET_RE } from '../connect_store.mjs'
import { parseEvent, parseInvitees, parseLink } from '../organizer.mjs'
import { createOrgStore } from '../organizer_store.mjs'
import { call, withServer } from './helpers.mjs'
import { APP, BASE, admin, send } from './connect_helpers.mjs'

const ORIGIN = `https://${APP}`
const LINK = `https://${APP}/#ev_host=abc123&n=Wine`
const ROOM = { orgCreatePerMinute: 10000, orgCreatePerHour: 10000, orgWritePerMinute: 10000, orgWritePerHour: 10000, orgHitPerMinute: 10000 }
const OPTS = { ...BASE, ...ROOM }
const EVENT = { name: 'Weinlese Wachau', from: '2026-10-17 10:00', where: 'Dürnstein', themes: ['wine', 'soil'], tagName: 'Weinlese' }

const org = (port, body = { name: 'Weingut Gruber' }, extra) => send(port, '/org', body, extra)
const me = (port, o, extra) => send(port, '/org/me', { org: o.org, secret: o.secret }, extra)
const save = (port, o, fields = {}, extra) => send(port, '/org/event', { org: o.org, secret: o.secret, event: EVENT, link: LINK, invitees: ['a@x.at'], ...fields }, extra)
const hit = (port, event, kind = 'opened', extra) => send(port, '/org/hit', { event, kind }, extra)
const mintOrg = async (port) => {
  const r = await org(port)
  assert.equal(r.status, 201)
  return r.json
}
const readFile = async (backupDir) => JSON.parse(await fs.readFile(path.join(backupDir, 'organizers.json'), 'utf8'))

test('POST /org: 201 {org, secret, plan, limits}; 22 and 43 characters; only sha256 of the secret is stored; file is 0600', async () => {
  await withServer(0, OPTS, async ({ srv, backupDir }) => {
    const r = await org(srv.port, { name: '  Weingut Gruber ' }, { headers: { Origin: ORIGIN } })
    assert.equal(r.status, 201)
    assert.match(r.json.org, CODE_RE)
    assert.match(r.json.secret, SECRET_RE)
    assert.equal(r.json.plan, 'free')
    assert.deepEqual(r.json.limits, { events: 3, invitees: 25 })
    const file = path.join(backupDir, 'organizers.json')
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    const text = await fs.readFile(file, 'utf8')
    assert.ok(!text.includes(r.json.secret))
    assert.equal(JSON.parse(text).orgs[r.json.org].name, 'Weingut Gruber')
    assert.match(JSON.parse(text).orgs[r.json.org].secretHash, /^[0-9a-f]{64}$/)
  })
})

test('POST /org: name 1..80 characters, else 400 field name', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    for (const name of [undefined, '', '   ', 'x'.repeat(81), 5, ['a']]) {
      const r = await org(srv.port, { name })
      assert.equal(r.status, 400)
      assert.equal(r.json.field, 'name')
    }
    assert.equal((await org(srv.port, { name: 'x'.repeat(80) })).status, 201)
  })
})

test('POST /org: past ORG_MAX_ORGS answers 503 full', async () => {
  await withServer(0, { ...OPTS, orgMax: 1 }, async ({ srv }) => {
    await mintOrg(srv.port)
    const r = await org(srv.port)
    assert.equal(r.status, 503)
    assert.equal(r.json.error, 'full')
  })
})

test('POST /org/me: name, plan, limits and the events with counts', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const empty = await me(srv.port, o)
    assert.equal(empty.status, 200)
    assert.deepEqual(empty.json, { name: 'Weingut Gruber', plan: 'free', limits: { events: 3, invitees: 25 }, events: [] })
    const made = (await save(srv.port, o)).json
    const list = (await me(srv.port, o)).json.events
    assert.equal(list.length, 1)
    assert.equal(list[0].id, made.id)
    assert.deepEqual(list[0].event, EVENT)
    assert.equal(list[0].link, LINK)
    assert.deepEqual(list[0].invitees, ['a@x.at'])
    assert.deepEqual(list[0].counts, { opened: 0, joined: 0, tagged: 0 })
    assert.ok(list[0].created > 0 && list[0].updated >= list[0].created)
  })
})

test('POST /org/event: create 201, update 200 keeps counts, delete 204', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const made = await save(srv.port, o)
    assert.equal(made.status, 201)
    assert.match(made.json.id, /^[0-9a-f]{16}$/)
    assert.deepEqual(made.json.counts, { opened: 0, joined: 0, tagged: 0 })
    await hit(srv.port, made.json.id, 'joined')
    const upd = await save(srv.port, o, { id: made.json.id, event: { ...EVENT, name: 'Weinlese 2' }, invitees: ['b@x.at', 'c@x.at'] })
    assert.equal(upd.status, 200)
    assert.equal(upd.json.id, made.json.id)
    assert.deepEqual(upd.json.counts, { opened: 0, joined: 1, tagged: 0 })
    const [one] = (await me(srv.port, o)).json.events
    assert.equal(one.event.name, 'Weinlese 2')
    assert.deepEqual(one.invitees, ['b@x.at', 'c@x.at'])
    const del = await send(srv.port, '/org/event', { org: o.org, secret: o.secret, id: made.json.id, delete: true })
    assert.equal(del.status, 204)
    assert.equal(del.text, '')
    assert.deepEqual((await me(srv.port, o)).json.events, [])
    const again = await send(srv.port, '/org/event', { org: o.org, secret: o.secret, id: made.json.id, delete: true })
    assert.equal(again.status, 404)
    assert.equal((await save(srv.port, o, { id: made.json.id })).status, 404)
  })
})

test('an id of another org is not found and changes nothing', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const a = await mintOrg(srv.port)
    const b = await mintOrg(srv.port)
    const ev = (await save(srv.port, a)).json
    assert.equal((await save(srv.port, b, { id: ev.id })).status, 404)
    assert.equal((await send(srv.port, '/org/event', { org: b.org, secret: b.secret, id: ev.id, delete: true })).status, 404)
    assert.equal((await me(srv.port, a)).json.events.length, 1)
  })
})

test('limits: the 4th event is 409 limit_events, 26 invitees are 409 limit_invitees; an update at the cap is fine', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const ids = []
    for (let i = 0; i < 3; i += 1) ids.push((await save(srv.port, o)).json.id)
    const over = await save(srv.port, o)
    assert.equal(over.status, 409)
    assert.equal(over.json.error, 'limit_events')
    assert.equal((await save(srv.port, o, { id: ids[0] })).status, 200)
    const many = Array.from({ length: 26 }, (_, i) => `p${i}@x.at`)
    const r = await save(srv.port, o, { id: ids[1], invitees: many })
    assert.equal(r.status, 409)
    assert.equal(r.json.error, 'limit_invitees')
    assert.equal((await save(srv.port, o, { id: ids[1], invitees: many.slice(0, 25) })).status, 200)
  })
})

test('wrong secret and unknown org answer a byte-identical 403, on every route that takes credentials', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const wrong = { org: o.org, secret: 'B'.repeat(43) }
    const unknown = { org: 'A'.repeat(22), secret: o.secret }
    const bodies = [
      ['/org/me', {}],
      ['/org/event', { event: EVENT, link: LINK, invitees: [] }],
      ['/org/event', { id: '0'.repeat(16), delete: true }],
    ]
    for (const [url, extra] of bodies) {
      const a = await send(srv.port, url, { ...wrong, ...extra })
      const b = await send(srv.port, url, { ...unknown, ...extra })
      assert.equal(a.status, 403, url)
      assert.equal(a.text, b.text, url)
      assert.equal(a.json.error, 'forbidden')
    }
  })
})

test('credentials of the wrong shape: 400 with the field', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const r = await send(srv.port, '/org/me', { org: 'short', secret: 'B'.repeat(43) })
    assert.equal(r.json.field, 'org')
    assert.equal((await send(srv.port, '/org/me', { org: 'A'.repeat(22), secret: 'x' })).json.field, 'secret')
  })
})

test('POST /org/hit: counts opened, joined, tagged; 204 for an unknown id; 400 for a bad kind or id shape', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o)).json
    for (const kind of ['opened', 'opened', 'joined', 'tagged', 'tagged', 'tagged']) assert.equal((await hit(srv.port, id, kind)).status, 204)
    assert.deepEqual((await me(srv.port, o)).json.events[0].counts, { opened: 2, joined: 1, tagged: 3 })
    const unknown = await hit(srv.port, 'f'.repeat(16))
    assert.equal(unknown.status, 204)
    assert.equal(unknown.text, '')
    assert.equal((await hit(srv.port, id, 'deleted')).status, 400)
    assert.equal((await hit(srv.port, 'xyz')).status, 400)
  })
})

test('POST /org/hit: counters reach the file; the file holds no address and no request data', async () => {
  await withServer(0, OPTS, async ({ srv, backupDir }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o)).json
    await hit(srv.port, id, 'opened', { ip: '203.0.113.77', headers: { 'User-Agent': 'phone-agent-marker' } })
    for (let i = 0; i < 40; i += 1) {
      if ((await readFile(backupDir)).orgs[o.org].events[id].counts.opened === 1) break
      await new Promise((r) => setTimeout(r, 25))
    }
    const text = await fs.readFile(path.join(backupDir, 'organizers.json'), 'utf8')
    assert.equal(JSON.parse(text).orgs[o.org].events[id].counts.opened, 1)
    assert.ok(!text.includes('203.0.113.77') && !text.includes('phone-agent-marker'))
  })
})

test('POST /org/hit: 60 per minute per address (the 61st is 429), another address is not affected', async () => {
  await withServer(0, { ...OPTS, orgHitPerMinute: 60 }, async ({ srv }) => {
    const id = 'a'.repeat(16)
    for (let i = 0; i < 60; i += 1) assert.equal((await hit(srv.port, id, 'opened', { ip: '203.0.113.1' })).status, 204)
    assert.equal((await hit(srv.port, id, 'opened', { ip: '203.0.113.1' })).status, 429)
    assert.equal((await hit(srv.port, id, 'opened', { ip: '203.0.113.2' })).status, 204)
  })
})

test('POST /org: 6 per minute per address', async () => {
  await withServer(0, { ...OPTS, orgCreatePerMinute: 6 }, async ({ srv }) => {
    for (let i = 0; i < 6; i += 1) assert.equal((await org(srv.port, { name: 'x' }, { ip: '203.0.113.9' })).status, 201)
    const r = await org(srv.port, { name: 'x' }, { ip: '203.0.113.9' })
    assert.equal(r.status, 429)
    assert.equal(r.json.error, 'rate_limited')
  })
})

test('invitees: trimmed, lowercased, duplicates collapsed; a bad address is 400 field invitees', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const r = await save(srv.port, o, { invitees: [' Anna@Beispiel.AT ', 'anna@beispiel.at', 'ben@beispiel.at'] })
    assert.equal(r.status, 201)
    assert.deepEqual((await me(srv.port, o)).json.events[0].invitees, ['anna@beispiel.at', 'ben@beispiel.at'])
    for (const bad of [['no-at'], ['a@b@c'], ['a b@x.at'], [''], [5], 'a@x.at', [`${'a'.repeat(250)}@x.at`]]) {
      const x = await save(srv.port, o, { invitees: bad })
      assert.equal(x.status, 400, JSON.stringify(bad))
      assert.equal(x.json.field, 'invitees')
    }
  })
})

test('event validation: required fields, caps, themes, link', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const bad = async (field, fields) => {
      const r = await save(srv.port, o, fields)
      assert.equal(r.status, 400, field)
      assert.equal(r.json.field, field)
    }
    await bad('event', { event: 'x' })
    await bad('event.name', { event: { ...EVENT, name: '' } })
    await bad('event.name', { event: { ...EVENT, name: 'x'.repeat(121) } })
    await bad('event.from', { event: { ...EVENT, from: undefined } })
    await bad('event.where', { event: { ...EVENT, where: 'x'.repeat(201) } })
    await bad('event.to', { event: { ...EVENT, to: 'x'.repeat(2001) } })
    await bad('event.conditions', { event: { ...EVENT, conditions: 5 } })
    await bad('event.themes', { event: { ...EVENT, themes: Array.from({ length: 21 }, () => 't') } })
    await bad('event.themes', { event: { ...EVENT, themes: ['x'.repeat(61)] } })
    await bad('event.tagName', { event: { ...EVENT, tagName: 'x'.repeat(61) } })
    await bad('event.organizer', { event: { ...EVENT, organizer: 'x'.repeat(81) } })
    await bad('link', { link: `https://${APP}/#other=1` })
    await bad('link', { link: `http://${APP}/#ev_host=1` })
    await bad('link', { link: 'https://evil.example/#ev_host=1' })
    await bad('link', { link: `https://${APP}/#ev_host=${'a'.repeat(4100)}` })
    await bad('link', { link: undefined })
    await bad('id', { id: 'nope' })
    const ok = await save(srv.port, o, { event: { name: 'N', from: 'F', where: 'W', to: '', unknown: 'dropped' } })
    assert.equal(ok.status, 201)
    assert.deepEqual((await me(srv.port, o)).json.events[0].event, { name: 'N', from: 'F', where: 'W' })
  })
})

test('parseEvent, parseLink, parseInvitees are pure and strict', () => {
  assert.deepEqual(parseEvent({ ...EVENT, to: ' ', organizer: ' Anna ' }).event, { ...EVENT, organizer: 'Anna' })
  assert.equal(parseLink(`https://${APP}:8443/#ev_host=1`, [APP]), null)
  assert.equal(parseLink(`https://u:p@${APP}/#ev_host=1`, [APP]), null)
  assert.equal(parseLink(`https://${APP}/?ev_host=1`, [APP]), null)
  assert.equal(parseLink(LINK, [APP]), LINK)
  assert.deepEqual(parseInvitees(undefined), [])
  assert.equal(parseInvitees({}), null)
})

test('Origin of another host and Sec-Fetch-Site cross-site are refused on every route; the own host passes', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    for (const url of ['/org', '/org/me', '/org/event', '/org/hit']) {
      const evil = await send(srv.port, url, { name: 'x', org: o.org, secret: o.secret }, { headers: { Origin: 'https://evil.example' } })
      assert.equal(evil.status, 403, url)
      const cross = await send(srv.port, url, { name: 'x', org: o.org, secret: o.secret }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })
      assert.equal(cross.status, 403, url)
    }
    assert.equal((await me(srv.port, o, { headers: { Origin: ORIGIN } })).status, 200)
  })
})

test('bodies: over 16 KB is 413 (declared or streamed), not JSON 400, wrong content type 415, GET 405', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    const big = await save(srv.port, o, { invitees: [`${'a'.repeat(200)}@x.at`].concat(Array.from({ length: 100 }, (_, i) => `${'b'.repeat(200)}${i}@x.at`)) })
    assert.equal(big.status, 413)
    const filler = JSON.stringify({ name: 'x', pad: 'p'.repeat(17 * 1024) })
    assert.equal((await send(srv.port, '/org', filler, { headers: { 'Transfer-Encoding': 'chunked' } })).status, 413)
    assert.equal((await send(srv.port, '/org', 'not json')).status, 400)
    assert.equal((await call(srv.port, { method: 'POST', url: '/org', headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415)
    assert.equal((await call(srv.port, { url: '/org' })).status, 405)
    assert.equal((await call(srv.port, { url: '/org/nothing' })).status, 404)
  })
})

test('POST /admin/org switches the plan and raises the limits; the guard is the admin guard', async () => {
  await withServer(0, OPTS, async ({ srv }) => {
    const o = await mintOrg(srv.port)
    for (let i = 0; i < 3; i += 1) await save(srv.port, o)
    assert.equal((await save(srv.port, o)).status, 409)
    const r = await admin(srv, { url: '/admin/org', body: { org: o.org, plan: 'hosted' } })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { org: o.org, plan: 'hosted', limits: { events: 50, invitees: 500 } })
    assert.equal((await save(srv.port, o)).status, 201)
    assert.equal((await save(srv.port, o, { invitees: Array.from({ length: 60 }, (_, i) => `p${i}@x.at`) })).status, 201)
    const state = (await me(srv.port, o)).json
    assert.equal(state.plan, 'hosted')
    assert.deepEqual(state.limits, { events: 50, invitees: 500 })
    assert.equal((await admin(srv, { url: '/admin/org', body: { org: o.org, plan: 'free' } })).json.plan, 'free')
    assert.equal((await admin(srv, { url: '/admin/org', body: { org: o.org, plan: 'gold' } })).json.field, 'plan')
    assert.equal((await admin(srv, { url: '/admin/org', body: { org: 'bad', plan: 'free' } })).json.field, 'org')
    assert.equal((await admin(srv, { url: '/admin/org', body: { org: 'A'.repeat(22), plan: 'free' } })).status, 404)
    assert.equal((await admin(srv, { url: '/admin/org', body: { org: o.org, plan: 'free' }, token: 'wrong' })).status, 401)
    assert.equal((await admin(srv, { url: '/admin/org', method: 'GET' })).status, 405)
    const publicHost = await admin(srv, { url: '/admin/org', body: { org: o.org, plan: 'hosted' }, host: APP })
    assert.notEqual(publicHost.status, 200)
    assert.equal((await me(srv.port, o)).json.plan, 'free')
  })
})

test('the store: reload keeps orgs, events and counts; a file that does not parse is moved aside; a failed write rolls back', async () => {
  await withServer(0, OPTS, async ({ dir }) => {
    const file = path.join(dir, 'org-store.json')
    const limitsOf = () => ({ events: 3, invitees: 25 })
    const first = await createOrgStore({ file, max: 10, limitsOf })
    const { org } = await first.create('Gruber', 'S'.repeat(43))
    const { id } = await first.saveEvent(org, 'S'.repeat(43), { event: EVENT, link: LINK, invitees: [] })
    first.hit(id, 'tagged')
    await new Promise((r) => setTimeout(r, 100))
    const second = await createOrgStore({ file, max: 10, limitsOf })
    const loaded = await second.me(org, 'S'.repeat(43))
    assert.equal(loaded.events[0].counts.tagged, 1)
    assert.equal((await second.me(org, 'T'.repeat(43))).kind, 'forbidden')
    await fs.writeFile(file, 'garbage')
    const third = await createOrgStore({ file, max: 10, limitsOf })
    assert.equal(third.recovered, true)
    assert.equal(third.size(), 0)
    await fs.access(`${file}.unreadable`)
    const created = await third.create('X', 'S'.repeat(43))
    await fs.rm(file)
    await fs.mkdir(file) // the rename now fails
    await assert.rejects(third.saveEvent(created.org, 'S'.repeat(43), { event: EVENT, link: LINK, invitees: [] }))
    assert.deepEqual((await third.me(created.org, 'S'.repeat(43))).events, [])
  })
})

test('never logged: no logger in the modules, no "METHOD status" line for /org paths, nothing on stdout or stderr', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const name of ['organizer.mjs', 'organizer_store.mjs']) {
    const source = await fs.readFile(path.join(here, '..', name), 'utf8')
    assert.ok(!/console\.|process\.std(out|err)|cfg\.log|\blog\(/.test(source.replace(/^\/\/.*$/gm, '')), name)
  }
  await withServer(0, OPTS, async ({ srv, lines }) => {
    const o = await mintOrg(srv.port)
    const { id } = (await save(srv.port, o)).json
    await hit(srv.port, id)
    await me(srv.port, o)
    await call(srv.port, { url: '/org/nothing' })
    assert.deepEqual(lines.filter((l) => /POST|GET/.test(l)), [])
    assert.ok(!lines.join('\n').includes(o.secret))
  })
})
