// Wave 6e admin routes (contract 10.9.3): the five-step guard, the token, grant / remove / list, and the production shape of the hosts. No fixed port.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { startServer } from '../server.mjs'
import { isAdminPath, permits, tokenMatches } from '../admin.mjs'
import { readAdminToken } from '../config.mjs'
import { call, withServer } from './helpers.mjs'
import { APP, BASE, DAY, JSON_H, T0, TOKEN, admin, claim, grant, inTempDir, mint, readStore, who } from './connect_helpers.mjs'

const fakeReq = (remoteAddress, headers) => ({ socket: { remoteAddress }, headers })
const PORT = 8960
/** The facts of an answer that must be identical between "the admin route that is not there" and "any unknown path". */
const shape = (r) => ({ status: r.status, text: r.text, type: r.headers['content-type'], cache: r.headers['cache-control'] })

// ---------------------------------------------------------------- the guard, steps 1 to 3 (pure)

test('guard step 1: only a loopback socket peer passes', () => {
  for (const peer of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(permits(fakeReq(peer, { host: `127.0.0.1:${PORT}` }), PORT), true, peer)
  for (const peer of ['203.0.113.5', '10.0.0.1', '::ffff:10.0.0.1', '2001:db8::1', '', undefined, '127.0.0.2']) assert.equal(permits(fakeReq(peer, { host: `127.0.0.1:${PORT}` }), PORT), false, String(peer))
  assert.equal(permits({ headers: { host: '127.0.0.1' } }, PORT), false, 'no socket at all')
})

test('guard step 2: the Host is exactly 127.0.0.1 or localhost, bare or with the BOUND port; never a public app host', () => {
  const ok = (host) => permits(fakeReq('127.0.0.1', { host }), PORT)
  for (const host of ['127.0.0.1', 'localhost', `127.0.0.1:${PORT}`, `localhost:${PORT}`]) assert.equal(ok(host), true, host)
  for (const host of [
    undefined, '', APP, 'app.idea2.site', 'app.idea2.site:8960', `${APP}:${PORT}`, '127.0.0.1:9999', 'localhost:9999', '127.0.0.1:', '127.0.0.1:08960', ` 127.0.0.1:${PORT}`,
    `LOCALHOST:${PORT}`, 'Localhost', `[::1]:${PORT}`, '::1', '127.0.0.1.evil.example', `127.0.0.1:${PORT}.evil.example`, `localhost:${PORT}@evil.example`, '0.0.0.0', '127.0.0.2',
  ]) assert.equal(ok(host), false, String(host))
})

test('guard step 3: any Forwarded, X-Forwarded-*, X-Real-IP or Origin header fails it, whatever its value', () => {
  const base = { host: `127.0.0.1:${PORT}` }
  const ok = (extra) => permits(fakeReq('127.0.0.1', { ...base, ...extra }), PORT)
  assert.equal(ok({}), true)
  assert.equal(ok({ 'x-admin-token': TOKEN, 'content-type': 'application/json', 'user-agent': 'curl/8' }), true, 'ordinary headers are fine')
  for (const header of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-port', 'x-forwarded-anything', 'x-real-ip', 'origin']) {
    for (const value of ['1.2.3.4', '', 'null']) assert.equal(ok({ [header]: value }), false, `${header}: ${value}`)
  }
})

test('isAdminPath: exactly the two routes', () => {
  assert.equal(isAdminPath('/admin/name'), true)
  assert.equal(isAdminPath('/admin/names'), true)
  for (const p of ['/admin', '/admin/', '/admin/name/', '/admin/other', '/ADMIN/name', '/admin/names/x', '/name', '/backup/admin/name']) assert.equal(isAdminPath(p), false, p)
})

test('guard step 5: tokenMatches is a constant-time comparison of two sha256 digests (right, wrong, missing, repeated, other lengths)', () => {
  assert.equal(tokenMatches(TOKEN, TOKEN), true)
  assert.equal(tokenMatches(TOKEN.slice(0, -1) + 'c', TOKEN), false)
  for (const bad of [undefined, '', 'x', TOKEN + 'a', TOKEN.slice(1), [TOKEN], null, 5]) assert.equal(tokenMatches(bad, TOKEN), false, String(bad))
})

test('the token file: JSON {"token": "<64 hex>"} from ADMIN_TOKEN_FILE or <CREDENTIALS_DIRECTORY>/admin; anything else is "no token"', async () => {
  await inTempDir(async (dir) => {
    const good = path.join(dir, 'good.json')
    await fs.writeFile(good, JSON.stringify({ token: TOKEN }))
    assert.equal(readAdminToken({ ADMIN_TOKEN_FILE: good }), TOKEN)
    await fs.writeFile(path.join(dir, 'admin'), JSON.stringify({ token: 'cd'.repeat(32) }))
    assert.equal(readAdminToken({ CREDENTIALS_DIRECTORY: dir }), 'cd'.repeat(32))
    assert.equal(readAdminToken({ CREDENTIALS_DIRECTORY: dir, ADMIN_TOKEN_FILE: good }), TOKEN, 'ADMIN_TOKEN_FILE overrides')
    for (const [name, content] of [['short', { token: 'ab' }], ['upper', { token: 'AB'.repeat(32) }], ['key', { key: TOKEN }], ['num', { token: 5 }], ['arr', [TOKEN]]]) {
      await fs.writeFile(path.join(dir, name), JSON.stringify(content))
      assert.equal(readAdminToken({ ADMIN_TOKEN_FILE: path.join(dir, name) }), '', name)
    }
    await fs.writeFile(path.join(dir, 'garbage'), 'not json')
    assert.equal(readAdminToken({ ADMIN_TOKEN_FILE: path.join(dir, 'garbage') }), '')
    assert.equal(readAdminToken({ ADMIN_TOKEN_FILE: path.join(dir, 'missing') }), '')
    assert.equal(readAdminToken({}), '')
    assert.equal(readAdminToken({ CREDENTIALS_DIRECTORY: '' }), '')
  })
})

// ---------------------------------------------------------------- the guard over HTTP

test('a request that fails the guard is answered by the UNCHANGED pipeline, byte for byte like an unknown path (public Host, foreign Origin, forwarding headers)', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const local = `127.0.0.1:${srv.port}`
    const probes = [
      { host: APP, headers: { 'X-Admin-Token': TOKEN } }, // a public app host (what Caddy forwards)
      // EXACTLY what Caddy relays from the internet: socket 127.0.0.1, the public Host kept, and its default X-Forwarded-For/-Proto/-Host (wave 6e review)
      { host: APP, headers: { 'X-Admin-Token': TOKEN, 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': APP } },
      { host: 'evil.example.com', headers: { 'X-Admin-Token': TOKEN } }, // 421
      { host: local, headers: { 'X-Admin-Token': TOKEN, 'X-Forwarded-For': '203.0.113.7' } },
      { host: local, headers: { 'X-Admin-Token': TOKEN, 'X-Real-IP': '203.0.113.7' } },
      { host: local, headers: { 'X-Admin-Token': TOKEN, Forwarded: 'for=203.0.113.7' } },
      { host: local, headers: { 'X-Admin-Token': TOKEN, 'X-Forwarded-Proto': 'https' } },
      { host: local, headers: { 'X-Admin-Token': TOKEN, Origin: 'https://evil.example.com' } }, // 403
      { host: local, headers: { 'X-Admin-Token': TOKEN, Origin: `https://${APP}` } },
      { host: `127.0.0.1:${srv.port + 1}`, headers: { 'X-Admin-Token': TOKEN } }, // not the bound port
    ]
    for (const method of ['GET', 'POST', 'DELETE']) {
      for (const probe of probes) {
        for (const url of ['/admin/names', '/admin/name']) {
          const asked = await call(srv.port, { method, url, ...probe, headers: { Connection: 'close', ...JSON_H, ...probe.headers }, body: method === 'GET' ? undefined : '{}' })
          const unknown = await call(srv.port, { method, url: '/zz/zz', ...probe, headers: { Connection: 'close', ...JSON_H, ...probe.headers }, body: method === 'GET' ? undefined : '{}' })
          assert.deepEqual(shape(asked), shape(unknown), `${method} ${url} ${JSON.stringify(probe)}`)
        }
      }
    }
    // and the three kinds of answer really occur (so the comparison is not vacuous)
    const statuses = new Set()
    for (const probe of probes) statuses.add((await call(srv.port, { url: '/zz/zz', ...probe, headers: { ...probe.headers, Connection: 'close' } })).status)
    assert.deepEqual([...statuses].sort(), [400, 403, 421])
  })
})

