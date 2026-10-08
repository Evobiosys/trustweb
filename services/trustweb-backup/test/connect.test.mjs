// Connect codes and usernames (wave 6b): POST /connect, GET /c/<code>, POST /name, GET /who/<name>. No fixed port (the server listens on port 0).
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server.mjs'
import { CODE_RE, NAME_RE, isClaimableName, isReserved } from '../connect_names.mjs'
import { createConnectStore, SECRET_RE } from '../connect_store.mjs'
import { call, HOST, withServer } from './helpers.mjs'

const APP = 'app.example.test'
const ORIGIN = `https://${APP}`
const LONG = `https://${APP}/?connect=did%3Apeer%3A2.Ez6LSdistinctiveDIDmarker&id=p-1#t=Ada-demo&a=0123456789abcdef&pn=Gro%C3%9F`
const LONG2 = `https://${APP}/?connect=did%3Apeer%3A2.Ez6LSsecondDIDmarker&id=p-2#t=Ada-demo2`
const JSON_H = { 'Content-Type': 'application/json' }
const LINKS = { linkHosts: [APP] }
/** Limits out of the way (most tests post and read a lot from one address). */
const ROOMY = { connectPerMinute: 10000, connectPerHour: 10000, connectGetPerMinute: 10000, connectGetPerHour: 10000, rateLimit: 100000 }
const BASE = { ...LINKS, ...ROOMY }
const DAY = 86_400_000
const T0 = 1_800_000_000_000
const OTHER_CODE = 'A'.repeat(22)
const OTHER_SECRET = 'B'.repeat(43)

const send = (port, url, body, extra = {}) =>
  call(port, { method: 'POST', url, headers: { ...JSON_H, ...extra.headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ip: extra.ip, host: extra.host })
const connect = (port, body, extra) => send(port, '/connect', body, extra)
const claim = (port, body, extra) => send(port, '/name', body, extra)
const openCode = (port, code, extra = {}) => call(port, { url: `/c/${code}`, ...extra })
const who = (port, name, extra = {}) => call(port, { url: `/who/${name}`, ...extra })
const mint = async (port, url = LONG) => {
  const r = await connect(port, { url })
  assert.equal(r.status, 201)
  return r.json
}
const readStore = async (backupDir) => JSON.parse(await fs.readFile(path.join(backupDir, 'connect.json'), 'utf8'))
const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms))
const sha256hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

async function inTempDir(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twconnect-'))
  try {
    await body(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }) // a background rewrite may still be finishing
  }
}

const serverOptions = (dir, extra = {}) => ({ dir: path.join(dir, 'backup'), allowedHosts: [HOST, '127.0.0.1'], port: 0, log: () => undefined, ...BASE, ...extra })

// ---------------------------------------------------------------- mint

test('POST /connect mint: 201 {code, secret, url}; the code is 22 base64url characters, the secret 43; JSON, no-store; the url is the short link on the request host', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const r = await connect(srv.port, { url: LONG }, { headers: { Origin: ORIGIN } })
    assert.equal(r.status, 201)
    assert.match(r.json.code, CODE_RE)
    assert.match(r.json.secret, SECRET_RE)
    assert.equal(r.json.url, `${ORIGIN}/c/${r.json.code}`)
    assert.deepEqual(Object.keys(r.json).sort(), ['code', 'secret', 'url'])
    assert.match(r.headers['content-type'], /^application\/json/)
    assert.equal(r.headers['cache-control'], 'no-store')
  })
})

test('codes and secrets are random: 200 mints give 200 different codes and 200 different secrets', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const codes = new Set()
    const secrets = new Set()
    for (let i = 0; i < 200; i += 1) {
      const r = await mint(srv.port, `${LONG}&n=${i}`)
      codes.add(r.code)
      secrets.add(r.secret)
    }
    assert.equal(codes.size, 200)
    assert.equal(secrets.size, 200)
  })
})

test('the same url minted twice gives two codes (a code is a person\'s own address, never shared)', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port)
    assert.notEqual(a.code, b.code)
  })
})

test('the store keeps sha256(secret) and never the secret; the file is 0600 and has no leftovers', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const { code, secret } = await mint(srv.port)
    const file = path.join(backupDir, 'connect.json')
    const text = await fs.readFile(file, 'utf8')
    assert.equal(text.includes(secret), false)
    const stored = JSON.parse(text)
    assert.equal(stored.v, 1)
    assert.equal(stored.codes[code].h, sha256hex(secret))
    assert.equal(stored.codes[code].url, new URL(LONG).href)
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    assert.deepEqual((await fs.readdir(backupDir)).filter((n) => n.startsWith('connect')), ['connect.json'])
  })
})

test('url validation (the /link rules): other host, lookalike, userinfo, port, http, no/empty connect, hand-over link with a key, not a url, not a string: 400 field url', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const bad = [
      'https://evil.example/?connect=x',
      `https://${APP}.evil.example/?connect=x`,
      `https://${APP}@evil.example/?connect=x`,
      `https://${APP}:8443/?connect=x`,
      `http://${APP}/?connect=x`,
      `https://${APP}/?id=x`,
      `https://${APP}/?connect=`,
      `https://${APP}/?handover=1#k=SECRETKEY&a=x0000&t=Ada`,
      `https://${APP}/?connect=x&handover=1#t=Ada`,
      `https://${APP}/?connect=x#k=SECRETKEY`,
      'javascript:alert(1)',
      'not a url',
      '',
      42,
      null,
    ]
    for (const url of bad) {
      const r = await connect(srv.port, { url })
      assert.equal(r.status, 400, String(url).slice(0, 60))
      assert.equal(r.json.field, 'url')
    }
    for (const body of ['{"nope":1}', '[1]', 'not json', '"x"', 'null']) assert.equal((await connect(srv.port, body)).status, 400, body)
    assert.deepEqual((await readStore(backupDir)).codes, {}, 'nothing was stored by the refused posts')
  })
})

test('the host list comes from the config: another list accepts another host and refuses the first', async () => {
  await withServer(0, { linkHosts: ['app.idea2.site', 'app.trustintheweb.org'] }, async ({ srv }) => {
    assert.equal((await connect(srv.port, { url: LONG })).status, 400)
    assert.equal((await connect(srv.port, { url: 'https://app.trustintheweb.org/?connect=x#t=1' })).status, 201)
    assert.equal((await connect(srv.port, { url: 'https://app.idea2.site/trustweb/?connect=x' })).status, 201)
  })
})

// ---------------------------------------------------------------- open

