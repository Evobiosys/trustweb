import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import http from 'node:http'
import { A, T, call, hosted, withServer } from './helpers.mjs'

const P = 8974
const SUB = 8979 // the fake subscriber (the one free port of 8971-8979)
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

test('review: the reader script never sends a stored control character to the terminal (ANSI/OSC escapes, CR, C1, bidi)', async () => {
  const { execFile } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/trustweb_feedback_read.sh')
  await withServer(P, fb(), async ({ dir }) => {
    const hostile = 'clear\u001b[2J title\u001b]0;pwned\u0007 cr\rover c1\u009b31m bidi\u202Eevil\nsecond line'
    assert.equal((await post({ text: hostile, contact: 'me\u001b[31m', page: '/x\u2028y' })).status, 204)
    const out = await new Promise((resolve, reject) =>
      execFile('bash', [script, '--file', path.join(dir, 'feedback.jsonl')], (err, stdout) => (err ? reject(err) : resolve(stdout))),
    )
    const unsafe = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/
    assert.equal(unsafe.test(out), false, JSON.stringify(out))
    assert.ok(out.includes('clear\\u{001b}[2J'))
    assert.ok(out.includes('bidi\\u{202e}evil\nsecond line')) // newlines inside the text stay readable
    assert.ok(out.includes('contact: me\\u{001b}[31m'))
    assert.ok(out.includes('1 entries'))
  })
})

// ---- wave 2 (P14, P15): notify / newsletter / email, forwarded to the subscriber only for a ticked newsletter box ----

/** A fake subscriber on 127.0.0.1:8979. `answer(req, n)` -> {status, headers?, delayMs?}; collects every request it receives. */
async function withSubscriber(answer, body) {
  const seen = []
  const srv = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, type: req.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') })
      const a = answer(req, seen.length)
      setTimeout(() => {
        res.writeHead(a.status, a.headers ?? {})
        res.end()
      }, a.delayMs ?? 0)
    })
  })
  await new Promise((resolve) => srv.listen(SUB, '127.0.0.1', resolve))
  try {
    await body(seen)
  } finally {
    await new Promise((resolve) => srv.close(resolve))
  }
}
const ok = () => ({ status: 200 })
const subscribed = (extra = {}) => fb({ subscriberUrl: `http://127.0.0.1:${SUB}/subscribe`, feedbackPerHour: 1000, ...extra })

test('newsletter:true forwards exactly the join-form body to the subscriber, stores the entry with its email, never logs the address', async () => {
  await withSubscriber(ok, async (seen) => {
    await withServer(P, subscribed(), async ({ dir, lines: log }) => {
      const r = await post({ text: 'great idea', email: '  person@example.org ', notify: true, newsletter: true })
      assert.equal(r.status, 204)
      assert.equal(r.body.length, 0)
      assert.equal(seen.length, 1)
      assert.equal(seen[0].method, 'POST')
      assert.equal(seen[0].url, '/subscribe')
      assert.match(seen[0].type, /^application\/json/)
      assert.deepEqual(JSON.parse(seen[0].body), { email: 'person@example.org', project: 'questhub', source: 'trustweb', gdpr: true })
      const [entry] = await lines(path.join(dir, 'feedback.jsonl'))
      assert.deepEqual(Object.keys(entry).sort(), ['contact', 'email', 'kind', 'newsletter', 'notify', 'page', 't', 'text'])
      assert.deepEqual([entry.email, entry.notify, entry.newsletter], ['person@example.org', true, true])
      assert.ok(log.some((l) => l === 'feedback newsletter sent status=200'), JSON.stringify(log))
      assert.equal(JSON.stringify(log).includes('example.org'), false)
    })
  })
})

