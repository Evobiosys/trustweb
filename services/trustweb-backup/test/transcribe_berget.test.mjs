// Wave 3: Berget as the default provider, OpenRouter as the fallback, and "a failed job is never billed to the person".
// Fake Berget + fake OpenRouter on ephemeral ports (listen(0)), the server under test on port 0: no fixed port, nothing to collide with.
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { A, A2, T, T2, call, usage, withServer } from './helpers.mjs'
import { loadConfig, readCredentialKey, transcribeChain } from '../config.mjs'
import { isOutage } from '../transcribe_chain.mjs'
import { ProviderError, ProviderFailure } from '../transcribe_provider.mjs'

const BKEY = 'sk_ber_0123456789abcdef0123456789abcdef' // fake; Berget keys have underscores
const OKEY = 'sk-or-v1-0123456789abcdef0123456789abcdef' // fake
const AUDIO = Buffer.concat([Buffer.from('AUDIO-MARKER-'), Buffer.alloc(240000, 5)]) // 60 s at 32 kbps
const SEGMENTS = [{ id: 0, start: 0, end: 4.2, text: ' Hallo Welt.' }, { id: 1, start: 4.2, end: 9.04, text: 'Zweiter Satz.' }]
const B_OK = { text: ' Hallo Welt. Zweiter Satz.', language: 'de', duration: 9.04, segments: SEGMENTS }
const O_OK = { text: 'Fallback Text.', language: 'german', duration: 9, segments: [{ start: 0, end: 9, text: 'Fallback Text.' }], usage: { seconds: 9, cost: 0.0001 } }

/**
 * A fake provider. `kind` = 'berget' (multipart in) or 'openrouter' (JSON in). Records every call, answers from `script.replies`
 * (one per call, the last repeats). Resolves nothing: runs `body({ url, seen, state })` with the fake listening on a free port.
 */
async function withFake(kind, script, body) {
  const seen = { calls: [], answered: 0 }
  const state = { replies: [{ status: 200, json: kind === 'berget' ? B_OK : O_OK }], delayMs: 0, ...script }
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks)
    const contentType = req.headers['content-type'] ?? ''
    let form = null
    let json = null
    try {
      if (kind === 'berget') form = await new Response(raw, { headers: { 'content-type': contentType } }).formData()
      else json = JSON.parse(raw.toString('utf8'))
    } catch {
      // recorded as null
    }
    const index = seen.calls.length
    seen.calls.push({ url: req.url, auth: req.headers.authorization, contentType, form, json, size: raw.length })
    if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs))
    if (state.hang) return
    const reply = state.replies[Math.min(index, state.replies.length - 1)]
    res.writeHead(reply.status, { 'Content-Type': 'application/json' })
    res.end(reply.raw ?? JSON.stringify(reply.json ?? { error: { message: 'RAW PROVIDER BODY MUST NOT LEAK' } }))
    seen.answered += 1
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await body({ url: `http://127.0.0.1:${server.address().port}/v1`, seen, state })
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

/** Both fakes plus a server wired to them. `options` override the config; `body({ port, berget, openrouter, lines })`. */
async function withStack({ berget = {}, openrouter = {}, options = {} }, body) {
  await withFake('berget', berget, async (b) => {
    await withFake('openrouter', openrouter, async (o) => {
      const cfg = { bergetKey: BKEY, transcribeKey: OKEY, transcribeEnabled: true, bergetUrl: b.url, openrouterUrl: o.url, transcribeTimeoutMs: 3000, transcribeBergetTimeoutMs: 3000, rateLimit: 1000, ...options }
      await withServer(0, cfg, async ({ srv, lines }) => body({ port: srv.port, berget: b, openrouter: o, lines }))
    })
  })
}

const hdr = (extra = {}) => ({ 'X-Account': A, 'X-Write-Token': T, 'X-Audio-Seconds': '60', 'Content-Type': 'audio/webm;codecs=opus', ...extra })
const transcribe = (port, headers, body = AUDIO, extra = {}) => call(port, { method: 'POST', url: '/transcribe', headers, body, ...extra })
const used = async (port, account = A, token = T) => (await usage(port, account, token)).json.transcription.secondsUsed
const status = async (port) => (await call(port, { url: '/hosted/status' })).json