test('GET /c/<code>: 302 to the stored url INCLUDING its fragment, no-store, no referrer; HEAD the same; a query is ignored; cross-site navigation works', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const { code } = await mint(srv.port)
    const r = await openCode(srv.port, code)
    assert.equal(r.status, 302)
    assert.equal(r.headers.location, new URL(LONG).href)
    assert.ok(r.headers.location.includes('#t=Ada-demo&a=0123456789abcdef&pn=Gro%C3%9F'))
    assert.equal(r.headers['cache-control'], 'no-store')
    assert.equal(r.headers['referrer-policy'], 'no-referrer')
    assert.equal(r.headers['x-content-type-options'], 'nosniff')
    assert.equal(r.text, '')
    const head = await call(srv.port, { method: 'HEAD', url: `/c/${code}` })
    assert.equal(head.status, 302)
    assert.equal(head.headers.location, r.headers.location)
    assert.equal((await call(srv.port, { url: `/c/${code}?utm=1` })).status, 302)
    assert.equal((await openCode(srv.port, code, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' } })).status, 302)
  })
})

test('GET unknown, malformed, empty, wrong-length, wrong-case and path-trick codes: the same byte-identical tiny HTML 404 as /l/ (never says why)', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const { code } = await mint(srv.port)
    const swapped = code === code.toUpperCase() ? code.toLowerCase() : code.toUpperCase()
    const pages = []
    for (const bad of [OTHER_CODE, 'short', `${code}x`, code.slice(1), '', '..%2f..%2fetc', 'a%20b', `${code}/`, swapped === code ? OTHER_CODE : swapped]) {
      const r = await openCode(srv.port, bad)
      assert.equal(r.status, 404, bad)
      assert.match(r.headers['content-type'], /^text\/html/)
      assert.equal(r.json, undefined)
      pages.push(r.text)
    }
    const link = await call(srv.port, { url: '/l/AAAAAAAAAA' })
    pages.push(link.text)
    assert.equal(new Set(pages).size, 1, 'one page for every case, the same as /l/')
  })
})

test('update with the right secret: 200 {code, url}, no secret in the answer, the stored url is replaced and /c/ follows it', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const { code, secret } = await mint(srv.port)
    const r = await connect(srv.port, { url: LONG2, code, secret })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { code, url: `${ORIGIN}/c/${code}` })
    assert.equal((await openCode(srv.port, code)).headers.location, new URL(LONG2).href)
    // updating again with the same url is fine (a retry)
    assert.equal((await connect(srv.port, { url: LONG2, code, secret })).status, 200)
  })
})

test('NO ORACLE: wrong secret, unknown code and expired code answer 403 with byte-identical bodies and headers (update and name alike)', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv, backupDir }) => {
    const { code, secret } = await mint(srv.port)
    const wrong = await connect(srv.port, { url: LONG2, code, secret: OTHER_SECRET })
    const unknown = await connect(srv.port, { url: LONG2, code: OTHER_CODE, secret })
    assert.equal(wrong.status, 403)
    assert.equal(wrong.json.error, 'forbidden')
    assert.equal(unknown.status, 403)
    assert.equal(unknown.text, wrong.text)
    assert.deepEqual(unknown.headers['content-type'], wrong.headers['content-type'])
    assert.equal(unknown.headers['content-length'], wrong.headers['content-length'])
    const nameWrong = await claim(srv.port, { name: 'ada', code, secret: OTHER_SECRET })
    const nameUnknown = await claim(srv.port, { name: 'ada', code: OTHER_CODE, secret })
    assert.equal(nameWrong.status, 403)
    assert.equal(nameUnknown.text, nameWrong.text)
    assert.equal(nameWrong.text, wrong.text)
    t += 366 * DAY // the code is expired but not yet swept: it acts as unknown
    const expired = await connect(srv.port, { url: LONG2, code, secret })
    assert.equal(expired.status, 403)
    assert.equal(expired.text, wrong.text)
    // nothing changed by the failed attempts: the entry still has its old url and its old time
    assert.deepEqual(Object.values((await readStore(backupDir)).codes).map((e) => [e.url, e.seen]), [[new URL(LONG).href, T0]])
  })
})

test('credential shape: code without secret, secret without code, malformed code or secret are 400 with the field named (a shape is no oracle)', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const { code, secret } = await mint(srv.port)
    const cases = [
      [{ url: LONG, code }, 'secret'],
      [{ url: LONG, secret }, 'code'],
      [{ url: LONG, code: 'short', secret }, 'code'],
      [{ url: LONG, code, secret: 'short' }, 'secret'],
      [{ url: LONG, code: 5, secret }, 'code'],
      [{ url: LONG, code, secret: null }, 'secret'],
      [{ url: LONG, code: null, secret }, 'code'],
    ]
    for (const [body, field] of cases) {
      const r = await connect(srv.port, body)
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60))
      assert.equal(r.json.field, field)
    }
  })
})

// ---------------------------------------------------------------- lifetime

test('TTL: a mint, an update and an open that follows a day of silence extend the life; an open within 24 h does not rewrite the file', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv, backupDir }) => {
    const { code, secret } = await mint(srv.port)
    assert.equal((await readStore(backupDir)).codes[code].seen, T0)
    t = T0 + DAY - 1000 // under 24 h: no refresh, no rewrite
    assert.equal((await openCode(srv.port, code)).status, 302)
    await settle()
    assert.equal((await readStore(backupDir)).codes[code].seen, T0)
    t = T0 + DAY + 1000 // older than 24 h: refreshed
    assert.equal((await openCode(srv.port, code)).status, 302)
    await settle()
    assert.equal((await readStore(backupDir)).codes[code].seen, t)
    const opened = t
    t += 10 * DAY
    assert.equal((await connect(srv.port, { url: LONG2, code, secret })).status, 200)
    assert.equal((await readStore(backupDir)).codes[code].seen, t)
    assert.ok(t > opened)
  })
})

test('TTL: 364 days of silence still opens, 365 days is 404 (identical to unknown); an open at day 364 keeps it alive for another year', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, LONG2)
    t = T0 + 364 * DAY
    assert.equal((await openCode(srv.port, a.code)).status, 302) // refreshes a
    t = T0 + 365 * DAY
    const unknown = await openCode(srv.port, OTHER_CODE)
    const expired = await openCode(srv.port, b.code)
    assert.equal(expired.status, 404)
    assert.equal(expired.text, unknown.text)
    assert.equal((await openCode(srv.port, a.code)).status, 302)
    t = T0 + 364 * DAY + 365 * DAY
    assert.equal((await openCode(srv.port, a.code)).status, 404)
  })
})