test('notify only: the email is stored, nothing goes to the subscriber', async () => {
  await withSubscriber(ok, async (seen) => {
    await withServer(P, subscribed(), async ({ dir }) => {
      assert.equal((await post({ text: 'tell me when ready', email: 'a@example.org', notify: true })).status, 204)
      assert.equal((await post({ text: 'explicitly not', email: 'b@example.org', notify: true, newsletter: false })).status, 204)
      const stored = await lines(path.join(dir, 'feedback.jsonl'))
      assert.deepEqual(stored.map((e) => [e.email, e.notify, e.newsletter]), [['a@example.org', true, false], ['b@example.org', true, false]])
      assert.equal(seen.length, 0)
    })
  })
})

test('no ticked box: an email that comes along is neither validated, stored nor forwarded, and the stored keys stay the old five', async () => {
  await withSubscriber(ok, async (seen) => {
    await withServer(P, subscribed(), async ({ dir }) => {
      for (const extra of [{ email: 'x@example.org' }, { email: 'x@example.org', notify: false, newsletter: false }, { email: 'not an address', notify: null, newsletter: null }, { notify: false, newsletter: false }]) {
        assert.equal((await post({ text: 'just text', ...extra })).status, 204, JSON.stringify(extra))
      }
      const stored = await lines(path.join(dir, 'feedback.jsonl'))
      assert.equal(stored.length, 4)
      for (const e of stored) assert.deepEqual(Object.keys(e).sort(), ['contact', 'kind', 'page', 't', 'text'])
      assert.equal(JSON.stringify(stored).includes('example.org'), false)
      assert.equal(seen.length, 0)
    })
  })
})

test('validation: the boxes must be real booleans, a ticked box needs a plausible single address; nothing is stored or forwarded on 400', async () => {
  await withSubscriber(ok, async (seen) => {
    await withServer(P, subscribed(), async ({ dir }) => {
      const field = async (body, expected) => {
        const r = await post({ text: 'SECRET-INPUT', ...body })
        assert.equal(r.status, 400, JSON.stringify(body).slice(0, 80))
        assert.equal(r.json.field, expected)
        assert.equal(r.text.includes('SECRET-INPUT') || r.text.includes('@'), false)
      }
      await field({ newsletter: 'true', email: 'a@example.org' }, 'newsletter')
      await field({ newsletter: 1, email: 'a@example.org' }, 'newsletter')
      await field({ notify: 'yes', email: 'a@example.org' }, 'notify')
      await field({ notify: [], email: 'a@example.org' }, 'notify')
      await field({ newsletter: true }, 'email')
      await field({ notify: true, email: '' }, 'email')
      await field({ newsletter: true, email: 7 }, 'email')
      for (const bad of ['plainaddress', 'a@b', '@example.org', 'a b@example.org', 'a@@example.org', 'a@example.org\u0000', 'a@exa\nmple.org', `${'a'.repeat(250)}@example.org`, 'a@example.org, b@example.org']) {
        await field({ newsletter: true, email: bad }, 'email')
      }
      assert.deepEqual(await lines(path.join(dir, 'feedback.jsonl')), [])
      assert.equal(seen.length, 0)
      assert.equal((await post({ text: 'fine', newsletter: true, email: `${'a'.repeat(64)}@${'b'.repeat(63)}.example.org` })).status, 204)
      assert.equal(seen.length, 1)
    })
  })
})