test('berget is the default: multipart with file, model, verbose_json and segment times; its key goes only to Berget; OpenRouter is not called; logs stay clean', async () => {
  await withStack({}, async ({ port, berget, openrouter, lines }) => {
    const r = await transcribe(port, hdr({ 'X-Language': 'de' }))
    assert.equal(r.status, 200, r.text)
    assert.deepEqual(r.json.segments, [{ start: 0, end: 4.2, text: 'Hallo Welt.' }, { start: 4.2, end: 9.04, text: 'Zweiter Satz.' }])
    assert.equal(r.json.text, 'Hallo Welt. Zweiter Satz.')
    assert.equal(r.json.language, 'de')
    assert.equal(r.json.approx, undefined)
    assert.equal(r.json.secondsCharged, 60)
    assert.deepEqual(r.json.allowance, { secondsUsed: 60, secondsLimit: 36000 })
    assert.equal(openrouter.seen.calls.length, 0)
    assert.equal(berget.seen.calls.length, 1)
    const c = berget.seen.calls[0]
    assert.equal(c.url, '/v1/audio/transcriptions')
    assert.equal(c.auth, `Bearer ${BKEY}`)
    assert.match(c.contentType, /^multipart\/form-data; boundary=/)
    assert.equal(c.form.get('model'), 'Systran/faster-whisper-large-v3') // multilingual, not the Swedish kb-whisper or the bare alias "whisper"
    assert.equal(c.form.get('response_format'), 'verbose_json')
    assert.equal(c.form.get('timestamp_granularities'), 'segment')
    assert.equal(c.form.get('language'), 'de')
    const file = c.form.get('file')
    assert.equal(file.name, 'audio.webm')
    assert.equal(file.size, AUDIO.length)
    assert.equal(Buffer.from(await file.arrayBuffer()).toString('latin1').startsWith('AUDIO-MARKER-'), true)
    assert.equal(lines.some((l) => l.includes('Hallo') || l.includes(BKEY) || l.includes(OKEY) || l.includes('AUDIO')), false)
    assert.ok(lines.includes('transcribe ok provider=berget seconds=60 cost_eur_est=0.000298 approx=false'), lines.join('\n'))
  })
})

test('file types: webm, m4a (mp4), mp3, wav go to Berget; ogg, opus, aac, flac go straight to OpenRouter and Berget is never called', async () => {
  await withStack({}, async ({ port, berget, openrouter }) => {
    let n = 0
    for (const [type, name] of [['audio/webm', 'audio.webm'], ['audio/mp4', 'audio.m4a'], ['audio/x-m4a', 'audio.m4a'], ['audio/mpeg', 'audio.mp3'], ['audio/wav', 'audio.wav']]) {
      n += 1
      assert.equal((await transcribe(port, hdr({ 'Content-Type': type }), Buffer.alloc(3000, 1), { ip: `7.7.7.${n}` })).status, 200, type)
      assert.equal(berget.seen.calls.at(-1).form.get('file').name, name, type)
    }
    assert.equal(openrouter.seen.calls.length, 0)
    for (const [type, format] of [['audio/ogg', 'ogg'], ['audio/opus', 'ogg'], ['audio/aac', 'aac'], ['audio/flac', 'flac']]) {
      n += 1
      const r = await transcribe(port, hdr({ 'Content-Type': type }), Buffer.alloc(3000, 1), { ip: `7.7.7.${n}` })
      assert.equal(r.status, 200, type)
      assert.equal(openrouter.seen.calls.at(-1).json.input_audio.format, format, type)
    }
    assert.equal(berget.seen.calls.length, 5) // none of the four unsupported types reached Berget
  })
})

test('a file type Berget cannot take, with no fallback: 415 before any budget or audio, nothing charged, no call', async () => {
  await withStack({ options: { transcribeFallback: 'none' } }, async ({ port, berget, openrouter }) => {
    const r = await transcribe(port, hdr({ 'Content-Type': 'audio/ogg;codecs=opus' }))
    assert.equal(r.status, 415)
    assert.equal(r.json.error, 'unsupported_media')
    assert.equal(await used(port), 0)
    assert.equal(berget.seen.calls.length + openrouter.seen.calls.length, 0)
    assert.equal((await transcribe(port, hdr(), AUDIO, { ip: '5.5.5.5' })).status, 200) // webm still works
  })
})

