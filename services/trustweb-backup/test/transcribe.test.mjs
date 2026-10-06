import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { A, A2, T, T2, call, tmpEmpty, usage, withServer } from './helpers.mjs'

const P = 8972 // the server under test
const STUB = 8973 // the fake provider
const KEY = 'sk-test-secret-key-0123456789'
const PRODUCT = '42'
const URL_ = `http://127.0.0.1:${STUB}/1/ai/${PRODUCT}/openai/audio/transcriptions`
const AUDIO = Buffer.concat([Buffer.from('AUDIO-MARKER-'), Buffer.alloc(240000, 5)]) // 60 s at 32 kbps
const SEGMENTS = [{ id: 0, start: 0, end: 4.2, text: ' Hello world.' }, { id: 1, start: 4.2, end: 9.04, text: 'Zweiter Satz.' }]
const VERBOSE = { task: 'transcribe', language: 'en', duration: 9.04, text: ' Hello world. Zweiter Satz.', segments: SEGMENTS }

/** A fake Infomaniak AI Tools: async submit + polling, scripted per test. */
async function withProvider(script, body) {
  const seen = { submits: [], polls: 0, rawBody: Buffer.alloc(0) }
  const state = { submit: { status: 200, body: { batch_id: 'b1' } }, results: [{ status: 'success', data: VERBOSE }], delayMs: 0 }
  Object.assign(state, script)
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const buf = Buffer.concat(chunks)
    const json = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(obj))
    }
    if (req.method === 'POST' && req.url === `/1/ai/${PRODUCT}/openai/audio/transcriptions`) {
      seen.submits.push({ auth: req.headers.authorization, contentType: req.headers['content-type'], text: buf.toString('latin1'), size: buf.length })
      if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs))
      return json(state.submit.status, state.submit.body)
    }
    if (req.method === 'GET' && req.url === `/1/ai/${PRODUCT}/results/b1`) {
      assert.equal(req.headers.authorization, `Bearer ${KEY}`)
      const r = state.results[Math.min(seen.polls, state.results.length - 1)]
      seen.polls += 1
      return typeof r === 'number' ? json(r, { result: 'error', error: { code: 'internal', description: 'RAW PROVIDER BODY MUST NOT LEAK' } }) : json(200, r)
    }
    if (req.method === 'GET' && req.url === '/dl/b1') return json(200, VERBOSE)
    json(404, {})
  })
  await new Promise((resolve) => server.listen(STUB, '127.0.0.1', resolve))
  try {
    await body({ seen, state })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

const base = { transcribeUrl: URL_, transcribeKey: KEY, transcribePollMs: 10, transcribeTimeoutMs: 3000 }
const hdr = (extra = {}) => ({ 'X-Account': A, 'X-Write-Token': T, 'X-Audio-Seconds': '60', 'Content-Type': 'audio/webm;codecs=opus', ...extra })
const transcribe = (headers, body = AUDIO, extra = {}) => call(P, { method: 'POST', url: '/transcribe', headers, body, ...extra })

test('success: text with timed segments, provider gets the key, model, verbose_json and the language hint; polls until done', async () => {
  await withProvider({ results: [{ status: 'pending' }, { status: 'processing' }, { status: 'success', data: VERBOSE }] }, async ({ seen }) => {
    await withServer(P, base, async ({ hostedDir, lines }) => {
      const r = await transcribe(hdr({ 'X-Language': 'de' }))
      assert.equal(r.status, 200, r.text)
      assert.deepEqual(r.json.segments, [{ start: 0, end: 4.2, text: 'Hello world.' }, { start: 4.2, end: 9.04, text: 'Zweiter Satz.' }])
      assert.equal(r.json.text, 'Hello world. Zweiter Satz.')
      assert.equal(r.json.language, 'en')
      assert.equal(r.json.secondsCharged, 60)
      assert.deepEqual(r.json.allowance, { secondsUsed: 60, secondsLimit: 36000 })
      assert.equal(seen.polls, 3)
      assert.equal(seen.submits.length, 1)
      const s = seen.submits[0]
      assert.equal(s.auth, `Bearer ${KEY}`)
      assert.match(s.contentType, /^multipart\/form-data; boundary=/)
      assert.match(s.text, /name="model"\r\n\r\nwhisper\r\n/)
      assert.match(s.text, /name="response_format"\r\n\r\nverbose_json\r\n/)
      assert.match(s.text, /name="timestamp_granularities\[\]"\r\n\r\nsegment\r\n/)
      assert.match(s.text, /name="language"\r\n\r\nde\r\n/)
      assert.match(s.text, /name="file"; filename="audio\.webm"/)
      assert.ok(s.text.includes('AUDIO-MARKER-'))
      // nothing stored: no spool left, no audio or text on disk, no content or key in the log
      await tmpEmpty(hostedDir)
      const files = await fs.readdir(hostedDir, { recursive: true })
      for (const f of files) {
        const stat = await fs.stat(path.join(hostedDir, f))
        if (stat.isFile()) {
          const content = await fs.readFile(path.join(hostedDir, f))
          assert.equal(content.includes('AUDIO-MARKER-'), false)
          assert.equal(content.includes('Hello world'), false)
        }
      }
      assert.equal(lines.some((l) => l.includes('Hello') || l.includes(KEY) || l.includes('AUDIO')), false)
    })
  })
})

test('no language hint (or "auto") sends no language field; mp4 goes out as .m4a', async () => {
  await withProvider({}, async ({ seen }) => {
    await withServer(P, base, async () => {
      assert.equal((await transcribe(hdr({ 'X-Language': 'auto', 'Content-Type': 'audio/mp4' }))).status, 200)
      assert.equal(seen.submits[0].text.includes('name="language"'), false)
      assert.match(seen.submits[0].text, /filename="audio\.m4a"/)
    })
  })
})

test('provider result in every shape: JSON string, plain text, null data with a download url', async () => {
  for (const [name, result, expect] of [
    ['json string', { status: 'success', data: JSON.stringify(VERBOSE) }, 'Hello world. Zweiter Satz.'],
    ['plain text', { status: 'success', data: 'Just the words.' }, 'Just the words.'],
    ['download url', { status: 'success', data: null, url: `http://127.0.0.1:${STUB}/dl/b1` }, 'Hello world. Zweiter Satz.'],
  ]) {
    await withProvider({ results: [result] }, async () => {
      await withServer(P, base, async () => {
        const r = await transcribe(hdr())
        assert.equal(r.status, 200, name)
        assert.equal(r.json.text, expect, name)
        if (name === 'plain text') assert.deepEqual(r.json.segments, [])
      })
    })
  }
})

test('a download url on a foreign host is refused, so the key is never sent there', async () => {
  await withProvider({ results: [{ status: 'success', data: null, url: 'http://127.0.0.2:1/steal' }] }, async () => {
    await withServer(P, base, async () => {
      const r = await transcribe(hdr())
      assert.equal(r.status, 502)
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0)
    })
  })
})