test('nothing is forwarded for a honeypot hit, a rate-limited call, a wrong origin, a wrong type or a full file', async () => {
  await withSubscriber(ok, async (seen) => {
    const mail = { email: 'a@example.org', newsletter: true }
    await withServer(P, subscribed({ feedbackPerHour: 1 }), async () => {
      assert.equal((await post({ text: 'spam', homepage: 'http://spam.example', ...mail }, { ip: '5.5.5.5' })).status, 204)
      assert.equal((await post({ text: 'x', ...mail }, { origin: 'https://evil.example.com' })).status, 403)
      assert.equal((await post({ text: 'x', ...mail }, { origin: null })).status, 403)
      assert.equal((await post(JSON.stringify({ text: 'x', ...mail }), { raw: true, headers: { 'Content-Type': 'text/plain' } })).status, 415)
      assert.equal((await post({ text: 'x'.repeat(20000), ...mail }, { ip: '6.6.6.6' })).status, 413)
      assert.equal(seen.length, 0)
      assert.equal((await post({ text: 'first', ...mail }, { ip: '7.7.7.7' })).status, 204)
      assert.equal((await post({ text: 'second', ...mail }, { ip: '7.7.7.7' })).status, 429)
      assert.equal(seen.length, 1) // only the one that was stored
    })
    await withServer(P, subscribed({ feedbackMaxBytes: 50 }), async ({ dir }) => {
      assert.equal((await post({ text: 'x'.repeat(100), ...mail })).status, 507)
      assert.deepEqual(await lines(path.join(dir, 'feedback.jsonl')), [])
      assert.equal(seen.length, 1)
    })
  })
})

test('a subscriber that refuses, hangs, redirects or is gone never changes the answer: 204, the entry stays stored, the outcome is logged', async () => {
  const mail = { email: 'a@example.org', newsletter: true }
  const cases = [
    ['rejected', () => ({ status: 500 }), 'feedback newsletter rejected status=500'],
    ['rejected', () => ({ status: 400 }), 'feedback newsletter rejected status=400'],
    ['failed', () => ({ status: 200, delayMs: 1500 }), 'feedback newsletter failed'],
    ['failed', () => ({ status: 302, headers: { Location: `http://127.0.0.1:${SUB}/elsewhere` } }), 'feedback newsletter failed'],
  ]
  for (const [, answer, expected] of cases) {
    await withSubscriber(answer, async (seen) => {
      await withServer(P, subscribed({ subscriberTimeoutMs: 300 }), async ({ dir, lines: log }) => {
        const r = await post({ text: 'still stored', ...mail })
        assert.equal(r.status, 204)
        assert.equal((await lines(path.join(dir, 'feedback.jsonl'))).length, 1)
        assert.ok(log.includes(expected), `${expected} in ${JSON.stringify(log)}`)
        assert.equal(seen.filter((q) => q.url === '/elsewhere').length, 0) // a redirect is never followed
      })
    })
  }
  await withServer(P, subscribed({ subscriberUrl: 'http://127.0.0.1:1/subscribe' }), async ({ dir, lines: log }) => {
    assert.equal((await post({ text: 'nobody home', ...mail })).status, 204) // connection refused
    assert.equal((await lines(path.join(dir, 'feedback.jsonl'))).length, 1)
    assert.ok(log.includes('feedback newsletter failed'))
  })
})

test('no SUBSCRIBER_URL (or one that is not http(s)): the opt-in is stored, nothing leaves, logged as off', async () => {
  for (const subscriberUrl of ['', 'ftp://example.org/x', 'not a url']) {
    await withSubscriber(ok, async (seen) => {
      await withServer(P, fb({ subscriberUrl }), async ({ dir, lines: log }) => {
        assert.equal((await post({ text: 'x', email: 'a@example.org', newsletter: true })).status, 204)
        assert.equal((await lines(path.join(dir, 'feedback.jsonl')))[0].newsletter, true)
        assert.ok(log.includes('feedback newsletter off'), JSON.stringify(log))
        assert.equal(seen.length, 0)
      })
    })
  }
})