test('PRODUCTION SHAPE: ALLOWED_HOSTS lists only the public app hosts; the admin route still works with Host 127.0.0.1:<port> (it is dispatched before the Host gate)', async () => {
  await withServer(0, { ...BASE, allowedHosts: [APP] }, async ({ srv }) => {
    const unknown = await call(srv.port, { url: '/zz/zz', host: `127.0.0.1:${srv.port}` })
    assert.equal(unknown.status, 421, 'any other route with that Host is 421 here')
    const names = await admin(srv, { method: 'GET', url: '/admin/names' })
    assert.equal(names.status, 200)
    assert.deepEqual(names.json, { reserved: [{ name: 'japossert', code: null }, { name: 'jakob', code: null }] })
    for (const host of ['localhost', `localhost:${srv.port}`, '127.0.0.1']) assert.equal((await admin(srv, { method: 'GET', url: '/admin/names', host })).status, 200, host)
    const publicHost = await admin(srv, { method: 'GET', url: '/admin/names', host: APP })
    assert.equal(publicHost.status, 400, 'the public host is not the admin: plain "bad id", like any unknown path')
    assert.equal(publicHost.text, 'bad id')
    const a = await mint(srv.port)
    assert.equal((await grant(srv, a.code, 'japossert')).status, 200)
  })
})

