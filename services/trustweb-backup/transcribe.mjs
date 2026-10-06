// POST /transcribe: audio in, {text, segments} out, nothing stored (see services-api-contract.txt, section 4).
//
// Provider: Infomaniak AI Tools, OpenAI-compatible Whisper, an ASYNCHRONOUS batch API:
//   POST {TRANSCRIBE_URL}                                    multipart (file, model, response_format, timestamp_granularities[], language)
//        -> {"batch_id": "..."}
//   GET  .../1/ai/<product_id>/results/<batch_id>            -> {status: pending|processing|success|failed|cancelled, url, data}
//   (data: the transcript as object, JSON string, or null with a download url)
// Docs: https://developer.infomaniak.com/docs/api/post/1/ai/{product_id}/openai/audio/transcriptions
//       https://developer.infomaniak.com/docs/api/get/1/ai/{product_id}/results/{batch_id}
// The server submits, polls every TRANSCRIBE_POLL_MS up to TRANSCRIBE_TIMEOUT_MS, and answers when done.
//
// Env: TRANSCRIBE_URL (the full POST URL incl. product id), TRANSCRIBE_KEY (bearer token), TRANSCRIBE_MODEL (default "whisper"),
//      TRANSCRIBE_RESULTS_URL (optional template with {batch_id}; derived from TRANSCRIBE_URL otherwise).
// Without a key or URL: 503 not_configured. Logs carry no audio, text, key or provider body.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import {
  CapExceeded,
  HEX64,
  IdleTimeout,
  declaredLength,
  jsonError,
  refuse,
  sendJson,
  streamToFile,
  tooManyRequests,
} from './http_util.mjs'
import { createDailyMeter } from './limits.mjs'
import { transcribeCharge } from './quota.mjs'

const MAX_AUDIO_SECONDS = 3600

/** Accepted Content-Type (without parameters) -> a file extension the provider accepts. */
const AUDIO_TYPES = Object.freeze({
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
})

class ProviderError extends Error {
  constructor(kind, status = null) {
    super(`provider ${kind}`)
    this.kind = kind // 'error' | 'timeout'
    this.status = status
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/** Provider result data in any of its shapes -> {text, segments, duration, language}. Throws ProviderError('error') when unusable. */
export function normalizeTranscript(data) {
  let v = data
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      if (parsed !== null && typeof parsed === 'object') v = parsed
    } catch {
      // plain text transcript
    }
  }
  if (typeof v === 'string') return { text: v.trim(), segments: [], duration: null, language: null }
  if (v === null || typeof v !== 'object') throw new ProviderError('error')
  const rawSegments = Array.isArray(v) ? v : Array.isArray(v.segments) ? v.segments : []
  const segments = rawSegments
    .filter((s) => s !== null && typeof s === 'object' && Number.isFinite(s.start) && Number.isFinite(s.end) && typeof s.text === 'string')
    .map((s) => ({ start: Math.round(s.start * 100) / 100, end: Math.round(s.end * 100) / 100, text: s.text.trim() }))
  const text = !Array.isArray(v) && typeof v.text === 'string' ? v.text.trim() : segments.map((s) => s.text).join(' ').trim()
  const lastEnd = segments.reduce((max, s) => Math.max(max, s.end), 0)
  const duration = !Array.isArray(v) && Number.isFinite(v.duration) ? Math.max(v.duration, lastEnd) : lastEnd || null
  const language = !Array.isArray(v) && typeof v.language === 'string' ? v.language : null
  return { text, segments, duration, language }
}