test('the reader script shows the ticked boxes and the address, escaped like everything else', async () => {
  const { execFile } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/trustweb_feedback_read.sh')
  await withServer(P, fb(), async ({ dir }) => {
    const file = path.join(dir, 'feedback.jsonl')
    assert.equal((await post({ text: 'one', email: 'a@example.org', notify: true, newsletter: true })).status, 204)
    assert.equal((await post({ text: 'two' })).status, 204)
    await fs.appendFile(file, `${JSON.stringify({ t: '2026-10-07T10:00Z', kind: 'feedback', text: 'hand-edited', email: 'x@example.org\u001b[31m', notify: true })}\n`)
    const out = await new Promise((resolve, reject) => execFile('bash', [script, '--file', file], (err, stdout) => (err ? reject(err) : resolve(stdout))))
    assert.ok(out.includes('stay informed: alert-me yes  newsletter yes  email: a@example.org'), out)
    assert.ok(out.includes('alert-me yes  newsletter no  email: x@example.org\\u{001b}[31m'), out)
    assert.equal(out.split('stay informed').length - 1, 2) // the entry without boxes prints no such line
    assert.ok(out.includes('3 entries'))
  })
})

// ---- review-wave2 (2026-10-07) ----

test('review: an address with an invisible or format character (zero-width, bidi, BOM, separators) or a box sent as [true] is 400', async () => {
  await withSubscriber(ok, async (seen) => {
    await withServer(P, subscribed({ rateLimit: 1000 }), async ({ dir }) => {
      const invisible = ['​', '‌', '‍', '‎', '‏', '‪', '‮', '⁠', '⁦', '⁩', '﻿', '­', ' ', '　', ' ', '᠎']
      for (const ch of invisible) {
        for (const email of [`a${ch}b@example.org`, `ab@exam${ch}ple.org`]) {
          const r = await post({ text: 'x', newsletter: true, email })
          assert.equal(r.status, 400, `U+${ch.codePointAt(0).toString(16)} in ${JSON.stringify(email)}`)
          assert.equal(r.json.field, 'email')
        }
      }
      for (const box of [[true], { v: true }, 'false', 0]) {
        assert.equal((await post({ text: 'x', newsletter: box, email: 'a@example.org' })).json.field, 'newsletter', JSON.stringify(box))
        assert.equal((await post({ text: 'x', notify: box, email: 'a@example.org' })).json.field, 'notify', JSON.stringify(box))
      }
      assert.deepEqual(await lines(path.join(dir, 'feedback.jsonl')), [])
      assert.equal(seen.length, 0)
      // letters of other scripts stay allowed (an internationalised address is still an address)
      assert.equal((await post({ text: 'x', notify: true, email: 'jürgen@bücher.example' })).status, 204)
    })
  })
})

test('review: the message may be empty when a box is ticked (the form allows it), never otherwise', async () => {
  await withSubscriber(ok, async (seen) => {
    await withServer(P, subscribed(), async ({ dir }) => {
      assert.equal((await post({ text: '', newsletter: true, email: 'a@example.org' })).status, 204)
      assert.equal((await post({ text: '   ', notify: true, email: 'b@example.org' })).status, 204)
      assert.equal((await post({ notify: true, email: 'c@example.org' })).status, 204) // text absent
      assert.equal((await post({ text: '', contact: 'c@example.org' })).json.field, 'text')
      assert.equal((await post({ text: '', notify: false, newsletter: false })).json.field, 'text')
      assert.equal((await post({ text: 5, notify: true, email: 'd@example.org' })).json.field, 'text')
      const stored = await lines(path.join(dir, 'feedback.jsonl'))
      assert.deepEqual(stored.map((e) => [e.text, e.email]), [['', 'a@example.org'], ['', 'b@example.org'], ['', 'c@example.org']])
      assert.equal(seen.length, 1)
    })
  })
})

