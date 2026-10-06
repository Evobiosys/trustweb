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
// Money (review 2026-10-06): the provider bills by audio DURATION, and bytes do not bound duration (Opus with
// DTX encodes hours of near-silence in a few KB), so the byte-based charge alone is not a cost bound. What makes
// the daily cost bounded:
//   - one paid job at a time (TRANSCRIBE_MAX_CONCURRENT 1), a short wait queue, one upload per client in flight;
//   - the charge is booked on the daily budgets BEFORE the provider call;
//   - once the provider accepted a job, the job is followed to its end even when the phone goes away, and the
//     provider-reported duration is booked (so a long job pushes today's budget over and nothing more runs today);
//   - a job that outlives the deadline keeps its charge and CLOSES today's global budget (its real cost is unknown).
// Residual: one crafted job per UTC day can cost what the provider charges for the longest audio it accepts.
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
import { createDailyMeter, createInFlight, createSlots, ipKey } from './limits.mjs'
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

/** How a provider call ended when it did not deliver a transcript. */
const ProviderFailure = Object.freeze({ Error: 'error', Timeout: 'timeout' })

class ProviderError extends Error {
  constructor(kind, status = null) {
    super(`provider ${kind}`)
    this.kind = kind // a ProviderFailure
    this.status = status
    this.accepted = false // set once the provider has taken the job (a batch id exists): from then on it may bill
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
  const providerSlots = createSlots({ slots: cfg.transcribeMaxConcurrent, queue: cfg.transcribeQueue })
  const uploads = createInFlight({ total: cfg.transcribeMaxConcurrent + cfg.transcribeQueue, perKey: cfg.transcribeUploadsPerIp })

  function resultsUrl(batchId) {
    if (cfg.transcribeResultsUrl) return cfg.transcribeResultsUrl.replace('{batch_id}', encodeURIComponent(batchId))
    const m = /^(.*\/ai\/[^/]+)\/openai\/audio\/transcriptions\/?$/.exec(cfg.transcribeUrl)
    if (m === null) throw new ProviderError(ProviderFailure.Error)
    return `${m[1]}/results/${encodeURIComponent(batchId)}`
  }

  /** Every provider request goes through here: the key is added, a non-2xx is a ProviderError (its body is never read). */
  async function providerFetch(url, init, signal) {
    try {
      const response = await fetchImpl(url, { ...init, signal, headers: { ...init.headers, Authorization: `Bearer ${cfg.transcribeKey}` } })
      if (!response.ok) throw new ProviderError(ProviderFailure.Error, response.status)
      return response
    } catch (err) {
      if (err instanceof ProviderError) throw err
      throw new ProviderError(signal.aborted ? ProviderFailure.Timeout : ProviderFailure.Error)
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
    if (typeof batchId !== 'string' || batchId === '') throw new ProviderError(ProviderFailure.Error)
    return batchId
  }

  async function download(url, signal) {
    if (new URL(url).origin !== new URL(cfg.transcribeUrl).origin) throw new ProviderError(ProviderFailure.Error) // never send the key elsewhere
    const response = await providerFetch(url, { method: 'GET' }, signal)
    const text = await response.text()
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  async function awaitResult(batchId, signal) {
    for (;;) {
      const response = await providerFetch(resultsUrl(batchId), { method: 'GET' }, signal)
      const raw = await response.json().catch(() => null)
      const body = raw?.status === undefined && raw?.data?.status !== undefined ? raw.data : raw
      switch (body?.status) {
        case 'success':
          if (body.data !== null && body.data !== undefined) return body.data
          if (typeof body.url === 'string') return download(body.url, signal)
          throw new ProviderError(ProviderFailure.Error)
        case 'pending':
        case 'processing':
          await sleep(cfg.transcribePollMs, signal)
          break
        default:
          throw new ProviderError(ProviderFailure.Error) // failed, cancelled or unknown
      }
    }
  }

  /**
   * Submit, poll, fetch: one deadline for all of it (TRANSCRIBE_TIMEOUT_MS). Deliberately NOT tied to the phone's
   * connection: once the provider has the job, it is followed to its end so its real duration gets booked.
   * Throws a ProviderError whose `accepted` says whether the provider had taken the job.
   */
  async function transcribeSpool(spool, request) {
    const signal = AbortSignal.timeout(cfg.transcribeTimeoutMs)
    let accepted = false
    try {
      const batchId = await submit(spool, request, signal)
      accepted = true
      return normalizeTranscript(await awaitResult(batchId, signal))
    } catch (err) {
      const failure = err instanceof ProviderError ? err : new ProviderError(signal.aborted ? ProviderFailure.Timeout : ProviderFailure.Error)
      if (signal.aborted) failure.kind = ProviderFailure.Timeout
      failure.accepted = accepted
      throw failure
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

  function book(ip, seconds) {
    daily.add(null, seconds)
    perIp.add(ip, seconds)
  }

  function refund(account, ip, charge) {
    book(ip, -charge)
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

  const clientGone = (req, res) => res.destroyed || req.socket.destroyed

  async function handle(req, res) {
    if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'POST' })
    if (!cfg.transcribeConfigured || !cfg.hostedDir) return refuse(req, res, 503, 'not_configured')
    const request = parseRequest(req)
    if (request.error) return refuse(req, res, request.error[0] === 'unsupported_media' ? 415 : 400, ...request.error)
    const ip = ipKey(clientOf(req))
    const declared = declaredLength(req)
    if (declared !== null && declared > cfg.transcribeMaxBytes) return refuse(req, res, 413, 'too_large', { maxBytes: cfg.transcribeMaxBytes })
    const preCharge = declared === null ? request.seconds : transcribeCharge(request.seconds, declared)
    if (preCharge > MAX_AUDIO_SECONDS) return refuse(req, res, 413, 'too_large', { maxBytes: cfg.transcribeMaxBytes })
    const blocked = budgetBlock(res, ip, preCharge, { Connection: 'close' })
    if (blocked !== null) {
      res.once('finish', () => req.socket.destroy())
      return blocked
    }
    if (providerSlots.full()) return refuse(req, res, 429, 'busy', { retryAfter: 10 }, { 'Retry-After': '10' })
    const releaseUpload = uploads.tryAcquire(ip)
    if (releaseUpload === null) return refuse(req, res, 429, 'busy', { retryAfter: 10 }, { 'Retry-After': '10' })
    const spool = store.newTmpFile()
    try {
      const gate = await hosted.checkTranscription(request.account, request.token, preCharge, ip)
      if (!gate.ok) return gateAnswer(req, res, gate)
      let bytes
      try {
        ;({ bytes } = await streamToFile(req, spool, { maxBytes: cfg.transcribeMaxBytes, idleMs: cfg.uploadIdleMs }))
      } catch (err) {
        if (err instanceof CapExceeded) return refuse(req, res, 413, 'too_large', { maxBytes: cfg.transcribeMaxBytes })
        if (err instanceof IdleTimeout || err?.code === 'ERR_STREAM_PREMATURE_CLOSE') return 408
        throw err
      } finally {
        releaseUpload()
      }
      if (bytes === 0) return jsonError(res, 400, 'bad_request', { field: 'body' })
      return await runJob(req, res, request, ip, transcribeCharge(request.seconds, bytes), spool)
    } finally {
      releaseUpload()
      await fsp.rm(spool, { force: true })
    }
  }

  /** Wait for the paid slot, charge, call the provider, book the real duration, answer. The caller deletes the spool. */
  async function runJob(req, res, request, ip, charge, spool) {
    if (charge > MAX_AUDIO_SECONDS) return jsonError(res, 413, 'too_large', { maxBytes: cfg.transcribeMaxBytes })
    const waiting = providerSlots.acquire(cfg.transcribeQueueWaitMs)
    if (waiting === null) return tooManyRequests(res, 'busy', 10)
    const releaseSlot = await waiting
    if (releaseSlot === null) return tooManyRequests(res, 'busy', 60) // waited TRANSCRIBE_QUEUE_WAIT_MS in vain; nothing charged
    try {
      if (clientGone(req, res)) return 499 // gone while waiting: nothing was sent to the provider, nothing charged
      const blocked = budgetBlock(res, ip, charge)
      if (blocked !== null) return blocked
      book(ip, charge) // before the first await, so two calls cannot both slip under the budget
      const gate = await hosted.reserveTranscription(request.account, request.token, charge, ip)
      if (!gate.ok) {
        book(ip, -charge)
        if (gate.kind === 'forbidden') return jsonError(res, 403, 'forbidden_token')
        if (gate.kind === 'allowance') return jsonError(res, 402, 'allowance_reached', gate.body)
        return tooManyRequests(res, 'account_rate_limited', gate.retryAfter)
      }
      let result
      try {
        result = await transcribeSpool(spool, request)
      } catch (err) {
        return failJob(res, request, ip, charge, err)
      }
      const charged = await bookRealDuration(request.account, ip, charge, result.duration)
      if (clientGone(req, res)) return 499 // the job ran and is booked; nobody is left to read the answer
      const used = await hosted.transcriptionUsed(request.account)
      sendJson(res, 200, {
        text: result.text,
        segments: result.segments,
        language: result.language ?? request.language,
        secondsCharged: charged,
        allowance: { secondsUsed: used, secondsLimit: hosted.plan.secondsLimit },
      })
      return 200
    } finally {
      releaseSlot()
    }
  }

  /** The provider reported a longer duration than was charged: book the difference everywhere. Returns the final charge. */
  async function bookRealDuration(account, ip, charge, duration) {
    const real = duration === null ? 0 : Math.ceil(duration)
    if (duration === null) cfg.log('transcribe no_duration') // nothing to reconcile with: the charge stays as it was
    if (real <= charge) return charge
    await hosted.adjustTranscription(account, real - charge)
    book(ip, real - charge)
    return real
  }

  /**
   * A job without a transcript. Refused or failed at the provider: the seconds go back. Timed out: the provider may
   * still be running (and billing) it, so the charge stays and today's global budget is closed.
   */
  async function failJob(res, request, ip, charge, err) {
    const timeout = err.kind === ProviderFailure.Timeout
    if (timeout && err.accepted) daily.close(null)
    else await refund(request.account, ip, charge)
    cfg.log(`transcribe ${timeout ? `provider_timeout accepted=${err.accepted}` : `provider_error status=${err.status ?? 'n/a'}`}`)
    if (res.destroyed) return 499
    return jsonError(res, timeout ? 504 : 502, timeout ? 'provider_timeout' : 'provider_error')
  }

  return { handle }
}