test('an expired code is gone from the file by the sweep timer without any request, and its name is free for others', async () => {
  let t = T0
  await withServer(0, { ...BASE, connectSweepMs: 30, now: () => t }, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200)
    assert.equal(Object.keys((await readStore(backupDir)).codes).length, 1)
    t = T0 + 366 * DAY
    await settle(300)
    assert.equal(Object.keys((await readStore(backupDir)).codes).length, 0)
    const b = await mint(srv.port, LONG2)
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 200)
  })
})

test('an expired but unswept code acts as unknown for its name too: /who/ is 404 and ANOTHER, already stored code can claim the name at once (no mint in between)', async () => {
  let t = T0
  await withServer(0, { ...BASE, now: () => t }, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    t = T0 + 300 * DAY
    const b = await mint(srv.port, LONG2) // stored while a is still alive; the claim below must not rely on a later mint sweeping a
    t = T0
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200)
    t = T0 + 366 * DAY // a expired (not swept: the hourly timer has not run), b is live
    assert.equal((await who(srv.port, 'ada')).status, 404)
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 200)
    assert.equal((await who(srv.port, 'ada')).headers.location, `${ORIGIN}/c/${b.code}`)
    const stored = (await readStore(backupDir)).codes
    assert.equal(stored[a.code], undefined, 'the expired owner left the file with the claim')
    assert.equal(stored[b.code].name, 'ada')
  })
})

test('LOAD: an expired entry listed first never takes a name from the live entry that holds the same one', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'backup', 'connect.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    const h = sha256hex('x')
    const old = 'O'.repeat(22)
    const live = 'L'.repeat(22)
    const url = new URL(LONG).href
    const t = T0
    await fs.writeFile(file, JSON.stringify({ v: 1, codes: { [old]: { h, url, seen: t - 400 * DAY, name: 'twin' }, [live]: { h, url, seen: t, name: 'twin' } } }))
    const srv = await startServer(serverOptions(dir, { now: () => t }))
    try {
      assert.equal((await who(srv.port, 'twin')).headers.location, `${ORIGIN}/c/${live}`)
      assert.equal((await openCode(srv.port, old)).status, 404)
    } finally {
      await srv.close()
    }
  })
})

test('cap: past connectMax a MINT is 507 storage_full, an update and a name change still work, and room appears when codes expire', async () => {
  let t = T0
  await withServer(0, { ...BASE, connectMax: 2, now: () => t }, async ({ srv }) => {
    const a = await mint(srv.port)
    await mint(srv.port, LONG2)
    const full = await connect(srv.port, { url: LONG })
    assert.equal(full.status, 507)
    assert.equal(full.json.error, 'storage_full')
    assert.equal((await connect(srv.port, { ...a, url: LONG2 })).status, 200)
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200)
    t = T0 + 366 * DAY
    assert.equal((await connect(srv.port, { url: LONG })).status, 201)
  })
})

// ---------------------------------------------------------------- guards on the POST routes

