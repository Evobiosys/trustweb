// POST /transcribe: audio in, {text, segments} out, nothing stored (see services-api-contract.txt, section 4).
//
// Providers (TRANSCRIBE_PROVIDER, default auto; each in its own module, see transcribe_provider.mjs for the shared shape):
//   berget      transcribe_berget.mjs       one synchronous call to Berget AI (Sweden), multipart, Whisper billed per second: the default when its key exists
//   openrouter  transcribe_openrouter.mjs   one synchronous call to OpenRouter's speech-to-text endpoint (Whisper, billed per second, US inference)
//   infomaniak  transcribe_infomaniak.mjs   Infomaniak AI Tools Whisper, an asynchronous batch API (submit, poll, fetch)
// Berget first with OpenRouter behind it is a chain (transcribe_chain.mjs): one provider to this module, charged once.
// This module owns everything that is not the provider: validation, the spool file, the budgets, the paid slot, the charging.
//
// WHO PAYS FOR A FAILURE (Jakob 2026-10-07: "don't bill the user with failed transcripts"): the person's allowance is charged only for a
// transcript they RECEIVED. A refused, failed, timed-out or lost job (the phone left before the answer) always goes back to the person.
// The global daily budget and the client's daily cap are different: they bound OUR cost, so a job that may still have been billed
// (a timeout, or a gateway status, see UNCERTAIN_STATUSES) keeps its seconds on them, and a timeout closes today's global budget.
//
// Money (review 2026-10-06): the provider bills by audio DURATION, and bytes do not bound duration (Opus with
// DTX encodes hours of near-silence in a few KB), so the byte-based charge alone is not a cost bound. What makes
// the daily cost bounded:
//   - one paid job at a time (TRANSCRIBE_MAX_CONCURRENT 1), a short wait queue, one upload per client in flight;
//   - the charge is booked on the daily budgets BEFORE the provider call;
//   - once the provider may have taken a job, the job is followed to its end even when the phone goes away, and the
//     provider-reported duration (openrouter: usage.seconds, the billed seconds) is booked, so a long job pushes today's
//     budget over and nothing more runs today;
//   - a job that outlives the deadline keeps its charge and CLOSES today's global budget (its real cost is unknown).
// Residual: one crafted job per UTC day can cost what the provider charges for the longest audio it accepts (cents to ~12 cents per
// hour of audio, see the README).
//
// Without a key (or, for openrouter, without TRANSCRIBE_ENABLED=1): 503 not_configured. Logs carry no audio, text, key or provider body.

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
import { ProviderError, ProviderFailure } from './transcribe_provider.mjs'
import { createBergetProvider } from './transcribe_berget.mjs'
import { createProviderChain } from './transcribe_chain.mjs'
import { createInfomaniakProvider } from './transcribe_infomaniak.mjs'
import { createOpenRouterProvider } from './transcribe_openrouter.mjs'
import { TranscribeProvider } from './config.mjs'

const MAX_AUDIO_SECONDS = 3600

/**
 * Provider answers that can arrive AFTER the audio was processed (gateway and timeout statuses, e.g. the ~60 s upstream cut):
 * the job may have been billed although it failed. OpenRouter's docs do not say whether a failed transcription is billed
 * (they only promise "zero-completion insurance" for completions and warn that prompt processing can still be charged),
 * so such a failure is refunded to the person but COUNTED; the third one in a UTC day closes today's global budget.
 */
const UNCERTAIN_STATUSES = new Set([408, 502, 504, 524])

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

const PROVIDER_FACTORIES = Object.freeze({
  [TranscribeProvider.Berget]: createBergetProvider,
  [TranscribeProvider.OpenRouter]: createOpenRouterProvider,
  [TranscribeProvider.Infomaniak]: createInfomaniakProvider,
})

/**
 * The provider (or chain of providers) the config names, or null when nothing can serve (unknown name, no key).
 * `onFallback` runs when a link of a chain failed and the next one takes over.
 */
function createProvider(cfg, fetchImpl, onFallback) {
  const names = cfg.transcribeProvider === TranscribeProvider.Infomaniak ? [TranscribeProvider.Infomaniak] : cfg.transcribeChain
  const links = names.filter((name) => Object.hasOwn(PROVIDER_FACTORIES, name)).map((name) => PROVIDER_FACTORIES[name]({ cfg, fetchImpl }))
  return links.length === 0 ? null : createProviderChain({ links, onFallback })
}

/** True when a failed job may still have been billed by the provider (a timeout after the request went out, or a gateway status). */
function mayHaveBeenBilled(failure) {
  return failure.accepted && (failure.kind === ProviderFailure.Timeout || UNCERTAIN_STATUSES.has(failure.status))
}

