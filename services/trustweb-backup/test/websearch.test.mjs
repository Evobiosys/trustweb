// /websearch against fake engines. No fixed ports: the fake engines and the server listen on ephemeral loopback ports,
// so the file may run beside the other suites (and beside other worktrees' suites).
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { call, withServer } from './helpers.mjs'
import { cleanResults, plainText, safeUrl } from '../websearch_clean.mjs'
import { validQuery } from '../websearch.mjs'

const BRAVE_KEY = 'BSAtestkey_brave_0123456789abcdef'
const MOJEEK_KEY = 'mojeek-test-key-0123456789abcdef'
const SENTINEL = 'zebra-sentinel-query'

/**
 * A fake engine: `behave(req, res, body)` answers; every request is recorded as {method, url, headers}.
 * Returns {url, seen, close}.
 */
async function fakeEngine(behave) {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, headers: req.headers })
    behave(req, res)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    seen,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections() }),
  }
}

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}
const braveBody = (results) => ({ query: { original: 'x' }, web: { results } })
const sample = [
  { title: 'Bonobos <b>and</b> trust &amp; peace', url: 'https://example.org/a', description: 'A <strong>short</strong> text &quot;quoted&quot;&nbsp;here' },
  { title: 'Evil', url: 'javascript:alert(1)', description: 'dropped' },
  { title: 'Relative', url: '/just/a/path', description: 'dropped' },
  { title: 'Credentials', url: 'https://user:pw@example.org/', description: 'dropped' },
  { title: 'Duplicate', url: 'https://example.org/a', description: 'dropped' },
  { title: '', url: 'http://plain.example.net/page', description: 42 },
]

/** Runs `body` with a server wired to the fake engines (brave and/or mojeek) and the given extra options. */
async function withSearch({ brave, mojeek, keys, extra = {} }, body) {
  const options = {
    websearchKeys: keys ?? { ...(brave ? { brave: BRAVE_KEY } : {}), ...(mojeek ? { mojeek: MOJEEK_KEY } : {}) },
    ...(brave ? { websearchBraveUrl: `${brave.url}/res/v1/web/search` } : {}),
    ...(mojeek ? { websearchMojeekUrl: `${mojeek.url}/search` } : {}),
    ...extra,
  }
  await withServer(0, options, async (ctx) => body({ ...ctx, port: ctx.srv.port }))
}
const post = (port, payload, headers = {}) =>
  call(port, { method: 'POST', url: '/websearch', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) })
const get = (port, qs, headers = {}) => call(port, { url: `/websearch?${qs}`, headers })

test('engines: lists the six, api ones configured only with a key, no upstream call', async () => {
  const brave = await fakeEngine((q, r) => json(r, braveBody([])))
  try {
    await withSearch({ brave }, async ({ port }) => {
      const r = await call(port, { url: '/websearch/engines' })
      assert.equal(r.status, 200)
      assert.deepEqual(r.json.engines, [
        { id: 'brave', label: 'Brave', mode: 'api', configured: true },
        { id: 'mojeek', label: 'Mojeek', mode: 'api', configured: false },
        { id: 'qwant', label: 'Qwant', mode: 'link_only', configured: false },
        { id: 'ecosia', label: 'Ecosia', mode: 'link_only', configured: false },
        { id: 'metager', label: 'MetaGer', mode: 'link_only', configured: false },
        { id: 'swisscows', label: 'Swisscows', mode: 'link_only', configured: false },
      ])
      assert.equal(r.headers['cache-control'], 'no-store')
      assert.equal(brave.seen.length, 0)
      assert.equal(JSON.stringify(r.json).includes(BRAVE_KEY), false)
    })
  } finally {
    await brave.close()
  }
})

