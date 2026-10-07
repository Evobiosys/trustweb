// The default provider (openrouter) against a fake OpenRouter speech-to-text endpoint. Ports: 8976 server, 8978 fake provider.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { A, A2, T, T2, call, tmpEmpty, usage, withServer } from './helpers.mjs'
import { loadConfig, readCredentialKey } from '../config.mjs'
import { approxSegments, segmentsReliable, splitSentences, withSegments } from '../transcribe_provider.mjs'
import { isoLanguage } from '../transcribe_openrouter.mjs'

const P = 8976 // the server under test
const STUB = 8978 // the fake OpenRouter
const KEY = 'sk-or-v1-0123456789abcdef0123456789abcdef'
const AUDIO = Buffer.concat([Buffer.from('AUDIO-MARKER-'), Buffer.alloc(240000, 5)]) // 60 s at 32 kbps
const SEGMENTS = [{ id: 0, start: 0, end: 4.2, text: ' Hello world.' }, { id: 1, start: 4.2, end: 9.04, text: 'Zweiter Satz.' }]
const VERBOSE = { task: 'transcribe', language: 'german', duration: 9.04, text: ' Hello world. Zweiter Satz.', segments: SEGMENTS, usage: { seconds: 9.04, cost: 0.0001, total_tokens: 0 } }