test('provider failures: submit 500, failed job, unusable body: 502 provider_error, nothing leaks, the allowance is refunded', async () => {
  for (const script of [
    { submit: { status: 500, body: { result: 'error', error: { description: 'RAW PROVIDER BODY MUST NOT LEAK' } } } },
    { submit: { status: 401, body: { error: 'bad key' } } },
    { submit: { status: 200, body: { nothing: true } } },
    { results: [{ status: 'failed' }] },
    { results: [{ status: 'cancelled' }] },
    { results: [500] },
    { results: [{ status: 'success', data: null, url: null }] },
  ]) {
    await withProvider(script, async () => {
      await withServer(P, base, async ({ lines }) => {
        const r = await transcribe(hdr())
        assert.equal(r.status, 502, JSON.stringify(script))
        assert.equal(r.json.error, 'provider_error')
        assert.equal(r.text.includes('RAW PROVIDER'), false)
        assert.equal(r.text.includes(KEY), false)
        assert.equal(lines.some((l) => l.includes('RAW PROVIDER') || l.includes(KEY)), false)
        assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0)
      })
    })
  }
})

test('provider that never finishes: 504 provider_timeout after the deadline, refunded', async () => {
  await withProvider({ results: [{ status: 'processing' }] }, async ({ seen }) => {
    await withServer(P, { ...base, transcribeTimeoutMs: 300 }, async () => {
      const t0 = Date.now()
      const r = await transcribe(hdr())
      assert.equal(r.status, 504)
      assert.equal(r.json.error, 'provider_timeout')
      assert.ok(Date.now() - t0 < 2000)
      assert.ok(seen.polls >= 2)
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0)
    })
  })
  await withProvider({ delayMs: 600 }, async () => {
    await withServer(P, { ...base, transcribeTimeoutMs: 200 }, async () => {
      assert.equal((await transcribe(hdr())).status, 504) // the submit itself hangs
    })
  })
})