test('Origin and fetch metadata (both POST routes): a foreign Origin, "null", http, a port, userinfo and cross-site are 403; the app host Origin and no Origin pass; an unknown Host is 421', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const { code, secret } = await mint(srv.port)
    for (const origin of ['https://evil.example', 'null', `http://${APP}`, `https://${APP}:8443`, `https://${APP}@evil.example`, 'https://127.0.0.1']) {
      const c = await connect(srv.port, { url: LONG }, { headers: { Origin: origin } })
      assert.equal(c.status, 403, origin)
      assert.equal(c.json.error, 'forbidden_origin')
      assert.equal((await claim(srv.port, { name: 'ada', code, secret }, { headers: { Origin: origin } })).status, 403, origin)
    }
    assert.equal((await connect(srv.port, { url: LONG }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
    assert.equal((await claim(srv.port, { name: 'ada', code, secret }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
    assert.equal((await connect(srv.port, { url: LONG }, { headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' } })).status, 201)
    assert.equal((await claim(srv.port, { name: 'ada', code, secret }, { headers: { Origin: ORIGIN } })).status, 200)
    assert.equal((await send(srv.port, '/connect', '{}', { host: 'evil.example' })).status, 421)
  })
})

test('body over 2 KB: 413 (declared and streamed), exactly 2 KB passes; wrong content type 415; GET/PUT/DELETE are 405 with Allow: POST on both routes', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const big = JSON.stringify({ url: `https://${APP}/?connect=${'a'.repeat(2100)}` })
    const declared = await connect(srv.port, big)
    assert.equal(declared.status, 413)
    assert.equal(declared.json.error, 'too_large')
    const streamed = await call(srv.port, { method: 'POST', url: '/connect', headers: JSON_H, body: [big.slice(0, 1500), big.slice(1500)] })
    assert.equal(streamed.status, 413)
    const bigName = await claim(srv.port, JSON.stringify({ name: 'ada', code: OTHER_CODE, secret: OTHER_SECRET, pad: 'x'.repeat(2100) }))
    assert.equal(bigName.status, 413)
    const room = 2048 - JSON.stringify({ url: `https://${APP}/?connect=` }).length
    const exact = JSON.stringify({ url: `https://${APP}/?connect=${'a'.repeat(room)}` })
    assert.equal(Buffer.byteLength(exact), 2048)
    assert.equal((await connect(srv.port, exact)).status, 201)
    for (const route of ['/connect', '/name']) {
      const text = await call(srv.port, { method: 'POST', url: route, headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ url: LONG }) })
      assert.equal(text.status, 415)
      assert.equal(text.json.error, 'unsupported_media')
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const r = await call(srv.port, { method, url: route })
        assert.equal(r.status, 405, `${method} ${route}`)
        assert.equal(r.headers.allow, 'POST')
      }
    }
  })
})

test('rate limit: the 7th POST in a minute is 429 with Retry-After (JSON); /connect and /name share the budget; another address is not affected; an IPv6 /64 shares one', async () => {
  await withServer(0, LINKS, async ({ srv }) => {
    const ip = '203.0.113.7'
    const made = await send(srv.port, '/connect', { url: LONG }, { ip })
    assert.equal(made.status, 201)
    for (let i = 0; i < 2; i += 1) assert.equal((await claim(srv.port, { name: 'ada', ...made.json }, { ip })).status, 200)
    for (let i = 0; i < 3; i += 1) assert.equal((await connect(srv.port, { url: `${LONG}&n=${i}` }, { ip })).status, 201)
    const limited = await connect(srv.port, { url: `${LONG}&n=x` }, { ip })
    assert.equal(limited.status, 429)
    assert.equal(limited.json.error, 'rate_limited')
    assert.ok(Number(limited.headers['retry-after']) >= 1)
    assert.equal((await claim(srv.port, { name: 'ada', ...made.json }, { ip })).status, 429)
    assert.equal((await connect(srv.port, { url: `${LONG}&n=y` }, { ip: '203.0.113.8' })).status, 201)
    for (let i = 0; i < 6; i += 1) await connect(srv.port, { url: `${LONG}&v=${i}` }, { ip: `2001:db8:1:2::${i + 1}` })
    assert.equal((await connect(srv.port, { url: `${LONG}&v=z` }, { ip: '2001:db8:1:2:ffff::9' })).status, 429)
  })
})

test('the hourly POST limit holds beyond the per-minute one (clock injected)', async () => {
  let t = T0
  await withServer(0, { ...LINKS, connectPerMinute: 100, connectPerHour: 3, rateLimit: 100000, now: () => t }, async ({ srv }) => {
    const ip = '203.0.113.9'
    for (let i = 0; i < 3; i += 1) assert.equal((await connect(srv.port, { url: `${LONG}&n=${i}` }, { ip })).status, 201)
    assert.equal((await connect(srv.port, { url: `${LONG}&n=3` }, { ip })).status, 429)
    t += 3_600_001
    assert.equal((await connect(srv.port, { url: `${LONG}&n=4` }, { ip })).status, 201)
  })
})

test('rate limit on the reads: GET /c/ and GET /who/ share a more generous budget (21st in a minute is a plain-text 429 "slow down" with Retry-After); HEAD counts; POSTs are separate', async () => {
  await withServer(0, { ...LINKS, rateLimit: 100000 }, async ({ srv }) => {
    const ip = '203.0.113.20'
    for (let i = 0; i < 10; i += 1) assert.equal((await openCode(srv.port, OTHER_CODE, { ip })).status, 404)
    for (let i = 0; i < 9; i += 1) assert.equal((await who(srv.port, 'nobody', { ip })).status, 404)
    assert.equal((await call(srv.port, { method: 'HEAD', url: `/c/${OTHER_CODE}`, ip })).status, 404) // the 20th
    const limited = await openCode(srv.port, OTHER_CODE, { ip })
    assert.equal(limited.status, 429)
    assert.equal(limited.text, 'slow down')
    assert.match(limited.headers['content-type'], /^text\/plain/)
    assert.ok(Number(limited.headers['retry-after']) >= 1)
    assert.equal((await who(srv.port, 'nobody', { ip })).status, 429)
    assert.equal((await openCode(srv.port, OTHER_CODE, { ip: '203.0.113.21' })).status, 404)
    assert.equal((await connect(srv.port, { url: LONG }, { ip })).status, 201)
  })
})

test('the hourly read limit holds (clock injected)', async () => {
  let t = T0
  await withServer(0, { ...LINKS, connectGetPerMinute: 100, connectGetPerHour: 5, rateLimit: 100000, now: () => t }, async ({ srv }) => {
    const ip = '203.0.113.30'
    for (let i = 0; i < 5; i += 1) assert.equal((await who(srv.port, 'nobody', { ip })).status, 404)
    assert.equal((await who(srv.port, 'nobody', { ip })).status, 429)
    t += 3_600_001
    assert.equal((await who(srv.port, 'nobody', { ip })).status, 404)
  })
})

// ---------------------------------------------------------------- names

test('names: claim 200 {name}; idempotent for the owner; /who/ answers 302 to the SAME host /c/<code>; /c/ then reaches the stored url', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const r = await claim(srv.port, { name: 'ada.l-1_x', ...a })
    assert.equal(r.status, 200)
    assert.deepEqual(r.json, { name: 'ada.l-1_x', aliases: [], locked: [] })
    assert.equal((await claim(srv.port, { name: 'ada.l-1_x', ...a })).status, 200)
    const w = await who(srv.port, 'ada.l-1_x')
    assert.equal(w.status, 302)
    assert.equal(w.headers.location, `${ORIGIN}/c/${a.code}`)
    assert.equal(w.headers['cache-control'], 'no-store')
    assert.equal(w.headers['referrer-policy'], 'no-referrer')
    assert.equal(w.text, '')
    const head = await call(srv.port, { method: 'HEAD', url: '/who/ada.l-1_x' })
    assert.equal(head.status, 302)
    assert.equal(head.headers.location, w.headers.location)
    assert.equal((await openCode(srv.port, a.code)).headers.location, new URL(LONG).href)
    assert.equal((await who(srv.port, 'ada.l-1_x?x=1'.split('?')[0], { headers: {} })).status, 302)
    assert.equal((await call(srv.port, { url: '/who/ada.l-1_x?utm=1' })).status, 302)
  })
})

test('names: a second code claiming a taken name gets 409 name_taken; 403 beats 409 (a wrong secret never learns what is taken); a name is unique even across a release and reclaim', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, LONG2)
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200)
    const taken = await claim(srv.port, { name: 'ada', ...b })
    assert.equal(taken.status, 409)
    assert.deepEqual(taken.json, { error: 'name_taken', message: 'That name is taken.', field: 'name' })
    const oracle = await claim(srv.port, { name: 'ada', code: b.code, secret: OTHER_SECRET })
    assert.equal(oracle.status, 403)
    const free = await claim(srv.port, { name: 'grace', code: b.code, secret: OTHER_SECRET })
    assert.equal(free.status, 403)
    assert.equal(free.text, oracle.text)
    assert.equal((await claim(srv.port, { name: '', ...a })).status, 200) // release
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 200)
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 409)
    assert.equal((await who(srv.port, 'ada')).headers.location, `${ORIGIN}/c/${b.code}`)
  })
})

test('names: release with "" frees the name (200 {name: ""}, idempotent), /who/ is then 404; a code with no name releasing is fine', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    assert.equal((await claim(srv.port, { name: '', ...a })).status, 200)
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200)
    const released = await claim(srv.port, { name: '', ...a })
    assert.equal(released.status, 200)
    assert.deepEqual(released.json, { name: '', aliases: [], locked: [] })
    assert.equal((await who(srv.port, 'ada')).status, 404)
    assert.equal((await readStore(backupDir)).codes[a.code].name, undefined)
    assert.equal((await claim(srv.port, { name: '', ...a })).status, 200)
  })
})

test('names: a code that claims another name RELEASES the old one in the same write (one name per code)', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    const b = await mint(srv.port, LONG2)
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200)
    assert.equal((await claim(srv.port, { name: 'grace', ...a })).status, 200)
    assert.equal((await who(srv.port, 'ada')).status, 404)
    assert.equal((await who(srv.port, 'grace')).status, 302)
    assert.equal((await readStore(backupDir)).codes[a.code].name, 'grace')
    assert.equal((await claim(srv.port, { name: 'ada', ...b })).status, 200) // the old one is free at once
  })
})