/** A fake OpenRouter: records every call, answers from `script.replies` (one per call; the last repeats). */
async function withOpenRouter(script, body) {
  const seen = { calls: [], active: 0, maxActive: 0, answered: 0 }
  const state = { replies: [{ status: 200, json: VERBOSE }], delayMs: 0, ...script }
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    let parsed = null
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      // recorded as null
    }
    const index = seen.calls.length
    seen.calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, contentType: req.headers['content-type'], body: parsed, size: Buffer.concat(chunks).length })
    seen.active += 1
    seen.maxActive = Math.max(seen.maxActive, seen.active)
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs))
    seen.active -= 1
    if (state.hang) return // never answers
    const reply = state.replies[Math.min(index, state.replies.length - 1)]
    res.writeHead(reply.status, { 'Content-Type': 'application/json' })
    res.end(reply.raw ?? JSON.stringify(reply.json ?? { error: { message: 'RAW PROVIDER BODY MUST NOT LEAK' } }))
    seen.answered += 1
  })
  await new Promise((resolve) => server.listen(STUB, '127.0.0.1', resolve))
  try {
    await body({ seen, state })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

const base = { transcribeKey: KEY, transcribeEnabled: true, openrouterUrl: `http://127.0.0.1:${STUB}/api/v1`, transcribeTimeoutMs: 3000 }
const hdr = (extra = {}) => ({ 'X-Account': A, 'X-Write-Token': T, 'X-Audio-Seconds': '60', 'Content-Type': 'audio/webm;codecs=opus', ...extra })
const transcribe = (headers, body = AUDIO, extra = {}) => call(P, { method: 'POST', url: '/transcribe', headers, body, ...extra })

test('success: provider segments, the key and the data policy go out, the audio goes out as base64 webm, nothing is stored or logged', async () => {
  await withOpenRouter({}, async ({ seen }) => {
    await withServer(P, base, async ({ hostedDir, lines }) => {
      const r = await transcribe(hdr({ 'X-Language': 'de' }))
      assert.equal(r.status, 200, r.text)
      assert.deepEqual(r.json.segments, [{ start: 0, end: 4.2, text: 'Hello world.' }, { start: 4.2, end: 9.04, text: 'Zweiter Satz.' }])
      assert.equal(r.json.text, 'Hello world. Zweiter Satz.')
      assert.equal(r.json.language, 'de') // "german" in, ISO out
      assert.equal(r.json.approx, undefined)
      assert.equal(r.json.secondsCharged, 60)
      assert.deepEqual(r.json.allowance, { secondsUsed: 60, secondsLimit: 36000 })
      assert.equal(seen.calls.length, 1)
      const c = seen.calls[0]
      assert.equal(c.url, '/api/v1/audio/transcriptions')
      assert.equal(c.auth, `Bearer ${KEY}`)
      assert.match(c.contentType, /^application\/json/)
      assert.equal(c.body.model, 'openai/whisper-large-v3-turbo')
      assert.equal(c.body.input_audio.format, 'webm')
      assert.equal(Buffer.from(c.body.input_audio.data, 'base64').toString('latin1').startsWith('AUDIO-MARKER-'), true)
      assert.equal(Buffer.from(c.body.input_audio.data, 'base64').length, AUDIO.length)
      assert.equal(c.body.response_format, 'verbose_json')
      assert.deepEqual(c.body.timestamp_granularities, ['segment'])
      assert.equal(c.body.language, 'de')
      assert.deepEqual(c.body.provider, { data_collection: 'deny' })
      await tmpEmpty(hostedDir)
      for (const f of await fs.readdir(hostedDir, { recursive: true })) {
        const stat = await fs.stat(path.join(hostedDir, f))
        if (!stat.isFile()) continue
        const content = await fs.readFile(path.join(hostedDir, f))
        assert.equal(content.includes('AUDIO-MARKER-'), false)
        assert.equal(content.includes('Hello world'), false)
      }
      assert.equal(lines.some((l) => l.includes('Hello') || l.includes(KEY) || l.includes('AUDIO')), false)
      assert.ok(lines.some((l) => l === 'transcribe ok provider=openrouter seconds=60 cost_usd=0.0001 approx=false'), lines.join('\n'))
    })
  })
})

test('formats: mp4 goes out as m4a, ogg/opus as ogg; "auto" and 3-letter hints send no language; the data policy can be relaxed by env-style option', async () => {
  await withOpenRouter({}, async ({ seen }) => {
    await withServer(P, { ...base, transcribeDataCollection: 'allow' }, async () => {
      for (const [type, format] of [['audio/mp4', 'm4a'], ['audio/x-m4a', 'm4a'], ['audio/opus', 'ogg'], ['audio/ogg', 'ogg'], ['audio/mpeg', 'mp3'], ['audio/wav', 'wav'], ['audio/aac', 'aac'], ['audio/flac', 'flac']]) {
        assert.equal((await transcribe(hdr({ 'Content-Type': type, 'X-Language': 'auto' }), Buffer.alloc(3000, 1), { ip: `7.7.7.${seen.calls.length + 1}` })).status, 200, type)
        assert.equal(seen.calls.at(-1).body.input_audio.format, format, type)
        assert.equal('language' in seen.calls.at(-1).body, false)
      }
      assert.deepEqual(seen.calls[0].body.provider, { data_collection: 'allow' })
      assert.equal((await transcribe(hdr({ 'X-Language': 'gsw' }), Buffer.alloc(3000, 1), { ip: '7.7.7.99' })).status, 200)
      assert.equal('language' in seen.calls.at(-1).body, false) // a 3-letter code is not an ISO 639-1 hint
    })
  })
})

test('segment times that cannot be believed (none, past the audio, out of order) become sentence-level estimates flagged approx:true', async () => {
  const text = 'Erster Satz hier. Zweiter etwas laengerer Satz hier. Dritter.'
  for (const [name, json] of [
    ['none', { text, duration: 30, usage: { seconds: 30 } }],
    ['past the end', { text, duration: 30, segments: [{ start: 0, end: 500, text }], usage: { seconds: 30 } }],
    ['out of order', { text, duration: 30, segments: [{ start: 10, end: 12, text: 'Erster Satz hier.' }, { start: 2, end: 4, text: 'Zweiter etwas laengerer Satz hier. Dritter.' }], usage: { seconds: 30 } }],
  ]) {
    await withOpenRouter({ replies: [{ status: 200, json }] }, async () => {
      await withServer(P, base, async () => {
        const r = await transcribe(hdr({ 'X-Audio-Seconds': '30' }), Buffer.alloc(100000, 1))
        assert.equal(r.status, 200, name)
        assert.equal(r.json.approx, true, name)
        assert.equal(r.json.segments.length, 3, name)
        assert.equal(r.json.segments.map((s) => s.text).join(' '), text, name)
        assert.equal(r.json.segments[0].start, 0)
        assert.ok(Math.abs(r.json.segments.at(-1).end - 30) < 0.02, name) // spread over the duration
        for (let i = 1; i < 3; i += 1) assert.equal(r.json.segments[i].start, r.json.segments[i - 1].end)
      })
    })
  }
})

test('a provider that refuses verbose_json (400) gets ONE plain-json request for the same job, charged once; a second 400 is a failure and is refunded', async () => {
  await withOpenRouter({ replies: [{ status: 400 }, { status: 200, json: { text: 'Nur Text. Zweiter Satz.', usage: { seconds: 60, cost: 0.0002 } } }] }, async ({ seen }) => {
    await withServer(P, base, async () => {
      const r = await transcribe(hdr())
      assert.equal(r.status, 200, r.text)
      assert.equal(r.json.text, 'Nur Text. Zweiter Satz.')
      assert.equal(r.json.approx, true)
      assert.equal(seen.calls.length, 2)
      assert.equal(seen.calls[0].body.response_format, 'verbose_json')
      assert.equal('response_format' in seen.calls[1].body, false)
      assert.equal('timestamp_granularities' in seen.calls[1].body, false)
      assert.equal(r.json.secondsCharged, 60)
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 60) // once, not twice
    })
  })
  await withOpenRouter({ replies: [{ status: 400 }] }, async ({ seen }) => {
    await withServer(P, base, async () => {
      const r = await transcribe(hdr())
      assert.equal(r.status, 502)
      assert.equal(seen.calls.length, 2) // exactly one retry, never a third
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0)
    })
  })
})