test('Berget answers 500 or 503: OpenRouter takes over, the job is charged ONCE and the log names both', async () => {
  for (const status of [500, 503]) {
    await withStack({ berget: { replies: [{ status }] } }, async ({ port, berget, openrouter, lines }) => {
      const r = await transcribe(port, hdr())
      assert.equal(r.status, 200, String(status))
      assert.equal(r.json.text, 'Fallback Text.')
      assert.equal(r.json.language, 'de') // "german" in, ISO out
      assert.equal(r.json.secondsCharged, 60)
      assert.equal(await used(port), 60) // once, not twice
      assert.equal(berget.seen.calls.length, 1)
      assert.equal(openrouter.seen.calls.length, 1)
      assert.equal(openrouter.seen.calls[0].auth, `Bearer ${OKEY}`)
      assert.ok(lines.includes(`transcribe fallback from=berget kind=error status=${status}`), lines.join('\n'))
      assert.ok(lines.includes('transcribe ok provider=openrouter seconds=60 cost_usd=0.0001 approx=false fellback_from=berget'), lines.join('\n'))
    })
  }
})

test('Berget never answers (its own deadline): OpenRouter takes over inside its own deadline; the person is charged once; the hung call is counted as maybe billed', async () => {
  await withStack({ berget: { hang: true }, options: { transcribeBergetTimeoutMs: 300 } }, async ({ port, berget, openrouter, lines }) => {
    const t0 = Date.now()
    const r = await transcribe(port, hdr())
    assert.equal(r.status, 200, r.text)
    assert.ok(Date.now() - t0 < 2500)
    assert.equal(await used(port), 60)
    assert.equal(berget.seen.calls.length, 1)
    assert.equal(openrouter.seen.calls.length, 1)
    assert.ok(lines.includes('transcribe fallback from=berget kind=timeout status=n/a'), lines.join('\n'))
  })
})

test('Berget answers garbage (no JSON, no text) or is down (connection refused): that is an outage, OpenRouter takes over', async () => {
  for (const replies of [[{ status: 200, raw: 'not json' }], [{ status: 200, json: { nope: 1 } }]]) {
    await withStack({ berget: { replies } }, async ({ port, openrouter }) => {
      assert.equal((await transcribe(port, hdr())).status, 200)
      assert.equal(openrouter.seen.calls.length, 1)
    })
  }
  await withStack({ options: { bergetUrl: 'http://127.0.0.1:1/v1' } }, async ({ port, openrouter }) => {
    assert.equal((await transcribe(port, hdr())).status, 200)
    assert.equal(openrouter.seen.calls.length, 1)
  })
})

test('Berget not configured (no key): OpenRouter serves directly and the status says so; Berget is never called', async () => {
  await withStack({ options: { bergetKey: '' } }, async ({ port, berget, openrouter }) => {
    assert.deepEqual((await status(port)).provider.transcribe, { enabled: true, provider: 'openrouter', region: 'us', dataPolicy: 'deny', fallback: null })
    assert.equal((await transcribe(port, hdr())).status, 200)
    assert.equal(berget.seen.calls.length, 0)
    assert.equal(openrouter.seen.calls.length, 1)
  })
})

test('no fallback (setting none) and Berget has no key: 503 not_configured before any audio is read', async () => {
  await withStack({ options: { bergetKey: '', transcribeProvider: 'berget', transcribeFallback: 'none' } }, async ({ port, openrouter }) => {
    assert.equal((await status(port)).transcribe, false)
    const r = await transcribe(port, hdr())
    assert.equal(r.status, 503)
    assert.equal(r.json.error, 'not_configured')
    assert.equal(openrouter.seen.calls.length, 0)
  })
})

test('Berget 4xx (400 twice, 401, 402, 403, 404) and 429 are NOT an outage: no fallback, 502 / our 429, the person gets nothing billed, OpenRouter is not called', async () => {
  for (const status of [401, 402, 403, 404, 422]) {
    await withStack({ berget: { replies: [{ status }] } }, async ({ port, berget, openrouter }) => {
      const r = await transcribe(port, hdr())
      assert.equal(r.status, 502, String(status))
      assert.equal(r.json.error, 'provider_error')
      assert.equal(r.text.includes('RAW PROVIDER BODY'), false)
      assert.equal(await used(port), 0)
      assert.equal(berget.seen.calls.length, 1)
      assert.equal(openrouter.seen.calls.length, 0, `no fallback on ${status}`)
    })
  }
  await withStack({ berget: { replies: [{ status: 429 }] } }, async ({ port, openrouter }) => {
    const r = await transcribe(port, hdr())
    assert.equal(r.status, 429)
    assert.equal(r.json.error, 'busy')
    assert.equal(r.headers['retry-after'], '30')
    assert.equal(await used(port), 0)
    assert.equal(openrouter.seen.calls.length, 0)
  })
  await withStack({ berget: { replies: [{ status: 400 }] } }, async ({ port, berget, openrouter }) => {
    assert.equal((await transcribe(port, hdr())).status, 502) // 400 on verbose_json, then 400 on the one plain retry
    assert.equal(berget.seen.calls.length, 2)
    assert.equal(openrouter.seen.calls.length, 0)
    assert.equal(await used(port), 0)
  })
})

