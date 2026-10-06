import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { A, T, call, hosted, withServer } from './helpers.mjs'

const P = 8974
const SITE = 'https://idea2.site'
const APP = 'https://app.idea2.site'

/** Server options with the feedback file inside the per-test temp dir (removed with it). */
const fb = (extra = {}) => (dir) => ({ feedbackFile: path.join(dir, 'feedback.jsonl'), ...extra })
const post = (body, { origin = SITE, headers = {}, ip, raw = false } = {}) =>
  call(P, {
    method: 'POST',
    url: '/feedback',
    headers: { 'Content-Type': 'application/json', ...(origin === null ? {} : { Origin: origin }), ...headers },
    body: raw ? body : JSON.stringify(body),
    ip,
  })
async function lines(file) {
  try {
    return (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
}
test('stores one JSON line (0600, minute-precision time, no IP), answers 204 with an empty body, CORS for the exact origin', async () => {
  const o = fb()
  await withServer(P, o, async ({ dir }) => {
    const file = path.join(dir, 'feedback.jsonl')
    for (const origin of [SITE, APP]) {
      const r = await post({ text: '  Great idea, wish it had X  ', contact: 'me@example.org', page: '/trustweb/pricing.html', kind: 'pricing' }, { origin, ip: '9.9.9.9' })
      assert.equal(r.status, 204)
      assert.equal(r.body.length, 0)
      assert.equal(r.headers['access-control-allow-origin'], origin)
      assert.equal(r.headers.vary, 'Origin')
    }
    const stored = await lines(file)
    assert.equal(stored.length, 2)
    assert.deepEqual(Object.keys(stored[0]).sort(), ['contact', 'kind', 'page', 't', 'text'])
    assert.equal(stored[0].text, 'Great idea, wish it had X')
    assert.equal(stored[0].kind, 'pricing')
    assert.match(stored[0].t, /^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/)
    assert.equal(JSON.stringify(stored).includes('9.9.9.9'), false)
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
    const defaulted = await post({ text: 'just text' })
    assert.equal(defaulted.status, 204)
    assert.deepEqual((await lines(file))[2], { ...(await lines(file))[2], kind: 'feedback', contact: '', page: '' })
  })
})

test('preflight: OPTIONS answers 204 with the CORS headers for the two origins only', async () => {
  const o = fb()
  await withServer(P, o, async ({ dir }) => {
    const file = path.join(dir, 'feedback.jsonl')
    for (const origin of [SITE, APP]) {
      const r = await call(P, { method: 'OPTIONS', url: '/feedback', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } })
      assert.equal(r.status, 204)
      assert.equal(r.headers['access-control-allow-origin'], origin)
      assert.equal(r.headers['access-control-allow-methods'], 'POST, OPTIONS')
      assert.equal(r.headers['access-control-allow-headers'], 'Content-Type')
      assert.equal(r.headers['access-control-max-age'], '600')
    }
    for (const origin of ['https://evil.example.com', 'http://idea2.site', 'https://idea2.site.evil.example.com', 'https://www.idea2.site', 'null']) {
      const r = await call(P, { method: 'OPTIONS', url: '/feedback', headers: { Origin: origin } })
      assert.equal(r.status, 403, origin)
      assert.equal(r.headers['access-control-allow-origin'], undefined)
    }
    assert.equal((await call(P, { method: 'OPTIONS', url: '/feedback' })).status, 403)
  })
})

test('POST needs an allowed Origin: missing, foreign, wrong scheme are 403 and store nothing', async () => {
  const o = fb()
  await withServer(P, o, async ({ dir }) => {
    const file = path.join(dir, 'feedback.jsonl')
    for (const origin of [null, 'https://evil.example.com', 'http://idea2.site', 'https://idea2.site:8443']) {
      assert.equal((await post({ text: 'x' }, { origin })).status, 403, String(origin))
    }
    assert.deepEqual(await lines(file), [])
  })
})

test('the Origin exception is scoped: https://idea2.site is still 403 on /backup, /hosted and /transcribe; GET /feedback is not an exception', async () => {
  const o = fb()
  await withServer(P, o, async ({ dir }) => {
    const file = path.join(dir, 'feedback.jsonl')
    const id = 'a'.repeat(64)
    assert.equal((await call(P, { url: `/backup/${id}`, headers: { Origin: SITE } })).status, 403)
    assert.equal((await call(P, { method: 'PUT', url: `/backup/${id}`, headers: { Origin: SITE, 'X-Write-Token': T }, body: 'x' })).status, 403)
    assert.equal((await call(P, { url: '/hosted/status', headers: { Origin: SITE } })).status, 403)
    assert.equal((await call(P, { method: 'PUT', url: hosted(A, '1'.repeat(32)), headers: { Origin: SITE, 'X-Write-Token': T, 'X-Seconds': '1' }, body: 'x' })).status, 403)
    assert.equal((await call(P, { method: 'POST', url: '/transcribe', headers: { Origin: SITE } })).status, 403)
    assert.equal((await call(P, { url: '/feedback', headers: { Origin: SITE } })).status, 403) // GET: the old guard
    assert.equal((await call(P, { url: '/feedback' })).status, 405) // same-origin GET
    assert.equal((await call(P, { method: 'DELETE', url: '/feedback' })).status, 405)
    assert.equal((await call(P, { url: '/backup/health', headers: { Origin: SITE } })).status, 403)
    assert.equal((await call(P, { url: '/backup/health', headers: { Origin: 'https://app.example.test' } })).status, 200) // allowedHosts behaviour unchanged
    assert.equal((await call(P, { method: 'POST', url: '/feedback', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: '{"text":"x"}', host: 'evil.example.com' })).status, 421)
  })
})

test('validation: text 1..4000, contact 0..200, page 0..200, kind enum, JSON object, content type, body size', async () => {
  const o = fb({ feedbackPerHour: 1000 })
  await withServer(P, o, async ({ dir }) => {
    const file = path.join(dir, 'feedback.jsonl')
    const field = async (body, expected) => {
      const r = await post(body)
      assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80))
      assert.equal(r.json.field, expected)
      assert.equal(r.text.includes('SECRET-INPUT'), false) // never echoes the input
    }
    await field({}, 'text')
    await field({ text: '   ' }, 'text')
    await field({ text: 5 }, 'text')
    await field({ text: 'x'.repeat(4001) }, 'text')
    await field({ text: 'SECRET-INPUT', contact: 'c'.repeat(201) }, 'contact')
    await field({ text: 'SECRET-INPUT', contact: 7 }, 'contact')
    await field({ text: 'SECRET-INPUT', page: 'p'.repeat(201) }, 'page')
    await field({ text: 'SECRET-INPUT', kind: 'spam' }, 'kind')
    await field([], 'body')
    await field(null, 'body')
    assert.equal((await post('{not json', { raw: true })).json.field, 'body')
    assert.equal((await post('x', { raw: true, headers: { 'Content-Type': 'text/plain' } })).status, 415)
    assert.equal((await post(JSON.stringify({ text: 'x'.repeat(20000) }), { raw: true })).status, 413)
    assert.equal((await post({ text: 'x'.repeat(4000), contact: 'c'.repeat(200), page: 'p'.repeat(200), kind: 'bug' })).status, 204)
    assert.equal((await post({ text: 'ok', kind: 'feedback' })).status, 204)
    assert.equal((await lines(file)).length, 2)
  })
})