test('names: bad names are 400 field name: charset, case, "@", spaces, unicode, length 2 and 31, edges, code-shaped; reserved names are 409 reserved AFTER the secret check (wave 6e, also with separators); "jakob" is allowed', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    const bad = [
      'Ada', '@ada', 'ad a', 'ada!', 'ad\r\nx', 'ada/x', '../x', 'ädä', 'ab', 'a'.repeat(31), '.ada', 'ada.', '-ada', 'ada-', '_ada',
      'a'.repeat(22), 'a1_-'.repeat(5) + 'ab', // 22 characters that look like a code
      5, null, [], {},
    ]
    for (const name of bad) {
      const r = await claim(srv.port, { name, ...a })
      assert.equal(r.status, 400, String(name))
      assert.equal(r.json.field, 'name')
    }
    for (const name of ['jakob', 'abc', 'a'.repeat(30), 'a.b', 'x_y-z', '007']) assert.equal((await claim(srv.port, { name, ...a })).status, 200, name)
    for (const name of ['admin', 'ad-min', 'ad.min', 'no-reply', 'noreply', 'trustweb', 'trust_web', 'evobiosys', 'root', 'support']) {
      const r = await claim(srv.port, { name, ...a })
      assert.equal(r.status, 409, name)
      assert.deepEqual(r.json, { error: 'reserved', message: 'That name is reserved.', field: 'name' })
      assert.equal((await claim(srv.port, { name, code: a.code, secret: OTHER_SECRET })).status, 403, 'a wrong secret learns nothing about reservation')
    }
    assert.equal(isReserved('jakob'), false)
    assert.ok(NAME_RE.test('a.b') && !isClaimableName('Ada'))
    // a missing name is the READ intent now (wave 6e): 200 with the names, nothing changes; code/secret shape errors name their field
    const read = await claim(srv.port, { ...a })
    assert.equal(read.status, 200)
    assert.equal(typeof read.json.name, 'string')
    assert.equal((await claim(srv.port, { name: 'ada', code: 'short', secret: a.secret })).json.field, 'code')
    assert.equal((await claim(srv.port, { name: 'ada', code: a.code })).json.field, 'secret')
    assert.equal((await claim(srv.port, { name: 'ada', code: a.code, secret: 'x' })).json.field, 'secret')
    assert.equal((await claim(srv.port, '[1]')).status, 400)
  })
})

test('who: unknown, malformed, other-case, prefix, substring, trailing-slash and encoded names are the same byte-identical 404 page; names are never listed', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const a = await mint(srv.port)
    assert.equal((await claim(srv.port, { name: 'ada.lovelace', ...a })).status, 200)
    const pages = []
    for (const bad of ['nobody', 'Ada.Lovelace', 'ada', 'lovelace', 'ada.lovelac', 'ada.lovelace/', 'ada.lovelace%2f', 'ada%2elovelace', '', '%', '..', 'a'.repeat(40), 'ada%20lovelace', '*', '.']) {
      const r = await who(srv.port, bad)
      assert.equal(r.status, 404, bad)
      pages.push(r.text)
    }
    pages.push((await openCode(srv.port, OTHER_CODE)).text)
    assert.equal(new Set(pages).size, 1)
    assert.equal((await call(srv.port, { url: '/who' })).status, 400) // not a route: the old "bad id" answer
    assert.equal((await call(srv.port, { url: '/who/' })).status, 404)
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const body = method === 'POST' ? '{}' : undefined // a body the server never reads is only sent with POST (as the /l/ test does)
      const r = await call(srv.port, { method, url: '/who/ada.lovelace', headers: JSON_H, body })
      assert.equal(r.status, 405)
      assert.equal(r.headers.allow, 'GET, HEAD')
      assert.equal((await call(srv.port, { method, url: `/c/${a.code}`, headers: JSON_H, body })).status, 405)
    }
  })
})

test('who HOST handling: the redirect stays on the request host when it is an app host (a port is dropped); any other Host that reaches the handler is 404, never a redirect', async () => {
  const hosts = [APP, 'app2.example.test']
  await withServer(0, { ...BASE, linkHosts: hosts, allowedHosts: [...hosts, '127.0.0.1', 'evil.example', `${APP}.evil.example`] }, async ({ srv }) => {
    const a = await mint(srv.port, `https://${APP}/?connect=x#t=1`)
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200)
    assert.equal((await who(srv.port, 'ada', { host: 'app2.example.test' })).headers.location, `https://app2.example.test/c/${a.code}`)
    assert.equal((await who(srv.port, 'ada', { host: APP.toUpperCase() })).headers.location, `https://${APP}/c/${a.code}`)
    assert.equal((await who(srv.port, 'ada', { host: `${APP}:8443` })).headers.location, `https://${APP}/c/${a.code}`)
    for (const host of ['127.0.0.1', 'evil.example', `${APP}.evil.example`, `${APP}@evil.example`, `evil.example:80`, `[::1]`]) {
      const r = await who(srv.port, 'ada', { host })
      assert.ok([404, 421].includes(r.status), `${host} -> ${r.status}`)
      assert.equal(r.headers.location, undefined, host)
    }
    assert.equal((await who(srv.port, 'ada', { host: '127.0.0.1' })).status, 404) // allowed by the server, not an app host: the handler says 404
    assert.equal((await who(srv.port, 'ada', { host: 'evil.example' })).status, 404)
    // the answer url of a mint on a foreign (allowed) Host falls back to the first app host
    const m = await connect(srv.port, { url: LONG2.replace(APP, APP) }, { host: '127.0.0.1' })
    assert.equal(m.json.url, `https://${APP}/c/${m.json.code}`)
  })
})

// ---------------------------------------------------------------- persistence and the store file

test('persistence: a new instance on the same dir serves the old codes and names; the old secret still works; the file is 0600 with no tmp leftovers', async () => {
  await inTempDir(async (dir) => {
    const opts = serverOptions(dir)
    const one = await startServer(opts)
    const made = (await connect(one.port, { url: LONG })).json
    await claim(one.port, { name: 'ada', ...made })
    await one.close()
    const file = path.join(dir, 'backup', 'connect.json')
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    assert.deepEqual((await fs.readdir(path.join(dir, 'backup'))).filter((n) => n.startsWith('connect')), ['connect.json'])
    const two = await startServer(opts)
    try {
      assert.equal((await openCode(two.port, made.code)).headers.location, new URL(LONG).href)
      assert.equal((await who(two.port, 'ada')).headers.location, `${ORIGIN}/c/${made.code}`)
      assert.equal((await connect(two.port, { url: LONG2, code: made.code, secret: made.secret })).status, 200)
      assert.equal((await claim(two.port, { name: 'ada', code: made.code, secret: 'C'.repeat(43) })).status, 403)
    } finally {
      await two.close()
    }
  })
})