test('brave via POST and via GET: cleaned results, untrusted, key header, nothing of the person goes upstream', async () => {
  const brave = await fakeEngine((q, r) => json(r, braveBody(sample)))
  try {
    await withSearch({ brave }, async ({ port, lines }) => {
      const person = { 'Accept-Language': 'de-AT', Cookie: 'sid=secret', Referer: 'https://app.example.test/x', 'User-Agent': 'PersonBrowser/1', Origin: 'http://app.example.test' }
      const a = await post(port, { q: `  ${SENTINEL} bonobos  `, engine: 'brave' }, person)
      const b = await get(port, `q=${SENTINEL}%20bonobos&engine=brave`, person)
      for (const r of [a, b]) {
        assert.equal(r.status, 200, r.text)
        assert.equal(r.json.engine, 'brave')
        assert.equal(r.json.label, 'Brave')
        assert.equal(r.json.untrusted, true)
        assert.deepEqual(r.json.results, [
          { title: 'Bonobos and trust & peace', url: 'https://example.org/a', snippet: 'A short text "quoted" here' },
          { title: 'plain.example.net', url: 'http://plain.example.net/page', snippet: '' },
        ])
      }
      assert.equal(brave.seen.length, 2)
      for (const s of brave.seen) {
        const u = new URL(s.url, 'http://x')
        assert.equal(u.pathname, '/res/v1/web/search')
        assert.equal(u.searchParams.get('q'), `${SENTINEL} bonobos`) // trimmed
        assert.equal(s.headers['x-subscription-token'], BRAVE_KEY)
        assert.equal(s.headers['user-agent'].startsWith('TrustWeb-websearch/1'), true)
        assert.equal(s.headers.cookie, undefined)
        assert.equal(s.headers.referer, undefined)
        assert.equal(s.headers.origin, undefined)
        assert.equal(s.headers['x-forwarded-for'], undefined)
        assert.notEqual(s.headers['accept-language'], 'de-AT')
      }
      const logged = lines.join('\n')
      assert.equal(logged.includes(SENTINEL), false)
      assert.equal(logged.includes(BRAVE_KEY), false)
      assert.match(logged, /websearch brave upstream 200/)
    })
  } finally {
    await brave.close()
  }
})

test('mojeek: key and fmt in the upstream url, its own response shape, status other than OK is a provider error', async () => {
  let mode = 'ok'
  const mojeek = await fakeEngine((q, r) =>
    json(r, mode === 'ok' ? { response: { status: 'OK', results: [{ title: 'M', url: 'https://m.example.org/', desc: 'D <i>x</i>' }] } } : { response: { status: 'invalid api key' } }),
  )
  try {
    await withSearch({ mojeek }, async ({ port, lines }) => {
      const r = await post(port, { q: SENTINEL, engine: 'mojeek' })
      assert.equal(r.status, 200, r.text)
      assert.deepEqual(r.json, { engine: 'mojeek', label: 'Mojeek', results: [{ title: 'M', url: 'https://m.example.org/', snippet: 'D x' }], untrusted: true })
      const u = new URL(mojeek.seen[0].url, 'http://x')
      assert.equal(u.searchParams.get('api_key'), MOJEEK_KEY)
      assert.equal(u.searchParams.get('fmt'), 'json')
      assert.equal(u.searchParams.get('q'), SENTINEL)
      mode = 'bad'
      const bad = await post(port, { q: SENTINEL, engine: 'mojeek' })
      assert.equal(bad.status, 502)
      assert.equal(bad.json.error, 'provider_error')
      const out = `${lines.join('\n')}${bad.text}`
      assert.equal(out.includes(MOJEEK_KEY), false)
      assert.equal(out.includes(SENTINEL), false)
    })
  } finally {
    await mojeek.close()
  }
})

test('results are capped at 10 and an empty list is a 200', async () => {
  let n = 25
  const brave = await fakeEngine((q, r) => json(r, braveBody(Array.from({ length: n }, (_, i) => ({ title: `T${i}`, url: `https://e.example.org/${i}`, description: 'x'.repeat(900) })))))
  try {
    await withSearch({ brave }, async ({ port }) => {
      const r = await post(port, { q: 'many', engine: 'brave' })
      assert.equal(r.json.results.length, 10)
      assert.equal(Array.from(r.json.results[0].snippet).length, 400)
      n = 0
      const empty = await post(port, { q: 'none', engine: 'brave' })
      assert.equal(empty.status, 200)
      assert.deepEqual(empty.json.results, [])
      assert.equal(empty.json.untrusted, true)
    })
  } finally {
    await brave.close()
  }
})