test('honeypot: a filled "homepage" field is answered 204 and silently dropped', async () => {
  const o = fb()
  await withServer(P, o, async ({ dir }) => {
    const file = path.join(dir, 'feedback.jsonl')
    const r = await post({ text: 'buy pills', homepage: 'http://spam.example' })
    assert.equal(r.status, 204)
    assert.equal(r.body.length, 0)
    assert.deepEqual(await lines(file), [])
    assert.equal((await post({ text: 'real', homepage: '' })).status, 204)
    assert.equal((await lines(file)).length, 1)
  })
})

test('rate limit per IP (5 per hour): 429 with Retry-After and CORS headers; another IP unaffected', async () => {
  const o = fb({ feedbackPerHour: 2 })
  await withServer(P, o, async ({ dir }) => {
    const file = path.join(dir, 'feedback.jsonl')
    assert.equal((await post({ text: '1' }, { ip: '3.3.3.3' })).status, 204)
    assert.equal((await post({ text: '2' }, { ip: '3.3.3.3' })).status, 204)
    const r = await post({ text: '3' }, { ip: '3.3.3.3' })
    assert.equal(r.status, 429)
    assert.equal(r.json.error, 'rate_limited')
    assert.ok(Number(r.headers['retry-after']) > 0)
    assert.equal(r.headers['access-control-allow-origin'], SITE)
    assert.equal((await post({ text: '4' }, { ip: '4.4.4.4' })).status, 204)
    assert.equal((await lines(file)).length, 3)
  })
})

test('total file cap: 507 feedback_full, the file stops growing; unconfigured is 503', async () => {
  const o = fb({ feedbackMaxBytes: 300 })
  await withServer(P, o, async ({ dir }) => {
    const file = path.join(dir, 'feedback.jsonl')
    let stored = 0
    let last
    for (let i = 0; i < 20; i += 1) {
      last = await post({ text: `entry number ${i} with some padding to fill the file` }, { ip: `10.0.0.${i}` })
      if (last.status === 204) stored += 1
      else break
    }
    assert.ok(stored >= 1 && stored < 20)
    assert.equal(last.status, 507)
    assert.equal(last.json.error, 'feedback_full')
    assert.ok((await fs.stat(file)).size <= 300)
  })
  await withServer(P, { feedbackFile: '' }, async () => {
    const r = await post({ text: 'x' })
    assert.equal(r.status, 503)
    assert.equal(r.json.error, 'not_configured')
    assert.equal((await call(P, { url: '/hosted/status' })).json.feedback, false)
  })
})

test('an existing feedback file with loose permissions is tightened to 0600 on the next write', async () => {
  let file
  await withServer(P, (dir) => {
    file = path.join(dir, 'feedback.jsonl')
    return { feedbackFile: file }
  }, async () => {
    await fs.writeFile(file, '', { mode: 0o644 })
    await fs.chmod(file, 0o644)
    assert.equal((await post({ text: 'x' })).status, 204)
    assert.equal((await fs.stat(file)).mode & 0o777, 0o600)
  })
})