test('an unreadable store file is moved aside and the codes start empty (one log line, no secrets)', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'backup', 'connect.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{"v":1,"codes":')
    const lines = []
    const one = await startServer(serverOptions(dir, { log: (l) => lines.push(l) }))
    assert.deepEqual(lines, ['connect store unreadable: moved aside, connect codes start empty'])
    assert.equal((await openCode(one.port, OTHER_CODE)).status, 404)
    assert.equal((await connect(one.port, { url: LONG })).status, 201)
    await one.close()
    assert.equal(await fs.readFile(`${file}.unreadable`, 'utf8'), '{"v":1,"codes":')
  })
})

test('TAMPERED FILE: hostile entries never produce a redirect off the app hosts: bad code keys, non-hex hashes, evil or http urls, CR/LF and uppercase and code-shaped names, two codes with one name', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'backup', 'connect.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    const good = { code: 'G'.repeat(22), url: new URL(LONG).href }
    const h = sha256hex('x')
    const seen = Date.now()
    const evil = (suffix) => `${suffix}`.padEnd(22, 'E')
    const codes = {
      [good.code]: { h, url: good.url, seen, name: 'good' },
      [evil('evilurl')]: { h, url: 'https://evil.example/?connect=x', seen, name: 'evilurl' },
      [evil('httpurl')]: { h, url: `http://${APP}/?connect=x`, seen, name: 'httpurl' },
      [evil('portless')]: { h, url: `https://${APP}:9/?connect=x`, seen, name: 'portless' },
      [evil('nohash')]: { h: 'not-hex', url: good.url, seen, name: 'nohash' },
      [evil('noseen')]: { h, url: good.url, seen: 'x', name: 'noseen' },
      '//evil.example/x': { h, url: good.url, seen, name: 'slashes' },
      'short': { h, url: good.url, seen, name: 'short' },
      [`${'K'.repeat(21)}\n`]: { h, url: good.url, seen, name: 'newline' },
      [evil('crlfname')]: { h, url: good.url, seen, name: 'ada\r\nLocation: https://evil.example' },
      [evil('upname')]: { h, url: good.url, seen, name: 'Ada' },
      [evil('codename')]: { h, url: good.url, seen, name: 'q'.repeat(22) },
      [evil('dupname1')]: { h, url: good.url, seen, name: 'twin' },
      [evil('dupname2')]: { h, url: good.url, seen, name: 'twin' },
      [evil('pathname')]: { h, url: good.url, seen, name: '../etc' },
    }
    await fs.writeFile(file, JSON.stringify({ v: 1, codes }))
    const srv = await startServer(serverOptions(dir))
    try {
      const everyLocation = []
      const probe = async (r) => {
        if (r.headers.location !== undefined) everyLocation.push(r.headers.location)
        return r
      }
      assert.equal((await probe(await openCode(srv.port, good.code))).headers.location, good.url)
      assert.equal((await probe(await who(srv.port, 'good'))).headers.location, `${ORIGIN}/c/${good.code}`)
      for (const code of [evil('evilurl'), evil('httpurl'), evil('portless'), evil('nohash'), evil('noseen'), '//evil.example/x', 'short']) {
        assert.equal((await probe(await openCode(srv.port, code))).status, 404, code)
      }
      for (const name of ['evilurl', 'httpurl', 'portless', 'nohash', 'noseen', 'slashes', 'short', 'newline']) assert.equal((await probe(await who(srv.port, name))).status, 404, name)
      // the entries with a bad name keep their code but lose the name
      for (const key of ['crlfname', 'upname', 'codename', 'pathname']) assert.equal((await probe(await openCode(srv.port, evil(key)))).status, 302, key)
      for (const name of ['Ada', 'ada', 'q'.repeat(22), '../etc']) assert.equal((await probe(await who(srv.port, name))).status, 404, name)
      // two codes with one name: the first one keeps it, the second loses it, /who/ answers the first only
      const twin = await probe(await who(srv.port, 'twin'))
      assert.equal(twin.status, 302)
      assert.equal(twin.headers.location, `${ORIGIN}/c/${evil('dupname1')}`)
      // nothing that was served points anywhere but at the app host
      for (const loc of everyLocation) assert.ok(loc.startsWith(`${ORIGIN}/`), loc)
    } finally {
      await srv.close()
    }
  })
})

test('TAMPERED FILE while running: a url that stops validating (the host list changed) answers 404 on /c/ and /who/; the code is NOT erased and its age is not refreshed; with the list back it works again', async () => {
  await inTempDir(async (dir) => {
    let t = T0
    const one = await startServer(serverOptions(dir, { now: () => t }))
    const a = (await connect(one.port, { url: LONG })).json
    await claim(one.port, { name: 'ada', ...a })
    await one.close()
    t = T0 + 3 * DAY // older than the 24 h touch threshold: a valid open WOULD refresh `seen`
    const file = path.join(dir, 'backup', 'connect.json')
    const two = await startServer(serverOptions(dir, { linkHosts: ['app.other.test'], allowedHosts: [HOST, '127.0.0.1', 'app.other.test'], now: () => t }))
    try {
      assert.equal((await who(two.port, 'ada', { host: 'app.other.test' })).status, 404) // the target's url no longer validates
      const r = await openCode(two.port, a.code)
      assert.equal(r.status, 404)
      assert.equal(r.headers.location, undefined)
      await settle()
      const kept = JSON.parse(await fs.readFile(file, 'utf8')).codes[a.code]
      assert.ok(kept, 'the code stays in the file')
      assert.equal(kept.seen, T0, 'an entry that does not validate is not refreshed')
      assert.equal(kept.name, 'ada')
    } finally {
      await two.close()
    }
    const three = await startServer(serverOptions(dir, { now: () => t }))
    try {
      assert.equal((await openCode(three.port, a.code)).headers.location, new URL(LONG).href)
      assert.equal((await who(three.port, 'ada')).status, 302)
    } finally {
      await three.close()
    }
  })
})