test('PRODUCTION HOSTS, the request Caddy relays: Host app.trustweb.one from 127.0.0.1 with X-Forwarded-*, even WITH the right token, is answered like an unknown path and changes nothing', async () => {
  const hosts = ['app.idea2.site', 'app.trustintheweb.org', 'app.trustweb.one']
  await withServer(0, { ...BASE, allowedHosts: [...hosts, APP] }, async ({ srv }) => { // APP only so the test can mint with its stand-in long url
    const a = await mint(srv.port)
    const relayed = { 'X-Admin-Token': TOKEN, 'X-Forwarded-For': '203.0.113.7', 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'app.trustweb.one' }
    for (const headers of [relayed, { 'X-Admin-Token': TOKEN }]) {
      for (const [method, url, body] of [['GET', '/admin/names', undefined], ['POST', '/admin/name', { code: a.code, name: 'japossert' }], ['DELETE', '/admin/name', { code: a.code, name: 'japossert' }]]) {
        const text = body === undefined ? undefined : JSON.stringify(body)
        const req = (path) => call(srv.port, { method, url: path, host: 'app.trustweb.one', headers: { Connection: 'close', ...JSON_H, ...headers }, body: text })
        const asked = await req(url)
        assert.deepEqual(shape(asked), shape(await req('/zz/zz')), `${method} ${url} ${Object.keys(headers).join(',')}`)
        assert.equal(asked.status, 400, 'the plain "bad id" of an unknown path, never a JSON admin answer')
        assert.equal(asked.text, 'bad id')
      }
    }
    const read = await claim(srv.port, { code: a.code, secret: a.secret })
    assert.deepEqual(read.json, { name: '', aliases: [], locked: [] }, 'nothing was granted through the public host')
  })
})

// ---------------------------------------------------------------- steps 4 and 5

test('step 4: no token configured is 503 not_configured (for every method, with or without a token header)', async () => {
  await withServer(0, { ...BASE, adminToken: '' }, async ({ srv }) => {
    for (const [method, url] of [['GET', '/admin/names'], ['POST', '/admin/name'], ['DELETE', '/admin/name'], ['PUT', '/admin/name']]) {
      for (const token of [TOKEN, null, 'x']) {
        const r = await admin(srv, { method, url, token, body: method === 'GET' ? undefined : {} })
        assert.equal(r.status, 503, `${method} ${url}`)
        assert.equal(r.json.error, 'not_configured')
      }
    }
  })
})