export function createTranscriber({ cfg, hosted, store, clientOf, fetchImpl = fetch }) {
  const daily = createDailyMeter({ limit: cfg.transcribeDailySeconds, now: cfg.now })
  const perIp = createDailyMeter({ limit: cfg.transcribeIpDailySeconds, now: cfg.now })
  let inFlight = 0

  function resultsUrl(batchId) {
    if (cfg.transcribeResultsUrl) return cfg.transcribeResultsUrl.replace('{batch_id}', encodeURIComponent(batchId))
    const m = /^(.*\/ai\/[^/]+)\/openai\/audio\/transcriptions\/?$/.exec(cfg.transcribeUrl)
    if (m === null) throw new ProviderError('error')
    return `${m[1]}/results/${encodeURIComponent(batchId)}`
  }

  async function providerFetch(url, init, signal) {
    try {
      const response = await fetchImpl(url, { ...init, signal, headers: { ...init.headers, Authorization: `Bearer ${cfg.transcribeKey}` } })
      if (!response.ok) throw new ProviderError('error', response.status)
      return response
    } catch (err) {
      if (err instanceof ProviderError) throw err
      if (err?.name === 'TimeoutError') throw new ProviderError('timeout')
      if (signal.aborted) throw signal.reason ?? err
      throw new ProviderError('error')
    }
  }

  async function submit(spool, { mime, ext, language }, signal) {
    const form = new FormData()
    form.append('file', await fs.openAsBlob(spool, { type: mime }), `audio.${ext}`)
    form.append('model', cfg.transcribeModel)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
    if (language !== null) form.append('language', language)
    const response = await providerFetch(cfg.transcribeUrl, { method: 'POST', body: form }, signal)
    const body = await response.json().catch(() => null)
    const batchId = body?.batch_id ?? body?.data?.batch_id
    if (typeof batchId !== 'string' || batchId === '') throw new ProviderError('error')
    return batchId
  }

  async function download(url, signal) {
    if (new URL(url).origin !== new URL(cfg.transcribeUrl).origin) throw new ProviderError('error') // never send the key elsewhere
    const response = await providerFetch(url, { method: 'GET' }, signal)
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  async function awaitResult(batchId, deadline, signal) {
    for (;;) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new ProviderError('timeout')
      const response = await providerFetch(resultsUrl(batchId), { method: 'GET' }, AbortSignal.any([signal, AbortSignal.timeout(remaining)]))
      const raw = await response.json().catch(() => null)
      const body = raw?.status === undefined && raw?.data?.status !== undefined ? raw.data : raw
      switch (body?.status) {
        case 'success':
          if (body.data !== null && body.data !== undefined) return body.data
          if (typeof body.url === 'string') return download(body.url, signal)
          throw new ProviderError('error')
        case 'pending':
        case 'processing':
          await sleep(Math.min(cfg.transcribePollMs, Math.max(0, deadline - Date.now())), signal)
          break
        default:
          throw new ProviderError('error') // failed, cancelled or unknown
      }
    }
  }

  /** Validates headers. Returns the parsed request or an {error} answer to send. */
  function parseRequest(req) {
    const account = req.headers['x-account']
    if (typeof account !== 'string' || !HEX64.test(account)) return { error: ['bad_request', { field: 'X-Account' }] }
    const token = req.headers['x-write-token']
    if (typeof token !== 'string' || !HEX64.test(token)) return { error: ['bad_request', { field: 'X-Write-Token' }] }
    const rawSeconds = req.headers['x-audio-seconds']
    if (typeof rawSeconds !== 'string' || !/^\d{1,5}$/.test(rawSeconds) || Number(rawSeconds) < 1 || Number(rawSeconds) > MAX_AUDIO_SECONDS) {
      return { error: ['bad_request', { field: 'X-Audio-Seconds' }] }
    }
    const rawLanguage = req.headers['x-language']
    if (rawLanguage !== undefined && (typeof rawLanguage !== 'string' || !/^(auto|[a-z]{2,3})$/.test(rawLanguage))) {
      return { error: ['bad_request', { field: 'X-Language' }] }
    }
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    if (!Object.hasOwn(AUDIO_TYPES, mime)) return { error: ['unsupported_media', {}] }
    return {
      account,
      token,
      seconds: Number(rawSeconds),
      language: rawLanguage === undefined || rawLanguage === 'auto' ? null : rawLanguage,
      mime,
      ext: AUDIO_TYPES[mime],
    }
  }

  function refund(account, ip, charge) {
    daily.add(null, -charge)
    perIp.add(ip, -charge)
    return hosted.adjustTranscription(account, -charge, -1)
  }

  /** Daily budgets (global, then per IP). Returns null when `seconds` fit, else the 429 to send. */
  function budgetBlock(res, ip, seconds, extra = {}) {
    if (!daily.fits(null, seconds)) return tooManyRequests(res, 'busy_today', daily.secondsToReset(), extra)
    if (!perIp.fits(ip, seconds)) return tooManyRequests(res, 'ip_daily_limit', perIp.secondsToReset(), extra)
    return null
  }

  const gateAnswer = (req, res, gate) => {
    if (gate.kind === 'forbidden') return refuse(req, res, 403, 'forbidden_token')
    if (gate.kind === 'allowance') return refuse(req, res, 402, 'allowance_reached', gate.body)
    return refuse(req, res, 429, 'account_rate_limited', { retryAfter: gate.retryAfter }, { 'Retry-After': String(gate.retryAfter) })
  }

  async function transcribeSpool(spool, request, signal) {
    const deadline = Date.now() + cfg.transcribeTimeoutMs
    const submitSignal = AbortSignal.any([signal, AbortSignal.timeout(cfg.transcribeTimeoutMs)])
    const batchId = await submit(spool, request, submitSignal)
    return normalizeTranscript(await awaitResult(batchId, deadline, signal))
  }

  async function handle(req, res) {
    if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'POST' })
    if (!cfg.transcribeConfigured || !cfg.hostedDir) return refuse(req, res, 503, 'not_configured')
    const request = parseRequest(req)
    if (request.error) return refuse(req, res, request.error[0] === 'unsupported_media' ? 415 : 400, ...request.error)
    const ip = clientOf(req)
    const declared = declaredLength(req)
    if (declared !== null && declared > cfg.transcribeMaxBytes) return refuse(req, res, 413, 'too_large', { maxBytes: cfg.transcribeMaxBytes })
    const preCharge = declared === null ? request.seconds : transcribeCharge(request.seconds, declared)
    if (preCharge > MAX_AUDIO_SECONDS) return refuse(req, res, 413, 'too_large', { maxBytes: cfg.transcribeMaxBytes })
    const blocked = budgetBlock(res, ip, preCharge, { Connection: 'close' })
    if (blocked !== null) {
      res.once('finish', () => req.socket.destroy())
      return blocked
    }
    if (inFlight >= cfg.transcribeMaxConcurrent) return refuse(req, res, 429, 'busy', {}, { 'Retry-After': '10' })
    inFlight += 1
    const spool = store.newTmpFile()
    try {
      const gate = await hosted.checkTranscription(request.account, request.token, preCharge, ip)
      if (!gate.ok) return gateAnswer(req, res, gate)
      try {
        const { bytes } = await streamToFile(req, spool, { maxBytes: cfg.transcribeMaxBytes, idleMs: cfg.uploadIdleMs })
        if (bytes === 0) return jsonError(res, 400, 'bad_request', { field: 'body' })
        return await runJob(req, res, request, ip, transcribeCharge(request.seconds, bytes), spool)
      } catch (err) {
        if (err instanceof CapExceeded) return refuse(req, res, 413, 'too_large', { maxBytes: cfg.transcribeMaxBytes })
        if (err instanceof IdleTimeout || err?.code === 'ERR_STREAM_PREMATURE_CLOSE') return 408
        throw err
      }
    } finally {
      inFlight -= 1
      await fsp.rm(spool, { force: true })
    }
  }

  /** Charge, call the provider, reconcile, answer. The spool exists; the caller deletes it. */
  async function runJob(req, res, request, ip, charge, spool) {
    if (charge > MAX_AUDIO_SECONDS) return jsonError(res, 413, 'too_large', { maxBytes: cfg.transcribeMaxBytes })
    const blocked = budgetBlock(res, ip, charge)
    if (blocked !== null) return blocked
    daily.add(null, charge) // counted before the first await, so two racing calls cannot both slip under the budget
    perIp.add(ip, charge)
    const gate = await hosted.reserveTranscription(request.account, request.token, charge, ip)
    if (!gate.ok) {
      daily.add(null, -charge)
      perIp.add(ip, -charge)
      if (gate.kind === 'forbidden') return jsonError(res, 403, 'forbidden_token')
      if (gate.kind === 'allowance') return jsonError(res, 402, 'allowance_reached', gate.body)
      return jsonError(res, 429, 'account_rate_limited', { retryAfter: gate.retryAfter })
    }

    const abort = new AbortController()
    res.once('close', () => {
      if (!res.writableFinished) abort.abort()
    })
    let result
    try {
      result = await transcribeSpool(spool, request, abort.signal)
    } catch (err) {
      if (abort.signal.aborted) return 499 // the phone went away; the provider job may have run, so no refund
      await refund(request.account, ip, charge)
      const timeout = err instanceof ProviderError && err.kind === 'timeout'
      cfg.log(`transcribe ${timeout ? 'provider_timeout' : `provider_error status=${err instanceof ProviderError ? (err.status ?? 'n/a') : 'internal'}`}`)
      return jsonError(res, timeout ? 504 : 502, timeout ? 'provider_timeout' : 'provider_error')
    }
    let charged = charge
    const real = result.duration === null ? 0 : Math.ceil(result.duration)
    if (real > charged) {
      await hosted.adjustTranscription(request.account, real - charged)
      daily.add(null, real - charged)
      perIp.add(ip, real - charged)
      charged = real
    }
    const used = await hosted.transcriptionUsed(request.account)
    sendJson(res, 200, {
      text: result.text,
      segments: result.segments,
      language: result.language ?? request.language,
      secondsCharged: charged,
      allowance: { secondsUsed: used, secondsLimit: hosted.plan.secondsLimit },
    })
    return 200
  }

  return { handle }
}