test('the model answers with bad JSON, no text, or a non-object: 502 provider_error, nothing leaks, the allowance is refunded', async () => {
  for (const reply of [
    { status: 200, raw: 'this is not json RAW PROVIDER BODY MUST NOT LEAK' },
    { status: 200, raw: '' },
    { status: 200, json: { segments: [], language: 'en' } },
    { status: 200, json: { text: 42 } },
    { status: 200, json: ['text'] },
    { status: 200, json: null },
  ]) {
    await withOpenRouter({ replies: [reply] }, async () => {
      await withServer(P, base, async ({ lines }) => {
        const r = await transcribe(hdr())
        assert.equal(r.status, 502, JSON.stringify(reply))
        assert.equal(r.json.error, 'provider_error')
        assert.equal(r.text.includes('RAW PROVIDER'), false)
        assert.equal(r.text.includes(KEY), false)
        assert.equal(lines.some((l) => l.includes('RAW PROVIDER') || l.includes(KEY)), false)
        assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0)
      })
    })
  }
})

test('silence is a valid answer: empty text, no segments, 200', async () => {
  await withOpenRouter({ replies: [{ status: 200, json: { text: '', duration: 60, segments: [], usage: { seconds: 60, cost: 0.00005 } } }] }, async () => {
    await withServer(P, base, async () => {
      const r = await transcribe(hdr())
      assert.equal(r.status, 200)
      assert.deepEqual([r.json.text, r.json.segments, r.json.approx], ['', [], undefined])
    })
  })
})

test('provider refusals 401, 402, 403, 404, 500, 503: 502 provider_error, the provider body and the key never leak, the seconds go back', async () => {
  for (const status of [401, 402, 403, 404, 500, 503]) {
    await withOpenRouter({ replies: [{ status }] }, async ({ seen }) => {
      await withServer(P, base, async ({ lines }) => {
        const r = await transcribe(hdr())
        assert.equal(r.status, 502, String(status))
        assert.equal(r.json.error, 'provider_error')
        assert.equal(r.text.includes('RAW PROVIDER'), false)
        assert.equal(r.text.includes(KEY), false)
        assert.equal(lines.some((l) => l.includes('RAW PROVIDER') || l.includes(KEY)), false)
        assert.ok(lines.includes(`transcribe provider_error status=${status}`), lines.join('\n'))
        assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0)
        assert.equal(seen.calls.length, 1) // never retried (only a 400 on the verbose request gets a second form)
      })
    })
  }
})