export function createTranscriber({ cfg, hosted, store, clientOf, fetchImpl = fetch }) {
  const daily = createDailyMeter({ limit: cfg.transcribeDailySeconds, now: cfg.now })
  const perIp = createDailyMeter({ limit: cfg.transcribeIpDailySeconds, now: cfg.now })
  const uncertain = createDailyMeter({ limit: cfg.transcribeUncertainPerDay, now: cfg.now })
  const providerSlots = createSlots({ slots: cfg.transcribeMaxConcurrent, queue: cfg.transcribeQueue })
  const uploads = createInFlight({ total: cfg.transcribeMaxConcurrent + cfg.transcribeQueue, perKey: cfg.transcribeUploadsPerIp })

  const provider = createProvider(cfg, fetchImpl, (failure) => {
    cfg.log(`transcribe fallback from=${failure.provider} kind=${failure.kind} status=${failure.status ?? 'n/a'}`)
    if (mayHaveBeenBilled(failure)) countUncertain()
  })

  /**
   * One deadline for the whole provider call: the provider's own timeoutMs (a chain: the sum of its links', each link also has its own). Deliberately NOT tied to the phone's connection:
   * once the provider may have the job, it is followed to its end so its real duration gets booked.
   * Throws a ProviderError whose `accepted` says whether the provider may have taken (and be billing) the job.
   */
  async function transcribeSpool(spool, request) {
    const signal = AbortSignal.timeout(provider.timeoutMs)
    const job = { accepted: false }
    try {
      return await provider.transcribe(spool, request, signal, job)
    } catch (err) {
      const failure = err instanceof ProviderError ? err : new ProviderError(signal.aborted ? ProviderFailure.Timeout : ProviderFailure.Error)
      if (signal.aborted) failure.kind = ProviderFailure.Timeout
      failure.accepted = job.accepted || failure.accepted
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

  /** The seconds go back to the PERSON's allowance (and its count): it got no transcript. Call once per job. */
  function refundPerson(account, charge) {
    return hosted.adjustTranscription(account, -charge, -1)
  }

  /** Everything goes back: the person's allowance and our budgets (the provider refused or failed the job, nothing was billed). */
  function refund(account, ip, charge) {
    book(ip, -charge)
    return refundPerson(account, charge)
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
    if (!cfg.transcribeConfigured || !cfg.hostedDir || provider === null) return refuse(req, res, 503, 'not_configured')
    const request = parseRequest(req)
    if (request.error) return refuse(req, res, request.error[0] === 'unsupported_media' ? 415 : 400, ...request.error)
    if (!provider.supports(request.ext)) return refuse(req, res, 415, 'unsupported_media') // no provider takes this file type: refused before any budget or audio
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
      if (clientGone(req, res)) return lostJob(request, ip, charge, result.duration)
      const charged = await bookRealDuration(request.account, ip, charge, result.duration)
      const used = await hosted.transcriptionUsed(request.account)
      const from = result.fellBackFrom ? ` fellback_from=${result.fellBackFrom}` : ''
      cfg.log(`transcribe ok provider=${result.servedBy ?? provider.name} seconds=${charged} ${result.costKey ?? 'cost_usd'}=${result.cost ?? 'n/a'} approx=${result.approx}${from}`)
      sendJson(res, 200, {
        text: result.text,
        segments: result.segments,
        ...(result.approx ? { approx: true } : {}), // segment times are sentence-level estimates, not the provider's
        language: result.language ?? request.language,
        secondsCharged: charged,
        allowance: { secondsUsed: used, secondsLimit: hosted.plan.secondsLimit },
      })
      return 200
    } finally {
      releaseSlot()
    }
  }

  /**
   * The job ran but the phone is gone before the answer (a lost job): the person gets their seconds back, they never saw the
   * transcript. The provider billed the audio, so the real duration stays on OUR budgets. Returns 499.
   */
  async function lostJob(request, ip, charge, duration) {
    const real = duration === null ? 0 : Math.ceil(duration)
    if (real > charge) book(ip, real - charge)
    await refundPerson(request.account, charge)
    cfg.log('transcribe lost_job refunded_to_person')
    return 499
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

  /** A failure that may still have been billed (mayHaveBeenBilled): the Nth in one UTC day closes the global budget. */
  function countUncertain() {
    uncertain.add(null, 1)
    if (!uncertain.fits(null, 1)) daily.close(null)
  }

  /**
   * A job without a transcript. The PERSON always gets the seconds back. Our budgets: refused or failed at the provider = back too;
   * timed out after the request went out = the provider may still be running (and billing) it, so the seconds stay on the budgets and
   * today's global budget closes. The provider asking us to wait (its 429): nothing was billed, the phone is told to come back later.
   * The provider's own words never go out.
   */
  async function failJob(res, request, ip, charge, err) {
    const timeout = err.kind === ProviderFailure.Timeout
    if (timeout && err.accepted) {
      daily.close(null)
      await refundPerson(request.account, charge)
    } else {
      await refund(request.account, ip, charge)
    }
    if (!timeout && mayHaveBeenBilled(err)) countUncertain()
    cfg.log(`transcribe ${timeout ? `provider_timeout accepted=${err.accepted}` : `provider_${err.kind} status=${err.status ?? 'n/a'}`}`)
    if (res.destroyed) return 499
    if (err.kind === ProviderFailure.Busy) return tooManyRequests(res, 'busy', 30)
    return jsonError(res, timeout ? 504 : 502, timeout ? 'provider_timeout' : 'provider_error')
  }

  return { handle }
}