test('step 5: a missing, wrong or odd token is 401 unauthorized before the method, the content type, the size or the body are looked at', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    const cases = [
      { token: null },
      { token: '' },
      { token: 'ab'.repeat(31) + 'ac' },
      { token: TOKEN.toUpperCase() },
      { token: TOKEN.slice(0, -1) }, // one character short (a trailing space would be trimmed by the HTTP parser, not by us)
      { token: 'x'.repeat(5000) },
    ]
    for (const c of cases) {
      t += 61_000 // every case starts with a fresh failed-token budget (5 a minute, see the next test)
      for (const [method, url, body] of [['GET', '/admin/names'], ['POST', '/admin/name', { code: a.code, name: 'japossert' }], ['DELETE', '/admin/name', { code: a.code, name: 'ada' }], ['PUT', '/admin/name', 'x'], ['POST', '/admin/name', 'not json']]) {
        const r = await admin(srv, { method, url, body, ...c, headers: body === 'not json' ? { 'Content-Type': 'text/plain' } : {} })
        assert.equal(r.status, 401, `${method} ${url} ${String(c.token).slice(0, 8)}`)
        assert.deepEqual(r.json, { error: 'unauthorized', message: 'Not authorized.' })
      }
    }
    assert.equal((await who(srv.port, 'japossert')).status, 404, 'nothing was granted')
    assert.equal((await readStore(backupDir)).codes[a.code].name, undefined)
  })
})

test('failed tokens are counted per address: the 6th in a minute is 429 with Retry-After, even for the right token, until the minute has passed', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv }) => {
    for (let i = 0; i < 5; i += 1) assert.equal((await admin(srv, { method: 'GET', url: '/admin/names', token: 'ff'.repeat(32) })).status, 401, `attempt ${i + 1}`)
    const blocked = await admin(srv, { method: 'GET', url: '/admin/names', token: 'ff'.repeat(32) })
    assert.equal(blocked.status, 429)
    assert.equal(blocked.json.error, 'rate_limited')
    assert.ok(Number(blocked.headers['retry-after']) >= 1 && Number(blocked.headers['retry-after']) <= 60)
    assert.equal((await admin(srv, { method: 'GET', url: '/admin/names' })).status, 429, 'the right token waits too')
    t += 61_000
    assert.equal((await admin(srv, { method: 'GET', url: '/admin/names' })).status, 200)
    assert.equal((await admin(srv, { method: 'GET', url: '/admin/names', token: 'ff'.repeat(32) })).status, 401, 'and the count starts again')
  })
})

test('the general per-address limiter counts admin requests too (429 rate_limited past the server limit)', async () => {
  await withServer(0, { ...BASE, rateLimit: 3 }, async ({ srv }) => {
    for (let i = 0; i < 3; i += 1) assert.equal((await admin(srv, { method: 'GET', url: '/admin/names' })).status, 200)
    assert.equal((await admin(srv, { method: 'GET', url: '/admin/names' })).status, 429)
  })
})

// ---------------------------------------------------------------- the routes

test('POST /admin/name: grants a reserved name to an existing code; the app then reads it (READ), /who/ resolves it, the file keeps it', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    const r = await grant(srv, a.code, 'japossert')
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { name: 'japossert', aliases: [], locked: ['japossert'] })
    assert.deepEqual((await claim(srv.port, a)).json, { name: 'japossert', aliases: [], locked: ['japossert'] }, 'the app learns the granted name by READ')
    assert.equal((await who(srv.port, 'japossert')).headers.location, `https://${APP}/c/${a.code}`)
    assert.equal((await readStore(backupDir)).codes[a.code].name, 'japossert')
    assert.equal(r.text.includes(a.code), false, 'the answer carries no code')
  })
})

test('POST /admin/name: the old primary is DEMOTED to an alias (not freed); alias:true adds; a held alias swaps; idempotent; the cap is 3', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    await claim(srv.port, { name: 'ada', ...a })
    assert.deepEqual((await grant(srv, a.code, 'japossert')).json, { name: 'japossert', aliases: ['ada'], locked: ['japossert'] })
    assert.equal((await who(srv.port, 'ada')).status, 302, 'the demoted name still resolves')
    assert.deepEqual((await grant(srv, a.code, 'jakob', true)).json, { name: 'japossert', aliases: ['ada', 'jakob'], locked: ['japossert', 'jakob'] })
    assert.deepEqual((await grant(srv, a.code, 'jakob', true)).json, { name: 'japossert', aliases: ['ada', 'jakob'], locked: ['japossert', 'jakob'] }, 'idempotent')
    assert.deepEqual((await grant(srv, a.code, 'japossert')).json, { name: 'japossert', aliases: ['ada', 'jakob'], locked: ['japossert', 'jakob'] }, 'idempotent as primary')
    assert.deepEqual((await grant(srv, a.code, 'jakob')).json, { name: 'jakob', aliases: ['japossert', 'ada'], locked: ['jakob', 'japossert'] }, 'a held alias granted as primary swaps')
    const over = await grant(srv, a.code, 'fourth.name')
    assert.equal(over.status, 409)
    assert.deepEqual(over.json, { error: 'too_many_names', message: 'A code can hold up to 3 names.', field: 'name' })
    assert.equal((await grant(srv, a.code, 'fourth.name', true)).status, 409)
  })
})

