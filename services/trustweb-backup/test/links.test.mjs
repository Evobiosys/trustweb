// Short connect links (wave 5): POST /link, GET /l/<id>. No fixed port (the server listens on port 0).
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from '../server.mjs'
import { createLinkStore, ID_RE } from '../link_store.mjs'
import { validLongUrl } from '../links.mjs'
import { call, HOST, withServer } from './helpers.mjs'

const APP = 'app.example.test'
const ORIGIN = `https://${APP}`
const DID = 'did%3Apeer%3A2.Ez6LSdistinctiveDIDmarker'
const LONG = `https://${APP}/?connect=${DID}&id=p-1&name=Ada%20Lovelace#t=Ada-demo&a=0123456789abcdef&p=did%3Apeer%3A2.Vz6Mk&pi=x1&pn=Gro%C3%9F`
const JSON_H = { 'Content-Type': 'application/json' }
const LINKS = { linkHosts: [APP] }

const post = (port, body, extra = {}) =>
  call(port, { method: 'POST', url: '/link', headers: { ...JSON_H, ...extra.headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ip: extra.ip })
const open = (port, id, extra = {}) => call(port, { url: `/l/${id}`, ...extra })
const mk = async (port, url = LONG) => (await post(port, { url })).json

test('POST /link: 201 {id, expires_at}; the id is 10 characters of [A-Za-z0-9]; the answer is JSON, no-store', async () => {
  const now = 1_800_000_000_000
  await withServer(0, { ...LINKS, now: () => now }, async ({ srv }) => {
    const r = await post(srv.port, { url: LONG }, { headers: { Origin: ORIGIN } })
    assert.equal(r.status, 201)
    assert.match(r.json.id, ID_RE)
    assert.equal(r.json.expires_at, now + 30 * 86_400_000)
    assert.match(r.headers['content-type'], /^application\/json/)
    assert.equal(r.headers['cache-control'], 'no-store')
  })
})

test('ids are random: 200 different urls give 200 different ids, none of them derived from the url', async () => {
  await withServer(0, { ...LINKS, linkPerMinute: 1000, linkPerHour: 1000, rateLimit: 100000 }, async ({ srv }) => {
    const ids = new Set()
    for (let i = 0; i < 200; i += 1) ids.add((await mk(srv.port, `${LONG}&n=${i}`)).id)
    assert.equal(ids.size, 200)
  })
})

test('validation: wrong host, lookalike host, userinfo, port, http, no/empty connect, not a url, not a string: all 400 with field url', async () => {
  await withServer(0, { ...LINKS, linkPerMinute: 1000, linkPerHour: 1000 }, async ({ srv }) => {
    const bad = [
      'https://evil.example/?connect=x',
      `https://${APP}.evil.example/?connect=x`,
      `https://evil.example/?connect=x#https://${APP}/`,
      `https://${APP}@evil.example/?connect=x`,
      `https://${APP}:8443/?connect=x`,
      `http://${APP}/?connect=x`,
      `https://${APP}/?id=x`,
      `https://${APP}/?connect=`,
      `https://${APP}/#?connect=x`,
      `https://${APP}/?handover=1#k=SECRETKEY&a=x0000&t=Ada`, // a hand-over link carries a private key: never stored
      `https://${APP}/?connect=x&handover=1#t=Ada`,
      `https://${APP}/?connect=x#k=SECRETKEY`,
      'javascript:alert(1)',
      'not a url',
      '',
      42,
      null,
    ]
    for (const url of bad) {
      const r = await post(srv.port, { url })
      assert.equal(r.status, 400, String(url))
      assert.equal(r.json.field, 'url')
    }
    assert.equal((await post(srv.port, '{"nope":1}')).status, 400)
    assert.equal((await post(srv.port, '[1]')).status, 400)
    assert.equal((await post(srv.port, 'not json')).status, 400)
  })
})

test('validLongUrl: the stored form is the parsed href (CR/LF and tabs vanish, a backslash host trick stays on the app host)', () => {
  assert.equal(validLongUrl(`https://${APP}/?connect=a\r\nb#t=1`, [APP]), `https://${APP}/?connect=ab#t=1`)
  assert.equal(validLongUrl(`https://${APP}\\@evil.example/?connect=a`, [APP]), `https://${APP}/@evil.example/?connect=a`)
  assert.equal(validLongUrl(`HTTPS://${APP.toUpperCase()}/?connect=a`, [APP]), `https://${APP}/?connect=a`)
  assert.equal(validLongUrl(`https://${APP}/?connect=${'a'.repeat(3000)}`, [APP]), null)
})

test('the host list comes from the config, not from the handler: another host list accepts another host', async () => {
  await withServer(0, { linkHosts: ['app.idea2.site', 'app.trustintheweb.org'] }, async ({ srv }) => {
    assert.equal((await post(srv.port, { url: `https://${APP}/?connect=x` })).status, 400)
    assert.equal((await post(srv.port, { url: 'https://app.trustintheweb.org/?connect=x#t=1' })).status, 201)
    assert.equal((await post(srv.port, { url: 'https://app.idea2.site/trustweb/?connect=x' })).status, 201)
  })
})

test('body over 2 KB: 413 (declared and streamed), 2 KB exactly passes the cap; wrong content type 415; GET and PUT on /link 405', async () => {
  await withServer(0, LINKS, async ({ srv }) => {
    const big = JSON.stringify({ url: `https://${APP}/?connect=${'a'.repeat(2100)}` })
    const declared = await post(srv.port, big)
    assert.equal(declared.status, 413)
    assert.equal(declared.json.error, 'too_large')
    const streamed = await call(srv.port, { method: 'POST', url: '/link', headers: JSON_H, body: [big.slice(0, 1500), big.slice(1500)] })
    assert.equal(streamed.status, 413)
    const room = 2048 - JSON.stringify({ url: `https://${APP}/?connect=` }).length
    const exact = JSON.stringify({ url: `https://${APP}/?connect=${'a'.repeat(room)}` })
    assert.equal(Buffer.byteLength(exact), 2048)
    assert.equal((await post(srv.port, exact)).status, 201)
    const text = await call(srv.port, { method: 'POST', url: '/link', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ url: LONG }) })
    assert.equal(text.status, 415)
    assert.equal(text.json.error, 'unsupported_media')
    for (const method of ['GET', 'PUT', 'DELETE']) {
      const r = await call(srv.port, { method, url: '/link' })
      assert.equal(r.status, 405)
      assert.equal(r.headers.allow, 'POST')
    }
  })
})