test('not configured: no key (or no hosted dir) is 503 not_configured, before any audio is read', async () => {
  await withServer(P, { transcribeUrl: URL_, transcribeKey: '' }, async () => {
    const r = await transcribe(hdr())
    assert.equal(r.status, 503)
    assert.equal(r.json.error, 'not_configured')
    assert.equal((await call(P, { url: '/hosted/status' })).json.transcribe, false)
  })
  await withServer(P, { ...base, hostedDir: '' }, async () => {
    assert.equal((await transcribe(hdr())).status, 503)
  })
  await withServer(P, base, async () => {
    assert.equal((await call(P, { url: '/hosted/status' })).json.transcribe, true)
  })
})

test('per-account allowance: counted in seconds, 402 with scope transcription, per account, not shared with storage', async () => {
  await withProvider({}, async ({ seen }) => {
    await withServer(P, { ...base, accountSecondsLimit: 100 }, async () => {
      assert.equal((await transcribe(hdr())).status, 200)
      const over = await transcribe(hdr())
      assert.equal(over.status, 402)
      assert.equal(over.json.error, 'allowance_reached')
      assert.equal(over.json.scope, 'transcription')
      assert.equal(over.json.transcription.secondsUsed, 60)
      assert.equal(over.json.transcription.secondsLimit, 100)
      assert.equal(seen.submits.length, 1) // refused before the provider was called
      assert.equal((await transcribe(hdr({ 'X-Audio-Seconds': '40' }), Buffer.alloc(100000, 1))).status, 200) // 100 s in total: the edge fits
      assert.equal((await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2 }))).status, 200) // another person
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 100)
      assert.equal((await usage(P, A)).json.secondsUsed, 0) // storage is a separate counter
    })
  })
})

test('global daily budget: 429 busy_today with Retry-After; refunds give the seconds back', async () => {
  await withProvider({}, async ({ state }) => {
    await withServer(P, { ...base, transcribeDailySeconds: 100, transcribeIpDailySeconds: 100000 }, async () => {
      assert.equal((await transcribe(hdr())).status, 200)
      const busy = await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2 }))
      assert.equal(busy.status, 429)
      assert.equal(busy.json.error, 'busy_today')
      assert.ok(Number(busy.headers['retry-after']) > 0)
      assert.equal((await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2, 'X-Audio-Seconds': '40' }), Buffer.alloc(100000, 1))).status, 200)
      state.results = [{ status: 'failed' }]
    })
    await withServer(P, { ...base, transcribeDailySeconds: 100, transcribeIpDailySeconds: 100000 }, async () => {
      assert.equal((await transcribe(hdr())).status, 502) // failed: refunded ...
      assert.equal((await transcribe(hdr())).status, 502) // ... so the budget is not eaten by failures
    })
  })
})

test('per-IP daily cap: one network cannot drain the budget by minting accounts; another network is fine', async () => {
  await withProvider({}, async () => {
    await withServer(P, { ...base, transcribeIpDailySeconds: 100 }, async () => {
      assert.equal((await transcribe(hdr(), AUDIO, { ip: '5.5.5.5' })).status, 200)
      const second = await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2 }), AUDIO, { ip: '5.5.5.5' })
      assert.equal(second.status, 429)
      assert.equal(second.json.error, 'ip_daily_limit')
      assert.equal((await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2 }), AUDIO, { ip: '6.6.6.6' })).status, 200)
    })
  })
})