test('review: at most NEWSLETTER_PER_DAY forwards per UTC day (below the subscriber\'s shared 50); past it the entry is kept, marked deferred, logged, sent again the next day', async () => {
  let clock = Date.parse('2026-10-07T10:00:00Z')
  await withSubscriber(ok, async (seen) => {
    await withServer(P, subscribed({ newsletterPerDay: 2, now: () => clock }), async ({ dir, lines: log }) => {
      const file = path.join(dir, 'feedback.jsonl')
      for (const who of ['a', 'b', 'c']) assert.equal((await post({ text: who, newsletter: true, email: `${who}@example.org` })).status, 204)
      assert.equal((await post({ text: 'notify only', notify: true, email: 'n@example.org' })).status, 204) // does not count
      assert.equal(seen.length, 2)
      const stored = await lines(file)
      assert.deepEqual(stored.map((e) => [e.text, e.deferred === true]), [['a', false], ['b', false], ['c', true], ['notify only', false]])
      assert.equal(stored[3].deferred, undefined)
      assert.equal(log.filter((l) => l === 'feedback newsletter deferred').length, 1)
      assert.equal(JSON.stringify(log).includes('example.org'), false)
      clock = Date.parse('2026-10-08T00:00:30Z')
      assert.equal((await post({ text: 'd', newsletter: true, email: 'd@example.org' })).status, 204)
      assert.equal(seen.length, 3)
      assert.equal((await lines(file))[4].deferred, undefined)
    })
  })
})

test('review: a failed forward (subscriber down) counts against the day as well: the subscriber counts requests, not successes', async () => {
  await withServer(P, subscribed({ subscriberUrl: 'http://127.0.0.1:1/subscribe', newsletterPerDay: 1 }), async ({ dir, lines: log }) => {
    assert.equal((await post({ text: 'one', newsletter: true, email: 'a@example.org' })).status, 204)
    assert.equal((await post({ text: 'two', newsletter: true, email: 'b@example.org' })).status, 204)
    assert.deepEqual(log.filter((l) => l.startsWith('feedback newsletter')), ['feedback newsletter failed', 'feedback newsletter deferred'])
    assert.deepEqual((await lines(path.join(dir, 'feedback.jsonl'))).map((e) => e.deferred === true), [false, true])
  })
})

test('review: SUBSCRIBER_URL over plain http only to a loopback address; https anywhere', async () => {
  const { isForwardUrl } = await import('../newsletter.mjs')
  for (const ok of ['https://subscriber.questhub.eco/subscribe', 'http://127.0.0.1:8979/subscribe', 'http://localhost:8979/x', 'http://[::1]:8979/x']) assert.equal(isForwardUrl(ok), true, ok)
  for (const bad of ['http://subscriber.questhub.eco/subscribe', 'http://10.0.0.1/x', 'ftp://example.org/x', 'not a url', '', 'https://user:pw@example.org/x']) assert.equal(isForwardUrl(bad), false, bad)
})

test('review: the subscriber\'s minute and 30-day buckets are kept too: past 2 a minute or 240 in 30 days the entry is deferred', async () => {
  let clock = Date.parse('2026-10-07T10:00:00Z')
  await withSubscriber(ok, async (seen) => {
    await withServer(P, subscribed({ newsletterPerMinute: 2, newsletterPer30Days: 4, newsletterPerDay: 100, now: () => clock }), async ({ dir, lines: log }) => {
      const send = async (who) => assert.equal((await post({ text: who, newsletter: true, email: `${who}@example.org` })).status, 204)
      await send('a'); await send('b'); await send('c') // the third within the minute
      assert.equal(seen.length, 2)
      clock += 61_000
      await send('d'); await send('e') // a new minute: d and e go (3 and 4 of 4 in 30 days; c was deferred, so not counted)
      clock += 61_000
      await send('f') // the 30-day bucket is full
      clock += 61_000
      await send('g') // still full
      assert.equal(seen.length, 4)
      clock += 30 * 86_400_000
      await send('h')
      assert.equal(seen.length, 5)
      const stored = await lines(path.join(dir, 'feedback.jsonl'))
      assert.deepEqual(stored.map((e) => [e.text, e.deferred === true]), [['a', false], ['b', false], ['c', true], ['d', false], ['e', false], ['f', true], ['g', true], ['h', false]])
      assert.equal(log.filter((l) => l === 'feedback newsletter deferred').length, 3)
    })
  })
})