test('Origin and fetch metadata: a foreign Origin, "null", and Sec-Fetch-Site cross-site are 403; the app host Origin and no Origin pass', async () => {
  await withServer(0, LINKS, async ({ srv }) => {
    for (const origin of ['https://evil.example', 'null', `http://${APP}`, `https://${APP}:8443`, 'https://127.0.0.1']) {
      const r = await post(srv.port, { url: LONG }, { headers: { Origin: origin } })
      assert.equal(r.status, 403, origin)
      assert.equal(r.json.error, 'forbidden_origin')
    }
    assert.equal((await post(srv.port, { url: LONG }, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
    assert.equal((await post(srv.port, { url: LONG }, { headers: { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' } })).status, 201)
    assert.equal((await post(srv.port, { url: LONG })).status, 200) // the same url: the stored link comes back
    // an unknown Host is refused before anything else
    assert.equal((await call(srv.port, { method: 'POST', url: '/link', headers: JSON_H, body: '{}', host: 'evil.example' })).status, 421)
  })
})

test('rate limit per address: the 7th POST in a minute is 429 with Retry-After; another address is not affected; GET /l is not counted', async () => {
  await withServer(0, LINKS, async ({ srv }) => {
    for (let i = 0; i < 6; i += 1) assert.equal((await post(srv.port, { url: `${LONG}&n=${i}` }, { ip: '203.0.113.7' })).status, 201)
    const limited = await post(srv.port, { url: `${LONG}&n=x` }, { ip: '203.0.113.7' })
    assert.equal(limited.status, 429)
    assert.equal(limited.json.error, 'rate_limited')
    assert.ok(Number(limited.headers['retry-after']) >= 1)
    assert.equal((await post(srv.port, { url: `${LONG}&n=y` }, { ip: '203.0.113.8' })).status, 201)
    // IPv6: the whole /64 shares one budget
    for (let i = 0; i < 6; i += 1) await post(srv.port, { url: `${LONG}&v=${i}` }, { ip: `2001:db8:1:2::${i + 1}` })
    assert.equal((await post(srv.port, { url: `${LONG}&v=z` }, { ip: '2001:db8:1:2:ffff::9' })).status, 429)
  })
})

test('the hourly limit holds beyond the per-minute one (clock injected)', async () => {
  let t = 1_800_000_000_000
  await withServer(0, { ...LINKS, linkPerMinute: 100, linkPerHour: 3, now: () => t }, async ({ srv }) => {
    for (let i = 0; i < 3; i += 1) assert.equal((await post(srv.port, { url: `${LONG}&n=${i}` }, { ip: '203.0.113.9' })).status, 201)
    assert.equal((await post(srv.port, { url: `${LONG}&n=3` }, { ip: '203.0.113.9' })).status, 429)
    t += 3_600_001
    assert.equal((await post(srv.port, { url: `${LONG}&n=4` }, { ip: '203.0.113.9' })).status, 201)
  })
})

test('GET /l/<id>: 302 to the stored url INCLUDING its fragment, no-store, no referrer; HEAD the same', async () => {
  await withServer(0, LINKS, async ({ srv }) => {
    const { id } = await mk(srv.port)
    const r = await open(srv.port, id)
    assert.equal(r.status, 302)
    assert.equal(r.headers.location, new URL(LONG).href)
    assert.ok(r.headers.location.includes('#t=Ada-demo&a=0123456789abcdef&p=did%3Apeer%3A2.Vz6Mk&pi=x1&pn=Gro%C3%9F'))
    assert.equal(r.headers['cache-control'], 'no-store')
    assert.equal(r.headers['referrer-policy'], 'no-referrer')
    assert.equal(r.text, '')
    const head = await call(srv.port, { method: 'HEAD', url: `/l/${id}` })
    assert.equal(head.status, 302)
    assert.equal(head.headers.location, r.headers.location)
    // a navigation from a messenger or camera app is cross-site and must work
    assert.equal((await open(srv.port, id, { headers: { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate' } })).status, 302)
    // query strings and a query on the short link itself are ignored
    assert.equal((await call(srv.port, { url: `/l/${id}?utm=1` })).status, 302)
    assert.equal((await call(srv.port, { method: 'POST', url: `/l/${id}`, headers: JSON_H, body: '{}' })).status, 405)
  })
})

test('GET unknown, malformed, empty and other-case ids: the same byte-identical tiny HTML 404 (never says why)', async () => {
  await withServer(0, LINKS, async ({ srv }) => {
    const { id } = await mk(srv.port)
    const swapped = id === id.toUpperCase() ? id.toLowerCase() : id.toUpperCase()
    const pages = []
    for (const bad of ['AAAAAAAAAA', 'short', `${id}x`, '', '..%2f..%2fetc', 'a%20b', swapped === id ? 'zzzzzzzzzz' : swapped]) {
      const r = await call(srv.port, { url: `/l/${bad}` })
      assert.equal(r.status, 404, bad)
      assert.match(r.headers['content-type'], /^text\/html/)
      assert.equal(r.json, undefined)
      assert.ok(r.text.length < 400)
      pages.push(r.text)
    }
    assert.equal(new Set(pages).size, 1)
  })
})

test('expired: 404 once the TTL has passed (clock injected), identical to unknown; the entry is dropped from the file', async () => {
  let t = 1_800_000_000_000
  await withServer(0, { ...LINKS, now: () => t }, async ({ srv, backupDir }) => {
    const { id, expires_at } = await mk(srv.port)
    t = expires_at - 1
    assert.equal((await open(srv.port, id)).status, 302)
    const unknown = await open(srv.port, 'AAAAAAAAAA')
    t = expires_at
    const expired = await open(srv.port, id)
    assert.equal(expired.status, 404)
    assert.equal(expired.text, unknown.text)
    assert.deepEqual(expired.headers['content-type'], unknown.headers['content-type'])
    await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(backupDir, 'links.json'), 'utf8')).links, {})
  })
})

test('the same url again: the live link comes back (200, same id, same expiry) so a retry or a re-shown QR does not use a slot; with under a day left it gets a fresh one', async () => {
  let t = 1_800_000_000_000
  await withServer(0, { ...LINKS, now: () => t }, async ({ srv }) => {
    const first = await post(srv.port, { url: LONG })
    const again = await post(srv.port, { url: LONG })
    assert.equal(first.status, 201)
    assert.equal(again.status, 200)
    assert.deepEqual(again.json, first.json)
    t = first.json.expires_at - 86_400_000 + 1
    const fresh = await post(srv.port, { url: LONG })
    assert.equal(fresh.status, 201)
    assert.notEqual(fresh.json.id, first.json.id)
    assert.equal((await open(srv.port, first.json.id)).status, 302)
    assert.equal((await open(srv.port, fresh.json.id)).status, 302)
  })
})

test('cap: past linkMax new links are 507 storage_full, a known url still comes back, and room appears when links expire', async () => {
  let t = 1_800_000_000_000
  await withServer(0, { ...LINKS, linkMax: 2, now: () => t }, async ({ srv }) => {
    const a = await post(srv.port, { url: `${LONG}&n=1` })
    assert.equal((await post(srv.port, { url: `${LONG}&n=2` })).status, 201)
    const full = await post(srv.port, { url: `${LONG}&n=3` })
    assert.equal(full.status, 507)
    assert.equal(full.json.error, 'storage_full')
    assert.equal((await post(srv.port, { url: `${LONG}&n=1` })).json.id, a.json.id)
    t = a.json.expires_at
    assert.equal((await post(srv.port, { url: `${LONG}&n=3` })).status, 201)
  })
})

test('persistence: a new instance on the same dir serves the old links; the file is 0600, the dir has no tmp leftovers', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twlinks-'))
  try {
    const opts = { dir: path.join(dir, 'backup'), allowedHosts: [HOST, '127.0.0.1'], port: 0, log: () => undefined, ...LINKS }
    const one = await startServer(opts)
    const made = (await post(one.port, { url: LONG })).json
    await one.close()
    const file = path.join(dir, 'backup', 'links.json')
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    assert.deepEqual((await fs.readdir(path.join(dir, 'backup'))).filter((n) => n.startsWith('links')).sort(), ['links.json'])
    const two = await startServer(opts)
    try {
      const r = await open(two.port, made.id)
      assert.equal(r.status, 302)
      assert.equal(r.headers.location, new URL(LONG).href)
      assert.equal((await post(two.port, { url: LONG })).json.id, made.id)
    } finally {
      await two.close()
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('an unreadable store file is moved aside and links start empty; a stored url that no longer validates answers 404 and is dropped', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twlinks-'))
  try {
    const file = path.join(dir, 'backup', 'links.json')
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, '{"v":1,"links":')
    const lines = []
    const opts = { dir: path.join(dir, 'backup'), allowedHosts: [HOST, '127.0.0.1'], port: 0, log: (l) => lines.push(l), ...LINKS }
    const one = await startServer(opts)
    assert.deepEqual(lines, ['link store unreadable: moved aside, links start empty'])
    assert.equal((await open(one.port, 'AAAAAAAAAA')).status, 404)
    assert.equal((await post(one.port, { url: LONG })).status, 201)
    await one.close()
    assert.equal(await fs.readFile(`${file}.unreadable`, 'utf8'), '{"v":1,"links":')
    // an entry whose host is no longer allowed (the list changed) or that was tampered with is not served
    const stored = JSON.parse(await fs.readFile(file, 'utf8'))
    stored.links.evilevil00 = { url: 'https://evil.example/?connect=x', expires_at: Date.now() + 1e9 }
    stored.links['bad id'] = { url: LONG, expires_at: Date.now() + 1e9 }
    await fs.writeFile(file, JSON.stringify(stored))
    const two = await startServer(opts)
    try {
      assert.equal((await open(two.port, 'evilevil00')).status, 404)
      await new Promise((r) => setTimeout(r, 100))
      assert.equal(Object.keys(JSON.parse(await fs.readFile(file, 'utf8')).links).includes('evilevil00'), false)
    } finally {
      await two.close()
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('a write failure answers 500 server_error, nothing is kept in memory, and the next POST works', async () => {
  await withServer(0, LINKS, async ({ srv, backupDir }) => {
    const file = path.join(backupDir, 'links.json')
    await fs.mkdir(`${file}.tmp`) // the temp name is a directory: the write must fail
    const failed = await post(srv.port, { url: LONG })
    assert.equal(failed.status, 500)
    assert.equal(failed.json.error, 'server_error')
    await fs.rmdir(`${file}.tmp`)
    const ok = await post(srv.port, { url: LONG })
    assert.equal(ok.status, 201)
  })
})

test('store: prune drops the expired ones and rewrites the file; ids stay unique', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twlinks-'))
  try {
    const file = path.join(dir, 'links.json')
    let t = 1000
    const store = await createLinkStore({ file, ttlMs: 100, max: 10, now: () => t })
    const a = await store.add('https://x.test/?connect=1') // expires 1100
    t = 1050
    const b = await store.add('https://x.test/?connect=2') // expires 1150
    assert.notEqual(a.id, b.id)
    assert.equal(store.size(), 2)
    t = 1100
    assert.equal(await store.prune(), 1)
    assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(file, 'utf8')).links), [b.id])
    t = 1150
    assert.equal(await store.prune(), 1)
    assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')), { v: 1, links: {} })
    assert.equal(await store.prune(), 0)
    // expired entries are also dropped when a store opens
    t = 1000
    await store.add('https://x.test/?connect=3')
    t = 5000
    const reopened = await createLinkStore({ file, ttlMs: 100, max: 10, now: () => t })
    assert.equal(reopened.size(), 0)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('sweep timer: expired links leave the file without any request', async () => {
  let t = 1_800_000_000_000
  await withServer(0, { ...LINKS, linkSweepMs: 30, now: () => t }, async ({ srv, backupDir }) => {
    const { expires_at } = await mk(srv.port)
    const file = path.join(backupDir, 'links.json')
    assert.equal(Object.keys(JSON.parse(await fs.readFile(file, 'utf8')).links).length, 1)
    t = expires_at + 1
    await new Promise((r) => setTimeout(r, 250))
    assert.equal(Object.keys(JSON.parse(await fs.readFile(file, 'utf8')).links).length, 0)
  })
})

test('store: concurrent adds all land in the file (writes are serialised)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twlinks-'))
  try {
    const file = path.join(dir, 'links.json')
    const store = await createLinkStore({ file, ttlMs: 1e9, max: 1000 })
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => store.add(`https://x.test/?connect=${i}`)))
    assert.equal(new Set(results.map((r) => r.id)).size, 40)
    assert.equal(Object.keys(JSON.parse(await fs.readFile(file, 'utf8')).links).length, 40)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('NO LOGGING: across POST ok/400/413/415/429/507/500, GET 302/404/expired and a restart, neither the id nor the url nor the did appears in the log lines, stdout or stderr; the routes log nothing at all', async () => {
  const seen = []
  const realOut = process.stdout.write.bind(process.stdout)
  const realErr = process.stderr.write.bind(process.stderr)
  const realLog = console.log
  const capture = (chunk) => {
    seen.push(String(chunk))
    return true
  }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twlinks-'))
  let t = 1_800_000_000_000
  const lines = []
  const secrets = []
  try {
    const opts = {
      dir: path.join(dir, 'backup'),
      allowedHosts: [HOST, '127.0.0.1'],
      port: 0,
      log: (l) => lines.push(l),
      now: () => t,
      linkMax: 2,
      linkPerMinute: 5,
      ...LINKS,
    }
    const one = await startServer(opts)
    const stdoutDefault = await startServer({ ...opts, dir: path.join(dir, 'backup2'), log: undefined }) // the real default logger: console.log
    process.stdout.write = capture
    process.stderr.write = capture
    console.log = (...args) => seen.push(args.join(' '))
    try {
      for (const server of [one, stdoutDefault]) {
        const a = await post(server.port, { url: `${LONG}&n=1` })
        secrets.push(a.json.id)
        await post(server.port, { url: `${LONG}&n=2` })
        await post(server.port, { url: `${LONG}&n=3` }) // 507
        await post(server.port, { url: 'https://evil.example/?connect=1' }) // 400
        await post(server.port, 'x'.repeat(5000)) // 413
        await post(server.port, { url: LONG }, { headers: { 'Content-Type': 'text/plain' } }) // 415 (JSON header overridden)
        await open(server.port, a.json.id) // 302
        await open(server.port, 'AAAAAAAAAA') // 404
        for (let i = 0; i < 6; i += 1) await post(server.port, { url: LONG }, { ip: '203.0.113.50' }) // 429
        t += 31 * 86_400_000
        await open(server.port, a.json.id) // expired 404
        t = 1_800_000_000_000
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
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
  const everything = [...lines, ...seen].join('\n')
  assert.ok(secrets.length === 2 && secrets.every((s) => ID_RE.test(s)))
  for (const secret of [...secrets, 'distinctiveDIDmarker', 'Lovelace', 'Ada-demo', APP, '/l/', '/link', 'connect=']) assert.equal(everything.includes(secret), false, secret)
  assert.deepEqual(lines, [], 'nothing was logged by the link routes')
})

test('NO LOGGING by construction: the link modules have no logger, no console, no stream write, and server.mjs skips these paths', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const name of ['links.mjs', 'link_store.mjs']) {
    const text = (await fs.readFile(path.join(here, '..', name), 'utf8')).split('\n').filter((l) => !l.trimStart().startsWith('//')).join('\n')
    assert.doesNotMatch(text, /console\.|process\.std|\.log\?*\.?\(|\blog\b|\bwarn\b|\berr\.message\b/, name)
  }
  const server = await fs.readFile(path.join(here, '..', 'server.mjs'), 'utf8')
  assert.match(server, /const isLinkPath = \(pathname\) => pathname === '\/link' \|\| pathname\.startsWith\('\/l\/'\)/)
  assert.match(server, /if \(!quiet\) cfg\.log\(`\$\{req\.method\} \$\{status\}`\)/)
  assert.match(server, /if \(!quiet\) cfg\.log\(`\$\{req\.method\} 500`\)/)
})

test('other routes keep logging method and status only (the quiet list is just /link and /l/*)', async () => {
  await withServer(0, LINKS, async ({ srv, lines }) => {
    await call(srv.port, { url: '/health' })
    await post(srv.port, { url: LONG })
    await open(srv.port, 'AAAAAAAAAA')
    assert.deepEqual(lines, ['GET 200'])
  })
})

test('links off (the store cannot open): POST /link is 503 not_configured, GET /l/<id> is the 404 page, /backup still works', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twlinks-'))
  try {
    const lines = []
    const srv = await startServer({ dir: path.join(dir, 'backup'), allowedHosts: [HOST], port: 0, log: (l) => lines.push(l), linksFile: path.join(dir, 'no-such-dir', 'x', 'links.json'), ...LINKS })
    try {
      assert.deepEqual(lines, ['link store unavailable: short links off'])
      const r = await post(srv.port, { url: LONG })
      assert.equal(r.status, 503)
      assert.equal(r.json.error, 'not_configured')
      assert.equal((await open(srv.port, 'AAAAAAAAAA')).status, 404)
      assert.equal((await call(srv.port, { url: '/health' })).status, 200)
    } finally {
      await srv.close()
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