test('Berget refuses verbose_json (400): ONE plain-json retry for the same job, charged once, segment times estimated (approx)', async () => {
  await withStack({ berget: { replies: [{ status: 400 }, { status: 200, json: { text: 'Nur Text. Zweiter Satz.' } }] } }, async ({ port, berget, openrouter }) => {
    const r = await transcribe(port, hdr())
    assert.equal(r.status, 200, r.text)
    assert.equal(r.json.approx, true)
    assert.equal(berget.seen.calls.length, 2)
    assert.equal(berget.seen.calls[0].form.get('response_format'), 'verbose_json')
    assert.equal(berget.seen.calls[1].form.get('response_format'), 'json')
    assert.equal(berget.seen.calls[1].form.has('timestamp_granularities'), false)
    assert.equal(openrouter.seen.calls.length, 0)
    assert.equal(await used(port), 60)
  })
})

test('both down: 502, the person is not charged (refunded exactly once), nothing leaks; both providers were tried once', async () => {
  await withStack({ berget: { replies: [{ status: 500 }] }, openrouter: { replies: [{ status: 500 }] } }, async ({ port, berget, openrouter, lines }) => {
    const r = await transcribe(port, hdr())
    assert.equal(r.status, 502)
    assert.equal(r.json.error, 'provider_error')
    assert.equal(r.text.includes('RAW PROVIDER BODY'), false)
    assert.equal(await used(port), 0)
    assert.equal((await usage(port, A)).json.recordings ?? 0, 0)
    assert.equal(berget.seen.calls.length, 1)
    assert.equal(openrouter.seen.calls.length, 1)
    assert.ok(lines.includes('transcribe provider_error status=500'))
    // the seconds are back on OUR budgets too (plain 500s: nothing was billed): a full day's worth still fits afterwards
    for (let i = 1; i <= 3; i += 1) assert.equal((await transcribe(port, hdr(), AUDIO, { ip: `3.3.3.${i}` })).status, 502)
    assert.equal(await used(port), 0)
  })
})

test('both time out: 504 for the phone, the PERSON is refunded, today\'s global budget closes (both calls may still be billed)', async () => {
  await withStack({ berget: { hang: true }, openrouter: { hang: true }, options: { transcribeBergetTimeoutMs: 250, transcribeTimeoutMs: 250 } }, async ({ port, berget, openrouter }) => {
    const r = await transcribe(port, hdr())
    assert.equal(r.status, 504)
    assert.equal(r.json.error, 'provider_timeout')
    assert.equal(await used(port), 0)
    assert.equal(berget.seen.calls.length, 1)
    assert.equal(openrouter.seen.calls.length, 1)
    const next = await transcribe(port, hdr({ 'X-Account': A2, 'X-Write-Token': T2, 'X-Audio-Seconds': '5' }), Buffer.alloc(1000, 1), { ip: '8.8.8.8' })
    assert.equal(next.status, 429)
    assert.equal(next.json.error, 'busy_today')
  })
})

test('Berget 502 then OpenRouter success: the maybe-billed Berget failure counts toward the day; the third such failure closes the day', async () => {
  await withStack({ berget: { replies: [{ status: 502 }] } }, async ({ port }) => {
    for (const ip of ['1.1.1.1', '1.1.1.2']) assert.equal((await transcribe(port, hdr(), AUDIO, { ip })).status, 200)
    assert.equal((await transcribe(port, hdr(), AUDIO, { ip: '1.1.1.3' })).status, 200) // answered, then the day closes
    const next = await transcribe(port, hdr({ 'X-Account': A2, 'X-Write-Token': T2 }), AUDIO, { ip: '1.1.1.4' })
    assert.equal(next.status, 429)
    assert.equal(next.json.error, 'busy_today')
  })
  await withStack({ berget: { replies: [{ status: 500 }] } }, async ({ port }) => {
    for (let i = 1; i <= 5; i += 1) assert.equal((await transcribe(port, hdr(), AUDIO, { ip: `2.2.2.${i}` })).status, 200) // a plain 500 never closes the day
  })
})