test('bad requests are 400 with the field named, and nothing goes upstream', async () => {
  const brave = await fakeEngine((q, r) => json(r, braveBody([])))
  try {
    await withSearch({ brave }, async ({ port }) => {
      const cases = [
        [await post(port, { q: 'x', engine: 'qwant' }), 'engine'], // link_only
        [await post(port, { q: 'x', engine: 'nonsense' }), 'engine'],
        [await post(port, { q: 'x', engine: 'BRAVE' }), 'engine'],
        [await post(port, { q: 'x' }), 'engine'],
        [await post(port, { engine: 'brave' }), 'q'],
        [await post(port, { q: '   ', engine: 'brave' }), 'q'],
        [await post(port, { q: 'a'.repeat(201), engine: 'brave' }), 'q'],
        [await post(port, { q: 'line\nbreak', engine: 'brave' }), 'q'],
        [await post(port, { q: 'zero​width', engine: 'brave' }), 'q'],
        [await post(port, { q: ['a'], engine: 'brave' }), 'q'],
        [await post(port, { q: 7, engine: 'brave' }), 'q'],
        [await post(port, 'not json'), 'body'],
        [await post(port, '[1]'), 'body'],
        [await post(port, { q: 'x'.repeat(3000), engine: 'brave' }), 'body'], // over 2 KB
        [await call(port, { method: 'POST', url: '/websearch', headers: { 'Content-Type': 'text/plain' }, body: '{"q":"x","engine":"brave"}' }), 'body'],
        [await get(port, 'engine=brave'), 'q'],
        [await get(port, 'q=a&q=b&engine=brave'), 'q'], // repeated name
        [await get(port, 'q=a'), 'engine'],
      ]
      for (const [r, field] of cases) {
        assert.equal(r.status, 400, `${field}: ${r.text}`)
        assert.equal(r.json.error, 'bad_request')
        assert.equal(r.json.field, field)
      }
      assert.equal((await post(port, { q: 'a'.repeat(200), engine: 'brave' })).status, 200) // exactly 200 is fine
      assert.equal((await post(port, { q: 'ä'.repeat(200), engine: 'brave' })).status, 200) // 200 characters, not bytes
      assert.equal(brave.seen.length, 2)
    })
  } finally {
    await brave.close()
  }
})

test('an engine without a key is 503 not_configured naming the engine; its error never echoes the query', async () => {
  await withSearch({ keys: {} }, async ({ port }) => {
    const r = await post(port, { q: SENTINEL, engine: 'brave' })
    assert.equal(r.status, 503)
    assert.equal(r.json.error, 'not_configured')
    assert.equal(r.json.engine, 'brave')
    assert.equal(r.text.includes(SENTINEL), false)
  })
})