test('a write failure answers 500 server_error and rolls back: no code kept, the old url and the old name stay; the next request works', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const a = await mint(srv.port)
    assert.equal((await claim(srv.port, { name: 'ada', ...a })).status, 200)
    const file = path.join(backupDir, 'connect.json')
    await fs.mkdir(`${file}.tmp`) // the temp name is a directory: every write fails
    const failedMint = await connect(srv.port, { url: LONG2 })
    assert.equal(failedMint.status, 500)
    assert.equal(failedMint.json.error, 'server_error')
    assert.equal(failedMint.text.includes(backupDir), false, 'a 500 carries no path or message of the failure')
    assert.equal((await connect(srv.port, { ...a, url: LONG2 })).status, 500)
    assert.equal((await claim(srv.port, { name: 'grace', ...a })).status, 500)
    assert.equal((await claim(srv.port, { name: '', ...a })).status, 500)
    assert.equal((await openCode(srv.port, a.code)).headers.location, new URL(LONG).href, 'the old url stays')
    assert.equal((await who(srv.port, 'ada')).status, 302, 'the old name stays')
    assert.equal((await who(srv.port, 'grace')).status, 404, 'the failed name is not kept')
    await fs.rmdir(`${file}.tmp`)
    assert.equal((await connect(srv.port, { url: LONG2 })).status, 201)
    assert.equal((await claim(srv.port, { name: 'grace', ...a })).status, 200)
    assert.equal((await who(srv.port, 'ada')).status, 404)
  })
})

test('concurrency: 40 parallel mints all land in the file; two codes racing for one name give exactly one 200 and one 409; parallel name switches leave a consistent file', async () => {
  await withServer(0, BASE, async ({ srv, backupDir }) => {
    const minted = await Promise.all(Array.from({ length: 40 }, (_, i) => connect(srv.port, { url: `${LONG}&n=${i}` })))
    assert.ok(minted.every((r) => r.status === 201))
    assert.equal(new Set(minted.map((r) => r.json.code)).size, 40)
    assert.equal(Object.keys((await readStore(backupDir)).codes).length, 40)
    const racers = minted.slice(0, 10).map((r) => r.json)
    const results = await Promise.all(racers.map((c) => claim(srv.port, { name: 'race', ...c })))
    assert.deepEqual(results.map((r) => r.status).sort(), [200, ...Array(9).fill(409)])
    const stored = (await readStore(backupDir)).codes
    assert.equal(Object.values(stored).filter((e) => e.name === 'race').length, 1)
    const winner = racers[results.findIndex((r) => r.status === 200)]
    assert.equal((await who(srv.port, 'race')).headers.location, `${ORIGIN}/c/${winner.code}`)
    // one code switching names in parallel ends with exactly one name
    const switcher = minted[20].json
    await Promise.all(['one', 'two', 'three', 'four'].map((name) => claim(srv.port, { name, ...switcher })))
    const after = (await readStore(backupDir)).codes[switcher.code]
    assert.ok(['one', 'two', 'three', 'four'].includes(after.name))
    const live = []
    for (const name of ['one', 'two', 'three', 'four']) if ((await who(srv.port, name)).status === 302) live.push(name)
    assert.deepEqual(live, [after.name])
  })
})

test('store: concurrent mints serialise their writes; prune drops the expired and rewrites; a name leaves with its code', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'connect.json')
    let t = 1000
    const store = await createConnectStore({ file, ttlMs: 100, touchMs: 10, max: 1000, now: () => t })
    const made = await Promise.all(Array.from({ length: 30 }, (_, i) => store.mint(`https://x.test/?connect=${i}`, 's'.repeat(43))))
    assert.equal(new Set(made.map((m) => m.code)).size, 30)
    assert.equal(Object.keys(JSON.parse(await fs.readFile(file, 'utf8')).codes).length, 30)
    assert.deepEqual(await store.claim(made[0].code, 's'.repeat(43), { name: 'ada' }), { kind: 'named', name: 'ada', aliases: [], locked: [] })
    assert.equal(store.codeOf('ada'), made[0].code)
    t = 1100
    assert.equal(await store.prune(), 30)
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { v: 1, codes: {} })
    assert.equal(store.codeOf('ada'), null)
    assert.equal(await store.prune(), 0)
  })
})

test('connect off (the store cannot open): POST /connect and /name are 503 not_configured, GET /c/ and /who/ are the 404 page, /backup and /link still work', async () => {
  await inTempDir(async (dir) => {
    const lines = []
    const srv = await startServer(serverOptions(dir, { log: (l) => lines.push(l), connectFile: path.join(dir, 'no-such-dir', 'x', 'connect.json') }))
    try {
      assert.deepEqual(lines, ['connect store unavailable: connect codes off'])
      for (const route of ['/connect', '/name']) {
        const r = await send(srv.port, route, { url: LONG })
        assert.equal(r.status, 503)
        assert.equal(r.json.error, 'not_configured')
      }
      assert.equal((await openCode(srv.port, OTHER_CODE)).status, 404)
      assert.equal((await who(srv.port, 'ada')).status, 404)
      assert.equal((await call(srv.port, { url: '/health' })).status, 200)
      assert.equal((await send(srv.port, '/link', { url: LONG })).status, 201)
    } finally {
      await srv.close()
    }
  })
})

test('CONNECT_FILE and the settings come from the options (and so from the environment): another file, TTL in days, touch in hours', async () => {
  await inTempDir(async (dir) => {
    const file = path.join(dir, 'elsewhere.json')
    let t = T0
    const srv = await startServer(serverOptions(dir, { connectFile: file, connectTtlDays: 2, connectTouchHours: 1, now: () => t }))
    try {
      const a = (await connect(srv.port, { url: LONG })).json
      assert.ok(JSON.parse(await fs.readFile(file, 'utf8')).codes[a.code])
      t = T0 + 2 * DAY - 1
      assert.equal((await openCode(srv.port, a.code)).status, 302)
      t = T0 + 4 * DAY
      assert.equal((await openCode(srv.port, a.code)).status, 404)
    } finally {
      await srv.close()
    }
  })
})

// ---------------------------------------------------------------- logging