test('POST /admin/name: a name held by another code is 409 name_taken; an unknown or expired code is 404 unknown_code; granting also keeps the code alive', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, 'https://app.example.test/?connect=other')
    await claim(srv.port, { name: 'ada', ...a })
    const taken = await grant(srv, b.code, 'ada')
    assert.equal(taken.status, 409)
    assert.deepEqual(taken.json, { error: 'name_taken', message: 'That name is taken.', field: 'name' })
    const none = await grant(srv, 'Z'.repeat(22), 'japossert')
    assert.equal(none.status, 404)
    assert.deepEqual(none.json, { error: 'unknown_code', message: 'No such code.' })
    t += 400 * DAY
    assert.equal((await grant(srv, a.code, 'japossert')).status, 404, 'an expired code is unknown')
  })
})

test('POST /admin/name: shape errors name the field (code, name, alias); bad JSON, wrong type, over 2 KB; other methods are 405 with Allow', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const field = async (body) => {
      const r = await admin(srv, { body })
      assert.equal(r.status, 400, JSON.stringify(body))
      return r.json.field
    }
    assert.equal(await field({ name: 'japossert' }), 'code')
    assert.equal(await field({ code: 'short', name: 'japossert' }), 'code')
    assert.equal(await field({ code: a.code }), 'name')
    for (const name of ['Japossert', '@x', 'ab', 5, null, 'a'.repeat(22), 'japossert!']) assert.equal(await field({ code: a.code, name }), 'name', String(name))
    assert.equal(await field({ code: a.code, name: 'japossert', alias: 'true' }), 'alias')
    assert.equal((await admin(srv, { body: '[1]' })).status, 400)
    assert.equal((await admin(srv, { body: 'not json' })).status, 400)
    assert.equal((await admin(srv, { body: { code: a.code, name: 'japossert' }, headers: { 'Content-Type': 'text/plain' } })).status, 415)
    const big = await admin(srv, { body: JSON.stringify({ code: a.code, name: 'japossert', pad: 'x'.repeat(2100) }) })
    assert.equal(big.status, 413)
    for (const method of ['PUT', 'PATCH', 'GET']) {
      const r = await admin(srv, { method, url: '/admin/name', body: method === 'GET' ? undefined : {} })
      assert.equal(r.status, 405, method)
      assert.equal(r.headers.allow, 'POST, DELETE')
    }
    const names = await admin(srv, { method: 'POST', url: '/admin/names', body: {} })
    assert.equal(names.status, 405)
    assert.equal(names.headers.allow, 'GET')
    assert.equal((await who(srv.port, 'japossert')).status, 404, 'no refused request granted anything')
  })
})

test('DELETE /admin/name: removes a name, a LOCKED one too, with promotion; not_held and unknown_code are 404', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    await claim(srv.port, { name: 'ada', ...a })
    await grant(srv, a.code, 'japossert')
    await grant(srv, a.code, 'jakob', true)
    const locked = await claim(srv.port, { release: 'jakob', ...a })
    assert.equal(locked.json.error, 'name_locked')
    const del = (body) => admin(srv, { method: 'DELETE', body })
    assert.deepEqual((await del({ code: a.code, name: 'jakob' })).json, { name: 'japossert', aliases: ['ada'], locked: ['japossert'] })
    assert.equal((await who(srv.port, 'jakob')).status, 404)
    assert.deepEqual((await del({ code: a.code, name: 'japossert' })).json, { name: 'ada', aliases: [], locked: [] }, 'the first alias is promoted')
    assert.deepEqual((await claim(srv.port, a)).json, { name: 'ada', aliases: [], locked: [] })
    const notHeld = await del({ code: a.code, name: 'japossert' })
    assert.equal(notHeld.status, 404)
    assert.deepEqual(notHeld.json, { error: 'not_held', message: 'The code does not hold that name.' })
    assert.equal((await del({ code: 'Z'.repeat(22), name: 'ada' })).json.error, 'unknown_code')
    assert.equal((await del({ code: a.code, name: 'Ada' })).json.field, 'name')
    assert.equal((await claim(srv.port, { name: 'japossert', ...a })).json.error, 'reserved', 'a removed grant is reserved again for the app')
  })
})