test('provider 429: the phone gets our own 429 busy with Retry-After, nothing is charged, and the provider text stays inside', async () => {
  await withOpenRouter({ replies: [{ status: 429 }] }, async ({ seen }) => {
    await withServer(P, base, async () => {
      const r = await transcribe(hdr())
      assert.equal(r.status, 429)
      assert.equal(r.json.error, 'busy')
      assert.equal(Number(r.headers['retry-after']), 30)
      assert.equal(r.text.includes('RAW PROVIDER'), false)
      assert.equal(seen.calls.length, 1)
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0)
      const next = await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2 }), AUDIO, { ip: '8.8.8.8' })
      assert.equal(next.status, 429)
      assert.equal(next.json.error, 'busy') // the provider's 429 again, NOT busy_today: the daily budget was not eaten
    })
  })
})

test('a call that never answers: 504 provider_timeout at the deadline, the PERSON is refunded, today\'s budget closes', async () => {
  await withOpenRouter({ hang: true }, async ({ seen }) => {
    await withServer(P, { ...base, transcribeTimeoutMs: 300 }, async ({ lines }) => {
      const t0 = Date.now()
      const r = await transcribe(hdr())
      assert.equal(r.status, 504)
      assert.equal(r.json.error, 'provider_timeout')
      assert.ok(Date.now() - t0 < 2500)
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0) // wave 3: a failed job never counts against the person (it did before: 60)
      const next = await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2, 'X-Audio-Seconds': '5' }), Buffer.alloc(1000, 1))
      assert.equal(next.status, 429) // ... but OUR budget stays conservative: the day is closed
      assert.equal(next.json.error, 'busy_today')
      assert.equal(seen.calls.length, 1)
      assert.ok(lines.includes('transcribe provider_timeout accepted=true'))
    })
  })
})

test('gateway and timeout statuses (408, 502, 504, 524) may have been billed: refunded to the person but counted, the third in a day closes the day', async () => {
  for (const status of [408, 502, 504, 524]) {
    await withOpenRouter({ replies: [{ status }] }, async () => {
      await withServer(P, base, async ({ lines }) => {
        const r = await transcribe(hdr())
        assert.equal(r.status, 502, String(status))
        assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0)
        assert.ok(lines.includes(`transcribe provider_error status=${status}`))
      })
    })
  }
  await withOpenRouter({ replies: [{ status: 504 }] }, async ({ seen }) => {
    await withServer(P, { ...base, rateLimit: 1000 }, async () => {
      for (const ip of ['1.1.1.1', '1.1.1.2']) assert.equal((await transcribe(hdr(), AUDIO, { ip })).status, 502)
      assert.equal((await transcribe(hdr(), AUDIO, { ip: '1.1.1.3' })).status, 502) // the third one is still answered, then the day closes
      const next = await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2 }), AUDIO, { ip: '1.1.1.4' })
      assert.equal(next.status, 429)
      assert.equal(next.json.error, 'busy_today')
      assert.equal(seen.calls.length, 3)
    })
  })
  await withOpenRouter({ replies: [{ status: 500 }] }, async () => {
    await withServer(P, { ...base, rateLimit: 1000 }, async () => {
      for (let i = 1; i <= 5; i += 1) assert.equal((await transcribe(hdr(), AUDIO, { ip: `2.2.2.${i}` })).status, 502) // a plain 500 never closes the day
    })
  })
})

test('a provider that is down (connection refused) is a refunded 502, not a timeout', async () => {
  await withServer(P, base, async () => {
    const r = await transcribe(hdr())
    assert.equal(r.status, 502)
    assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0)
  })
})