test('NO LOGGING: across mint/update/name/open/who in every outcome (ok, 400, 403, 404, 409, 413, 415, 429, 507, 500) and a restart, no code, secret, name, url or did appears in the log lines, stdout or stderr; the routes log nothing at all', async () => {
  const seen = []
  const realOut = process.stdout.write.bind(process.stdout)
  const realErr = process.stderr.write.bind(process.stderr)
  const realLog = console.log
  const capture = (chunk) => {
    seen.push(String(chunk))
    return true
  }
  const lines = []
  const secrets = []
  await inTempDir(async (dir) => {
    let t = T0
    const opts = serverOptions(dir, { log: (l) => lines.push(l), now: () => t, connectMax: 2, connectPerMinute: 12, connectPerHour: 1000, connectGetPerMinute: 25, rateLimit: 100000 })
    const one = await startServer(opts)
    const stdoutDefault = await startServer({ ...opts, dir: path.join(dir, 'backup2'), log: undefined }) // the real default logger: console.log
    process.stdout.write = capture
    process.stderr.write = capture
    console.log = (...args) => seen.push(args.join(' '))
    try {
      for (const server of [one, stdoutDefault]) {
        const a = (await connect(server.port, { url: LONG })).json
        secrets.push(a.code, a.secret)
        await claim(server.port, { name: 'distinctivename', ...a }) // 200
        await claim(server.port, { name: 'distinctivename', ...(await connect(server.port, { url: LONG2 })).json }) // 409
        await connect(server.port, { url: LONG }) // 507
        await connect(server.port, { url: 'https://evil.example/?connect=1' }) // 400
        await connect(server.port, 'x'.repeat(5000)) // 413
        await connect(server.port, { url: LONG }, { headers: { 'Content-Type': 'text/plain' } }) // 415 (JSON header overridden by the extra)
        await connect(server.port, { url: LONG2, code: a.code, secret: OTHER_SECRET }) // 403
        await connect(server.port, { url: LONG2, code: a.code, secret: a.secret }) // 200
        await openCode(server.port, a.code) // 302
        await who(server.port, 'distinctivename') // 302
        await who(server.port, 'nobody') // 404
        for (let i = 0; i < 14; i += 1) await connect(server.port, { url: LONG }, { ip: '203.0.113.50' }) // 429 after 12
        for (let i = 0; i < 27; i += 1) await openCode(server.port, OTHER_CODE, { ip: '203.0.113.51' }) // 429 after 25
        t += 400 * DAY
        await openCode(server.port, a.code) // expired 404
        t = T0
      }
    } finally {
      process.stdout.write = realOut
      process.stderr.write = realErr
      console.log = realLog
    }
    await one.close()
    await stdoutDefault.close()
    const restarted = await startServer({ ...opts, now: () => t })
    await restarted.close()
  })
  const everything = [...lines, ...seen].join('\n')
  assert.ok(secrets.length === 4 && secrets.every((s) => s.length >= 22))
  for (const secret of [...secrets, 'distinctivename', 'distinctiveDIDmarker', 'secondDIDmarker', 'Ada-demo', APP, '/c/', '/who/', '/connect', '/name', 'connect=']) {
    assert.equal(everything.includes(secret), false, secret)
  }
  assert.deepEqual(lines, [], 'nothing was logged by the connect routes')
})

test('NO LOGGING by construction: the connect modules have no logger, no console, no stream write; no secret comparison with ===; server.mjs skips these paths', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const name of ['connect.mjs', 'connect_store.mjs', 'connect_names.mjs']) {
    const text = (await fs.readFile(path.join(here, '..', name), 'utf8')).split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
    assert.doesNotMatch(text, /console\.|process\.std|\.log\?*\.?\(|\blog\b|\bwarn\b|\berr\.message\b/, name)
  }
  const store = await fs.readFile(path.join(here, '..', 'connect_store.mjs'), 'utf8')
  assert.match(store, /crypto\.timingSafeEqual\(hashSecret\(secret\)/)
  assert.doesNotMatch(store.replace(/\/\/.*$/gm, ''), /ecret\)?\s*[!=]==|[!=]==\s*(?:hash)?[sS]ecret/)
  const server = await fs.readFile(path.join(here, '..', 'server.mjs'), 'utf8')
  assert.match(server, /const isConnectPath = \(pathname\) => pathname === '\/connect' \|\| pathname === '\/name' \|\| pathname\.startsWith\('\/c\/'\) \|\| pathname\.startsWith\('\/who\/'\)/)
  assert.match(server, /const quiet = isLinkPath\(\(req\.url \?\? ''\)\.split\('\?'\)\[0\]\) \|\| isConnectPath\(\(req\.url \?\? ''\)\.split\('\?'\)\[0\]\)/)
})

test('other routes keep logging method and status only (the quiet list is the link and connect routes)', async () => {
  await withServer(0, BASE, async ({ srv, lines }) => {
    await call(srv.port, { url: '/health' })
    await connect(srv.port, { url: LONG })
    await openCode(srv.port, OTHER_CODE)
    await who(srv.port, 'nobody')
    await claim(srv.port, { name: 'ada', code: OTHER_CODE, secret: OTHER_SECRET })
    assert.deepEqual(lines, ['GET 200'])
  })
})

// ---------------------------------------------------------------- the app's own lookup across app hosts (review 6b)

test('GET /c/<code> as the app\'s same-origin fetch lands on the REQUEST host (its app path, query and fragment kept); a navigation keeps the stored url', async () => {
  const IDEA2 = 'app.idea2.site'
  const ONE = 'app.trustweb.one'
  const stored = `https://${IDEA2}/trustweb/?connect=did%3Apeer%3A2.Ez6LSacross&id=p-9&name=Ada#t=x`
  await withServer(0, { ...ROOMY, linkHosts: [IDEA2, ONE], allowedHosts: [IDEA2, ONE, '127.0.0.1'] }, async ({ srv }) => {
    const r = await connect(srv.port, { url: stored }, { host: IDEA2 })
    assert.equal(r.status, 201)
    const code = r.json.code
    const fetchHeaders = { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' }
    const lookup = await openCode(srv.port, code, { host: ONE, headers: fetchHeaders })
    assert.equal(lookup.status, 302)
    assert.equal(lookup.headers.location, `https://${ONE}/?connect=did%3Apeer%3A2.Ez6LSacross&id=p-9&name=Ada#t=x`)
    const onIdea2 = await openCode(srv.port, code, { host: IDEA2, headers: fetchHeaders })
    assert.equal(onIdea2.headers.location, stored, 'the stored host is the request host: unchanged')
    for (const headers of [{}, { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' }, { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'navigate' }, { 'Sec-Fetch-Site': 'same-site', 'Sec-Fetch-Mode': 'cors' }, { 'Sec-Fetch-Site': 'same-origin' }]) {
      const nav = await openCode(srv.port, code, { host: ONE, headers })
      assert.equal(nav.status, 302)
      assert.equal(nav.headers.location, stored, JSON.stringify(headers))
    }
    assert.equal((await claim(srv.port, { name: 'ada', code, secret: r.json.secret }, { host: IDEA2 })).status, 200)
    const byName = await who(srv.port, 'ada', { host: ONE, headers: fetchHeaders })
    assert.equal(byName.headers.location, `https://${ONE}/c/${code}`)
  })
})

test('the request-host landing never leaves the app hosts: a Host that is not an app host keeps the stored url (and the 421 guard comes first)', async () => {
  await withServer(0, BASE, async ({ srv }) => {
    const { code } = await mint(srv.port)
    const r = await openCode(srv.port, code, { headers: { 'Sec-Fetch-Site': 'same-origin', 'Sec-Fetch-Mode': 'cors' } })
    assert.equal(r.headers.location, LONG)
  })
})