test('a lost job: the phone hangs up after the upload, the job runs to its end and its real duration stays on the DAY, but the person is refunded', async () => {
  const long = { text: 'lang', duration: 500, segments: [{ start: 0, end: 500, text: 'lang' }] }
  await withStack({ berget: { replies: [{ status: 200, json: long }], delayMs: 400 } }, async ({ port, berget, lines }) => {
    await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/transcribe', headers: { Host: 'app.example.test', ...hdr({ 'X-Audio-Seconds': '1' }) } })
      req.on('error', () => resolve())
      req.end(Buffer.alloc(6000, 1))
      const poll = setInterval(() => {
        if (berget.seen.calls.length === 1) {
          clearInterval(poll)
          req.destroy() // gone right after the request reached Berget
          resolve()
        }
      }, 10)
    })
    for (let i = 0; i < 100 && berget.seen.answered < 1; i += 1) await new Promise((r) => setTimeout(r, 50))
    await new Promise((r) => setTimeout(r, 300))
    assert.equal(await used(port), 0) // never billed to the person
    assert.ok(lines.includes('transcribe lost_job refunded_to_person'), lines.join('\n'))
    const big = Buffer.alloc(21_000_000, 1) // ~3500 s: 7200 - 500 left, so one fits, a second does not
    assert.equal((await transcribe(port, hdr({ 'X-Account': A2, 'X-Write-Token': T2, 'X-Audio-Seconds': '3500' }), big, { ip: '9.9.9.1' })).status, 200)
    const third = await transcribe(port, hdr({ 'X-Account': A2, 'X-Write-Token': T2, 'X-Audio-Seconds': '3500' }), Buffer.alloc(1000, 1), { ip: '9.9.9.2' })
    assert.equal(third.status, 429)
    assert.equal(third.json.error, 'busy_today')
  })
})

test('a success is charged at the provider-reported duration when that is longer (Berget), and only then', async () => {
  await withStack({ berget: { replies: [{ status: 200, json: { ...B_OK, duration: 90, segments: [] } }] } }, async ({ port }) => {
    const r = await transcribe(port, hdr())
    assert.equal(r.status, 200)
    assert.equal(r.json.secondsCharged, 90)
    assert.equal(await used(port), 90)
  })
})

test('status: the ACTIVE provider and region, and whether a fallback exists (named with its own region)', async () => {
  const fallback = { provider: 'openrouter', region: 'us', dataPolicy: 'deny' }
  await withStack({}, async ({ port }) => {
    assert.deepEqual((await status(port)).provider.transcribe, { enabled: true, provider: 'berget', region: 'se', dataPolicy: null, fallback })
    assert.equal((await status(port)).transcribe, true)
  })
  await withStack({ options: { transcribeFallback: 'none' } }, async ({ port }) => {
    assert.deepEqual((await status(port)).provider.transcribe, { enabled: true, provider: 'berget', region: 'se', dataPolicy: null, fallback: null })
  })
  await withStack({ options: { transcribeEnabled: false } }, async ({ port }) => {
    const s = await status(port)
    assert.equal(s.transcribe, false)
    assert.equal(s.provider.transcribe.provider, 'berget') // key present but not switched on: still says what WOULD serve
    assert.equal((await transcribe(port, hdr())).status, 503)
  })
  await withStack({ options: { transcribeProvider: 'openrouter' } }, async ({ port, berget }) => {
    assert.deepEqual((await status(port)).provider.transcribe, { enabled: true, provider: 'openrouter', region: 'us', dataPolicy: 'deny', fallback: null })
    assert.equal((await transcribe(port, hdr())).status, 200)
    assert.equal(berget.seen.calls.length, 0) // "openrouter fallback only": Berget is out of the picture
  })
})

test('Host and Origin guard still cover /transcribe; neither key goes out on a refused request', async () => {
  await withStack({}, async ({ port, berget, openrouter }) => {
    assert.equal((await transcribe(port, hdr({ Origin: 'https://idea2.site' }))).status, 403)
    assert.equal((await transcribe(port, hdr(), AUDIO, { host: 'evil.example.com' })).status, 421)
    assert.equal((await transcribe(port, hdr({ 'X-Write-Token': 'nope' }))).status, 400)
    assert.equal((await transcribe(port, hdr({ 'Content-Type': 'text/plain' }))).status, 415)
    assert.equal(berget.seen.calls.length + openrouter.seen.calls.length, 0)
  })
})