test('oversized: over the byte cap is 413 before the provider is called (declared and streamed); exactly at the cap goes through', async () => {
  await withOpenRouter({}, async ({ seen }) => {
    await withServer(P, { ...base, transcribeMaxBytes: 1000 }, async () => {
      assert.equal((await transcribe(hdr(), Buffer.alloc(1001, 1))).status, 413)
      assert.equal((await transcribe(hdr(), [Buffer.alloc(600, 1), Buffer.alloc(600, 1)])).status, 413)
      assert.equal(seen.calls.length, 0)
      assert.equal((await transcribe(hdr(), Buffer.alloc(1000, 1))).status, 200)
      assert.equal(seen.calls.length, 1)
    })
  })
})

test('a lying X-Audio-Seconds is charged by size; the provider\'s billed seconds (usage.seconds) are booked when they are higher', async () => {
  await withOpenRouter({}, async () => {
    await withServer(P, base, async () => {
      const lie = await transcribe(hdr({ 'X-Audio-Seconds': '1' }), Buffer.alloc(600000, 1))
      assert.equal(lie.status, 200)
      assert.equal(lie.json.secondsCharged, 100) // 600000 B at the 48 kbps floor
    })
  })
  const billed = { text: 'long', duration: 40, usage: { seconds: 500.2, cost: 0.002 } } // a tiny DTX file that is really 500 s of audio
  await withOpenRouter({ replies: [{ status: 200, json: billed }] }, async () => {
    await withServer(P, base, async () => {
      const r = await transcribe(hdr({ 'X-Audio-Seconds': '1' }), Buffer.alloc(6000, 1))
      assert.equal(r.status, 200)
      assert.equal(r.json.secondsCharged, 501)
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 501)
    })
  })
})

test('the phone hangs up after the upload: the provider call is still followed to its end, the billed seconds are booked on the DAY, the person is refunded', async () => {
  const long = { text: 'long', duration: 500, segments: [{ start: 0, end: 500, text: 'long' }], usage: { seconds: 500, cost: 0.003 } }
  await withOpenRouter({ replies: [{ status: 200, json: long }], delayMs: 400 }, async ({ seen }) => {
    await withServer(P, { ...base, rateLimit: 1000 }, async () => {
      await new Promise((resolve) => {
        const req = http.request({ host: '127.0.0.1', port: P, method: 'POST', path: '/transcribe', headers: { Host: 'app.example.test', ...hdr({ 'X-Audio-Seconds': '1' }) } })
        req.on('error', () => resolve())
        req.end(Buffer.alloc(6000, 1))
        const poll = setInterval(() => {
          if (seen.calls.length === 1) {
            clearInterval(poll)
            req.destroy() // gone right after the request reached the provider
            resolve()
          }
        }, 10)
      })
      for (let i = 0; i < 100 && seen.answered < 1; i += 1) await new Promise((r) => setTimeout(r, 50))
      await new Promise((r) => setTimeout(r, 300)) // the job is booked on the day and the person's seconds go back
      assert.equal((await usage(P, A)).json.transcription.secondsUsed, 0) // wave 3: a lost job is not billed to the person (it was 500)
      const big = Buffer.alloc(21_000_000, 1) // ~3500 s at 48 kbps: 7200 - 500 left, so one fits, a second does not
      assert.equal((await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2, 'X-Audio-Seconds': '3500' }), big, { ip: '9.9.9.1' })).status, 200)
      // the budget answer comes before the audio is read, so a 21 MB body would race the early 429 (EPIPE, flaky since wave 1733): the charge is the declared 3500 s either way
      const third = await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2, 'X-Audio-Seconds': '3500' }), Buffer.alloc(1000, 1), { ip: '9.9.9.2' })
      assert.equal(third.status, 429)
      assert.equal(third.json.error, 'busy_today')
    })
  })
})