test('a lying X-Audio-Seconds is charged by size (48 kbps floor) and corrected upwards to the provider duration', async () => {
  await withProvider({}, async () => {
    await withServer(P, base, async () => {
      const lie = await transcribe(hdr({ 'X-Audio-Seconds': '1' }), Buffer.alloc(600000, 1))
      assert.equal(lie.status, 200)
      assert.equal(lie.json.secondsCharged, 100)
    })
  })
  await withProvider({ results: [{ status: 'success', data: { ...VERBOSE, duration: 500, segments: [{ start: 0, end: 500, text: 'long' }] } }] }, async () => {
    await withServer(P, base, async () => {
      const long = await transcribe(hdr())
      assert.equal(long.status, 200)
      assert.equal(long.json.secondsCharged, 500)
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 500)
    })
  })
})

test('validation: headers, content type, token, size', async () => {
  await withProvider({}, async ({ seen }) => {
    await withServer(P, { ...base, transcribeMaxBytes: 1000 }, async () => {
      const bad = async (headers, status, field) => {
        const r = await transcribe(headers, Buffer.alloc(100, 1))
        assert.equal(r.status, status, JSON.stringify(headers))
        if (field) assert.equal(r.json.field, field)
      }
      await bad(hdr({ 'X-Account': 'nope' }), 400, 'X-Account')
      await bad(hdr({ 'X-Write-Token': 'nope' }), 400, 'X-Write-Token')
      for (const s of ['0', '3601', 'x', '1.5']) await bad(hdr({ 'X-Audio-Seconds': s }), 400, 'X-Audio-Seconds')
      await bad(hdr({ 'X-Language': 'German' }), 400, 'X-Language')
      await bad(hdr({ 'Content-Type': 'text/plain' }), 415)
      await bad(hdr({ 'Content-Type': 'application/octet-stream' }), 415)
      assert.equal((await transcribe(hdr(), Buffer.alloc(0))).status, 400)
      assert.equal((await transcribe(hdr(), Buffer.alloc(1001, 1))).status, 413) // declared
      assert.equal((await transcribe(hdr(), [Buffer.alloc(600, 1), Buffer.alloc(600, 1)])).status, 413) // streamed
      assert.equal((await call(P, { url: '/transcribe' })).status, 405)
      assert.equal((await transcribe(hdr(), Buffer.alloc(1000, 1))).status, 200) // exactly at the cap
      assert.equal(seen.submits.length, 1)
    })
  })
})

test('wrong token on a claimed account is 403 and the provider is never called; a forged account costs no provider call', async () => {
  await withProvider({}, async ({ seen }) => {
    await withServer(P, base, async () => {
      assert.equal((await transcribe(hdr())).status, 200)
      const r = await transcribe(hdr({ 'X-Write-Token': T2 }))
      assert.equal(r.status, 403)
      assert.equal(r.json.error, 'forbidden_token')
      assert.equal(seen.submits.length, 1)
    })
  })
})

test('too many in flight: 429 busy while the provider is slow', async () => {
  await withProvider({ delayMs: 400 }, async () => {
    await withServer(P, { ...base, transcribeMaxConcurrent: 1 }, async () => {
      const first = transcribe(hdr())
      await new Promise((r) => setTimeout(r, 100))
      const second = await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2 }))
      assert.equal(second.status, 429)
      assert.equal(second.json.error, 'busy')
      assert.equal((await first).status, 200)
    })
  })
})

test('Host and Origin guard cover /transcribe: foreign Origin and https://idea2.site are 403, bad Host 421', async () => {
  await withProvider({}, async ({ seen }) => {
    await withServer(P, base, async () => {
      assert.equal((await transcribe(hdr({ Origin: 'https://idea2.site' }))).status, 403)
      assert.equal((await transcribe(hdr({ Origin: 'https://evil.example.com' }))).status, 403)
      assert.equal((await transcribe(hdr(), AUDIO, { host: 'evil.example.com' })).status, 421)
      assert.equal(seen.submits.length, 0)
    })
  })
})