test('a foreign Origin and Sec-Fetch-Site: cross-site are 403, same-origin passes, wrong methods are 405', async () => {
  const brave = await fakeEngine((q, r) => json(r, braveBody([])))
  try {
    await withSearch({ brave }, async ({ port }) => {
      const body = { q: 'x', engine: 'brave' }
      const foreign = await post(port, body, { Origin: 'https://evil.example.com' })
      assert.equal(foreign.status, 403)
      assert.equal(foreign.json.error, 'forbidden_origin')
      const cross = await post(port, body, { 'Sec-Fetch-Site': 'cross-site' })
      assert.equal(cross.status, 403)
      assert.equal((await call(port, { url: '/websearch/engines', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
      assert.equal(brave.seen.length, 0)
      assert.equal((await post(port, body, { 'Sec-Fetch-Site': 'same-origin', Origin: 'http://app.example.test' })).status, 200)
      const put = await call(port, { method: 'PUT', url: '/websearch', body: '{}' })
      assert.equal(put.status, 405)
      assert.equal(put.headers.allow, 'GET, POST')
      const enginesPost = await call(port, { method: 'POST', url: '/websearch/engines', body: '{}' })
      assert.equal(enginesPost.status, 405)
      assert.equal(enginesPost.headers.allow, 'GET')
    })
  } finally {
    await brave.close()
  }
})

test('per-client limit: the third search in a minute is 429 with Retry-After, another client is not affected', async () => {
  const brave = await fakeEngine((q, r) => json(r, braveBody([])))
  try {
    await withSearch({ brave, extra: { websearchPerMinute: 2 } }, async ({ port }) => {
      const body = { q: 'x', engine: 'brave' }
      const ip = { 'X-Forwarded-For': '9.9.9.9' }
      assert.equal((await post(port, body, ip)).status, 200)
      assert.equal((await post(port, body, ip)).status, 200)
      const third = await post(port, body, ip)
      assert.equal(third.status, 429)
      assert.equal(third.json.error, 'rate_limited')
      assert.ok(Number(third.headers['retry-after']) >= 1)
      assert.equal(brave.seen.length, 2)
      assert.equal((await post(port, body, { 'X-Forwarded-For': '8.8.8.8' })).status, 200)
    })
  } finally {
    await brave.close()
  }
})

test('daily budget per engine: past it 429 engine_daily_cap with the seconds to UTC midnight; another engine keeps its own', async () => {
  const brave = await fakeEngine((q, r) => json(r, braveBody([])))
  const mojeek = await fakeEngine((q, r) => json(r, { response: { status: 'OK', results: [] } }))
  try {
    await withSearch({ brave, mojeek, extra: { websearchDailyCaps: { brave: 2, mojeek: 5 }, websearchPerMinute: 100, websearchPerHour: 100 } }, async ({ port }) => {
      const ask = (engine, n) => post(port, { q: 'x', engine }, { 'X-Forwarded-For': `10.0.0.${n}` })
      assert.equal((await ask('brave', 1)).status, 200)
      assert.equal((await ask('brave', 2)).status, 200)
      const over = await ask('brave', 3)
      assert.equal(over.status, 429)
      assert.equal(over.json.error, 'engine_daily_cap')
      assert.equal(over.json.engine, 'brave')
      assert.ok(Number(over.headers['retry-after']) > 0 && Number(over.headers['retry-after']) <= 86400)
      assert.equal(brave.seen.length, 2)
      assert.equal((await ask('mojeek', 4)).status, 200)
    })
  } finally {
    await brave.close()
    await mojeek.close()
  }
})

test('upstream failures: 429 -> 429, 5xx/403/402 -> 502, not JSON -> 502, wrong shape -> 502, oversized -> 502, redirect -> 502, hang -> 504, refused -> 502', async () => {
  let behaviour = 'ok'
  const brave = await fakeEngine((req, res) => {
    if (behaviour === 'rate') return json(res, { type: 'ErrorResponse' }, 429)
    if (behaviour === 'error500') return json(res, { error: SENTINEL }, 500)
    if (behaviour === 'quota') return json(res, { error: SENTINEL }, 402)
    if (behaviour === 'text') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(`<html>${SENTINEL}</html>`) }
    if (behaviour === 'shape') return json(res, { web: { results: 'nope' } })
    if (behaviour === 'big') return json(res, braveBody([{ title: 'x'.repeat(2000), url: 'https://e.example.org/', description: 'y'.repeat(2000) }]))
    if (behaviour === 'redirect') { res.writeHead(302, { Location: 'http://127.0.0.1:1/' }); return res.end() }
    if (behaviour === 'hang') return undefined
    return json(res, braveBody([]))
  })
  try {
    await withSearch({ brave, extra: { websearchTimeoutMs: 300, websearchMaxBytes: 1000, websearchPerMinute: 100, websearchPerHour: 100, websearchDailyCaps: { brave: 100 } } }, async ({ port, lines }) => {
      const expect = {
        rate: [429, 'rate_limited'], error500: [502, 'provider_error'], quota: [502, 'provider_error'], text: [502, 'provider_error'], shape: [502, 'provider_error'],
        big: [502, 'provider_error'], redirect: [502, 'provider_error'], hang: [504, 'provider_timeout'],
      }
      const texts = []
      for (const [name, [status, error]] of Object.entries(expect)) {
        behaviour = name
        const r = await post(port, { q: SENTINEL, engine: 'brave' })
        assert.equal(r.status, status, `${name}: ${r.text}`)
        assert.equal(r.json.error, error, name)
        texts.push(r.text)
      }
      behaviour = 'ok'
      assert.equal((await post(port, { q: 'fine', engine: 'brave' })).status, 200) // the route survives every failure
      const all = texts.join('\n') + lines.join('\n')
      assert.equal(all.includes(SENTINEL), false)
      assert.equal(all.includes(BRAVE_KEY), false)
    })
  } finally {
    await brave.close()
  }
  // connection refused (the engine is gone)
  await withSearch({ keys: { brave: BRAVE_KEY }, extra: { websearchBraveUrl: 'http://127.0.0.1:1/x' } }, async ({ port }) => {
    const r = await post(port, { q: 'x', engine: 'brave' })
    assert.equal(r.status, 502)
    assert.equal(r.json.error, 'provider_error')
  })
})

test('calls in flight are bounded: a second search while one hangs is 503 busy, and the slot comes back', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  let hold = true
  const brave = await fakeEngine((req, res) => { if (hold) gate.then(() => json(res, braveBody([]))); else json(res, braveBody([])) })
  try {
    await withSearch({ brave, extra: { websearchMaxInFlight: 1, websearchPerMinute: 100, websearchPerHour: 100, websearchTimeoutMs: 5000 } }, async ({ port }) => {
      const first = post(port, { q: 'a', engine: 'brave' }, { 'X-Forwarded-For': '1.1.1.1' })
      while (brave.seen.length === 0) await new Promise((r) => setTimeout(r, 10))
      const second = await post(port, { q: 'b', engine: 'brave' }, { 'X-Forwarded-For': '2.2.2.2' })
      assert.equal(second.status, 503)
      assert.equal(second.json.error, 'busy')
      hold = false
      release()
      assert.equal((await first).status, 200)
      assert.equal((await post(port, { q: 'c', engine: 'brave' }, { 'X-Forwarded-For': '3.3.3.3' })).status, 200)
    })
  } finally {
    await brave.close()
  }
})

test('keys come from the systemd credential directory (JSON {"key"}); a malformed one counts as absent; base url must be https or loopback', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twcred-'))
  const saved = { cd: process.env.CREDENTIALS_DIRECTORY, url: process.env.WEBSEARCH_MOJEEK_URL }
  try {
    await fs.writeFile(path.join(dir, 'websearch-brave'), JSON.stringify({ key: BRAVE_KEY }), { mode: 0o600 })
    await fs.writeFile(path.join(dir, 'websearch-mojeek'), JSON.stringify({ key: 'has spaces and "quotes"' }), { mode: 0o600 })
    process.env.CREDENTIALS_DIRECTORY = dir
    process.env.WEBSEARCH_MOJEEK_URL = 'http://evil.example.com/search' // plain http to a foreign host: refused, the default stays
    const { loadWebsearchConfig } = await import('../websearch.mjs')
    const cfg = loadWebsearchConfig({})
    assert.equal(cfg.websearchKeys.brave, BRAVE_KEY)
    assert.equal(cfg.websearchKeys.mojeek, '')
    assert.equal(cfg.websearchMojeekUrl, 'https://www.mojeek.com/search')
    assert.equal(cfg.websearchDailyCaps.brave, 30)
    delete process.env.CREDENTIALS_DIRECTORY
    assert.equal(loadWebsearchConfig({}).websearchKeys.brave, '')
  } finally {
    for (const [k, v] of [['CREDENTIALS_DIRECTORY', saved.cd], ['WEBSEARCH_MOJEEK_URL', saved.url]]) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('websearch_clean: plain text, entities once, url filter, caps', () => {
  assert.equal(plainText('<p>a <script>x</script>b</p>', 100), 'a x b')
  assert.equal(plainText('&lt;b&gt; &amp;amp; &#65;&#x42; &#0;', 100), '<b> &amp; AB')
  assert.equal(plainText('a‮b\u0000c\n\td', 100), 'a b c d')
  assert.equal(plainText(42, 10), '')
  assert.equal(plainText('x'.repeat(50), 10), `${'x'.repeat(9)}…`)
  assert.equal(safeUrl('https://example.org/a b'), 'https://example.org/a%20b')
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org/', '//example.org/', '/path', 'https://u:p@example.org/', 'https://', '', null, 5, `https://example.org/${'a'.repeat(2000)}`]) {
    assert.equal(safeUrl(bad), null, String(bad))
  }
  assert.deepEqual(cleanResults('nope'), [])
  assert.deepEqual(cleanResults([null, 3, {}, { url: 'https://a.example/' }]), [{ title: 'a.example', url: 'https://a.example/', snippet: '' }])
  assert.equal(validQuery('  ok  '), 'ok')
  assert.equal(validQuery('tab\tinside'), null)
  assert.equal(validQuery(''), null)
  assert.equal(validQuery('😀'.repeat(200)), '😀'.repeat(200)) // 200 emoji = 200 characters
})