test('budgets: the global daily budget answers 429 busy_today, failures give the seconds back', async () => {
  await withOpenRouter({}, async ({ state }) => {
    await withServer(P, { ...base, transcribeDailySeconds: 100, transcribeIpDailySeconds: 100000 }, async () => {
      assert.equal((await transcribe(hdr())).status, 200)
      const busy = await transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2 }))
      assert.equal(busy.status, 429)
      assert.equal(busy.json.error, 'busy_today')
      assert.ok(Number(busy.headers['retry-after']) > 0)
      state.replies = [{ status: 500 }]
    })
    await withServer(P, { ...base, transcribeDailySeconds: 100, transcribeIpDailySeconds: 100000 }, async () => {
      assert.equal((await transcribe(hdr())).status, 502)
      assert.equal((await transcribe(hdr())).status, 502) // not eaten by failures
    })
  })
})

test('one paid job at a time: the provider never sees two calls at once', async () => {
  await withOpenRouter({ delayMs: 300 }, async ({ seen }) => {
    await withServer(P, base, async () => {
      const first = transcribe(hdr(), AUDIO, { ip: '3.3.3.1' })
      await new Promise((r) => setTimeout(r, 80))
      const second = transcribe(hdr({ 'X-Account': A2, 'X-Write-Token': T2 }), AUDIO, { ip: '3.3.3.2' })
      assert.deepEqual([(await first).status, (await second).status], [200, 200])
      assert.equal(seen.calls.length, 2)
      assert.equal(seen.maxActive, 1)
    })
  })
})

test('not configured: no key, not switched on, or an unknown provider is 503 not_configured before any audio is read; the status says so', async () => {
  await withOpenRouter({}, async ({ seen }) => {
    for (const [name, options, expectOn] of [
      ['no key', { ...base, transcribeKey: '' }, false],
      ['key but not switched on', { ...base, transcribeEnabled: false }, false],
      ['unknown provider', { ...base, transcribeProvider: 'whisper-at-home' }, false],
      ['switched on with a key', base, true],
    ]) {
      await withServer(P, options, async () => {
        assert.equal((await call(P, { url: '/hosted/status' })).json.transcribe, expectOn, name)
        const r = await transcribe(hdr())
        assert.equal(r.status, expectOn ? 200 : 503, name)
        if (!expectOn) assert.equal(r.json.error, 'not_configured', name)
      })
    }
    assert.equal(seen.calls.length, 1)
  })
})

test('Host and Origin guard cover /transcribe with this provider too, and the key never goes out on a refused request', async () => {
  await withOpenRouter({}, async ({ seen }) => {
    await withServer(P, base, async () => {
      assert.equal((await transcribe(hdr({ Origin: 'https://idea2.site' }))).status, 403)
      assert.equal((await transcribe(hdr(), AUDIO, { host: 'evil.example.com' })).status, 421)
      assert.equal((await transcribe(hdr({ 'X-Write-Token': 'nope' }))).status, 400)
      assert.equal((await transcribe(hdr({ 'Content-Type': 'text/plain' }))).status, 415)
      assert.equal(seen.calls.length, 0)
    })
  })
})

// ---- config and helpers (no server) ----

test('config: openrouter is the default provider, with the turbo model and the deny policy; the infomaniak defaults stay', () => {
  const c = loadConfig({ transcribeKey: KEY })
  assert.equal(c.transcribeProvider, 'openrouter')
  assert.equal(c.transcribeModel, 'openai/whisper-large-v3-turbo')
  assert.equal(c.transcribeDataCollection, 'deny')
  assert.equal(c.openrouterUrl, 'https://openrouter.ai/api/v1')
  assert.equal(c.transcribeTimeoutMs, 180000)
  assert.equal(c.transcribeConfigured, false) // a key alone does not switch it on
  assert.equal(loadConfig({ transcribeKey: KEY, transcribeEnabled: true }).transcribeConfigured, true)
  const i = loadConfig({ transcribeProvider: 'infomaniak', transcribeUrl: 'https://x.example/1/ai/1/openai/audio/transcriptions', transcribeKey: 'abc' })
  assert.equal(i.transcribeModel, 'whisper')
  assert.equal(i.transcribeTimeoutMs, 600000)
  assert.equal(i.transcribeConfigured, true)
  assert.equal(loadConfig({ transcribeProvider: 'infomaniak', transcribeKey: 'abc' }).transcribeConfigured, false)
})