test('GET /admin/names: one row per env reserved name with its holder (null when free), plus a held name that only matches after squashing; nothing else is listed', async () => {
  await withServer(0, { ...BASE, reservedNames: ['japossert', 'jakob'] }, async ({ srv }) => {
    const a = await mint(srv.port)
    const squatter = await mint(srv.port, 'https://app.example.test/?connect=squat')
    const bystander = await mint(srv.port, 'https://app.example.test/?connect=by')
    await claim(srv.port, { name: 'bystander.name', ...bystander })
    await grant(srv, a.code, 'japossert')
    await grant(srv, squatter.code, 'ja-kob') // held although it only squashes to jakob
    const list = (await admin(srv, { method: 'GET', url: '/admin/names' })).json
    assert.deepEqual(list, { reserved: [{ name: 'japossert', code: a.code }, { name: 'jakob', code: null }, { name: 'ja-kob', code: squatter.code }] })
    assert.equal(JSON.stringify(list).includes('bystander'), false)
    assert.equal(JSON.stringify(list).includes(bystander.code), false)
    await grant(srv, squatter.code, 'jakob')
    assert.deepEqual((await admin(srv, { method: 'GET', url: '/admin/names' })).json.reserved.map((r) => r.name), ['japossert', 'jakob', 'ja-kob'])
  })
})

test('GET /admin/names with an empty RESERVED_NAMES lists nothing', async () => {
  await withServer(0, { ...BASE, reservedNames: [] }, async ({ srv }) => {
    assert.deepEqual((await admin(srv, { method: 'GET', url: '/admin/names' })).json, { reserved: [] })
  })
})

test('the connect store being off makes the admin routes 503 not_configured (after a valid guard), never a crash', async () => {
  await inTempDir(async (dir) => {
    const srv = await startServer({
      dir: path.join(dir, 'backup'),
      allowedHosts: [APP],
      port: 0,
      log: () => undefined,
      ...BASE,
      connectFile: path.join(dir, 'no-such-dir', 'x', 'connect.json'),
    })
    try {
      assert.equal((await admin(srv, { method: 'GET', url: '/admin/names' })).status, 503)
      assert.equal((await admin(srv, { body: { code: 'A'.repeat(22), name: 'japossert' } })).json.error, 'not_configured')
    } finally {
      await srv.close()
    }
  })
})

// ---------------------------------------------------------------- logging

test('LOGGING: a successful grant or removal logs exactly "admin grant"; reads, refusals and failures log nothing; a request that failed the guard logs like any unknown route', async () => {
  await withServer(0, BASE, async ({ srv, lines }) => {
    const a = await mint(srv.port)
    assert.deepEqual(lines, [])
    await grant(srv, a.code, 'japossert') // 200
    await admin(srv, { method: 'DELETE', body: { code: a.code, name: 'japossert' } }) // 200
    assert.deepEqual(lines, ['admin grant', 'admin grant'])
    lines.length = 0
    await admin(srv, { method: 'GET', url: '/admin/names' }) // 200 read
    await admin(srv, { method: 'GET', url: '/admin/names', token: 'ff'.repeat(32) }) // 401
    await grant(srv, 'Z'.repeat(22), 'japossert') // 404
    await admin(srv, { body: { code: a.code } }) // 400
    assert.deepEqual(lines, [])
    await call(srv.port, { url: '/admin/names', host: APP }) // fails the guard: an unknown path
    assert.deepEqual(lines, ['GET 400'])
    const everything = lines.join('\n')
    for (const secret of [TOKEN, a.code, a.secret, 'japossert']) assert.equal(everything.includes(secret), false)
  })
})

test('server.mjs wiring: the admin dispatch sits in the request handler before route() and its Host gate, the bound port is used, and the quiet lists are untouched', async () => {
  const text = await fs.readFile(new URL('../server.mjs', import.meta.url), 'utf8')
  assert.ok(text.indexOf('adminPermits(req, boundPort)') < text.indexOf('route(req, res)\n      .then'), 'admin is dispatched before route()')
  assert.match(text, /boundPort = typeof address === 'object'/)
  assert.match(text, /const isConnectPath = \(pathname\) => pathname === '\/connect'/)
})