// ---- config and helpers (no server) ----

test('chain resolution: auto = Berget if its key exists else OpenRouter; berget + fallback; openrouter alone; none leaves nothing', () => {
  const chain = (o) => transcribeChain({ setting: 'auto', fallback: 'openrouter', bergetKey: BKEY, openrouterKey: OKEY, ...o })
  assert.deepEqual(chain({}), ['berget', 'openrouter'])
  assert.deepEqual(chain({ fallback: 'none' }), ['berget'])
  assert.deepEqual(chain({ bergetKey: '' }), ['openrouter'])
  assert.deepEqual(chain({ bergetKey: '', fallback: 'none' }), ['openrouter']) // auto without a Berget key is the pre-Berget behaviour
  assert.deepEqual(chain({ setting: 'berget' }), ['berget', 'openrouter'])
  assert.deepEqual(chain({ setting: 'berget', fallback: 'none', bergetKey: '' }), [])
  assert.deepEqual(chain({ setting: 'berget', openrouterKey: '' }), ['berget'])
  assert.deepEqual(chain({ setting: 'openrouter' }), ['openrouter'])
  assert.deepEqual(chain({ setting: 'openrouter', openrouterKey: '' }), [])
  assert.deepEqual(chain({ bergetKey: '', openrouterKey: '' }), [])
})

test('config: Berget defaults (model, URL, price, deadline), the status provider, the fallback name; an unknown provider is never configured', () => {
  const c = loadConfig({ bergetKey: BKEY, transcribeKey: OKEY, transcribeEnabled: true })
  assert.equal(c.transcribeProvider, 'berget')
  assert.deepEqual(c.transcribeChain, ['berget', 'openrouter'])
  assert.equal(c.transcribeFallback, 'openrouter')
  assert.equal(c.bergetUrl, 'https://api.berget.ai/v1')
  assert.equal(c.transcribeBergetModel, 'Systran/faster-whisper-large-v3')
  assert.equal(c.transcribeBergetEurPerSecond, 0.000033)
  assert.equal(c.transcribeBergetTimeoutMs, 300000)
  assert.equal(c.transcribeConfigured, true)
  assert.equal(loadConfig({ bergetKey: BKEY, transcribeKey: OKEY }).transcribeConfigured, false) // not switched on
  assert.equal(loadConfig({ bergetKey: BKEY, transcribeEnabled: true, transcribeFallback: 'none' }).transcribeFallback, null)
  assert.equal(loadConfig({ bergetKey: BKEY, transcribeKey: OKEY, transcribeEnabled: true, transcribeProvider: 'whisper-at-home' }).transcribeConfigured, false)
})

test('credential: Berget key from $CREDENTIALS_DIRECTORY/berget, same strict shape (underscores allowed); every other shape is "no key"', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twcred-'))
  try {
    const read = (env = {}) => readCredentialKey({ CREDENTIALS_DIRECTORY: dir, ...env }, 'berget')
    await fs.writeFile(path.join(dir, 'berget'), JSON.stringify({ key: BKEY }))
    assert.equal(read(), BKEY)
    for (const bad of [BKEY, '{}', JSON.stringify({ key: 'sk_short' }), JSON.stringify({ key: `${BKEY}\nX-Evil: 1` }), JSON.stringify({ key: `${BKEY} ` }), '']) {
      await fs.writeFile(path.join(dir, 'berget'), bad)
      assert.equal(read(), '', bad)
    }
    assert.equal(readCredentialKey({}, 'berget'), '')
    assert.equal(readCredentialKey({ CREDENTIALS_DIRECTORY: dir }, '../etc/passwd'), '')
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

test('outage rule: timeouts, no-answer errors and 5xx are outages; 4xx and busy are not', () => {
  const fail = (kind, status = null) => new ProviderError(kind, status)
  assert.equal(isOutage(fail(ProviderFailure.Timeout)), true)
  assert.equal(isOutage(fail(ProviderFailure.Error)), true)
  for (const s of [500, 502, 503, 504, 524]) assert.equal(isOutage(fail(ProviderFailure.Error, s)), true, String(s))
  for (const s of [400, 401, 402, 403, 404, 422]) assert.equal(isOutage(fail(ProviderFailure.Error, s)), false, String(s))
  assert.equal(isOutage(fail(ProviderFailure.Busy, 429)), false)
})