test('credential: only {"key": "sk-..."} in $CREDENTIALS_DIRECTORY/orkey is accepted; every other shape is "no key" and never throws', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twcred-'))
  try {
    const write = (content, name = 'orkey') => fs.writeFile(path.join(dir, name), content)
    const read = (env = {}) => readCredentialKey({ CREDENTIALS_DIRECTORY: dir, ...env })
    await write(JSON.stringify({ key: KEY }))
    assert.equal(read(), KEY)
    await write(`${JSON.stringify({ key: KEY })}\n`)
    assert.equal(read(), KEY)
    for (const bad of [KEY, '{"key":', '{}', '{"key":42}', JSON.stringify({ key: 'short' }), JSON.stringify({ key: `${KEY}\nX-Evil: 1` }), JSON.stringify({ key: `${KEY} ` }), JSON.stringify({ key: `"${KEY}"` }), '[]', 'null', '']) {
      await write(bad)
      assert.equal(read(), '', bad)
    }
    assert.equal(readCredentialKey({}), '') // not run under systemd
    assert.equal(readCredentialKey({ CREDENTIALS_DIRECTORY: path.join(dir, 'missing') }), '')
    assert.equal(read({ TRANSCRIBE_CREDENTIAL: '../etc/passwd' }), '')
    await write(JSON.stringify({ key: KEY }), 'other')
    assert.equal(read({ TRANSCRIBE_CREDENTIAL: 'other' }), KEY)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('sentence-level estimates: proportional to characters, contiguous, ending at the duration; nothing for empty text or no duration', () => {
  const segs = approxSegments('Eins. Zwei zwei.', 10)
  assert.equal(segs.length, 2)
  assert.equal(segs[0].start, 0)
  assert.equal(segs[0].end, segs[1].start)
  assert.equal(segs[1].end, 10)
  assert.ok(segs[1].end - segs[1].start > segs[0].end - segs[0].start) // the longer sentence gets more time
  assert.deepEqual(approxSegments('', 10), [])
  assert.deepEqual(approxSegments('Text.', 0), [])
  assert.deepEqual(approxSegments('Text.', Number.NaN), [])
  assert.deepEqual(splitSentences('  Hallo Welt. Wie geht es dir?  '), ['Hallo Welt.', 'Wie geht es dir?'])
})

test('segment reliability: ordered, inside the audio, carrying the text', () => {
  const ok = [{ start: 0, end: 4, text: 'Hallo Welt.' }, { start: 4, end: 9, text: 'Zweiter Satz.' }]
  assert.equal(segmentsReliable(ok, 'Hallo Welt. Zweiter Satz.', 9), true)
  assert.equal(segmentsReliable([], 'x', 9), false)
  assert.equal(segmentsReliable(ok, 'Hallo Welt. Zweiter Satz.', 0), false)
  assert.equal(segmentsReliable([{ start: 5, end: 4, text: 'x' }], 'x', 9), false) // end before start
  assert.equal(segmentsReliable([ok[1], ok[0]], 'Hallo Welt. Zweiter Satz.', 9), false) // out of order
  assert.equal(segmentsReliable([{ start: 0, end: 100, text: 'Hallo Welt. Zweiter Satz.' }], 'Hallo Welt. Zweiter Satz.', 9), false) // past the end
  assert.equal(segmentsReliable([{ start: 0, end: 4, text: 'Hallo' }], 'Hallo Welt. Zweiter Satz. Und noch viel mehr Text.', 9), false) // most of the text uncovered
  const w = withSegments({ text: 'Satz eins. Satz zwei.', segments: [], duration: null, language: null, approx: false, cost: null }, 20)
  assert.equal(w.approx, true)
  assert.equal(w.segments.at(-1).end, 20) // no reported duration: the declared one
})

test('language names from Whisper map to ISO 639-1; anything else is unknown', () => {
  assert.deepEqual(['german', 'German', 'de', 'EN', 'klingon', '', null, 42].map(isoLanguage), ['de', 'de', 'de', 'en', null, null, null, null])
})
