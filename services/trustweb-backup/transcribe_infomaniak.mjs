// Provider "infomaniak": Infomaniak AI Tools, OpenAI-compatible Whisper, an ASYNCHRONOUS batch API:
//   POST {TRANSCRIBE_URL}                                    multipart (file, model, response_format, timestamp_granularities[], language)
//        -> {"batch_id": "..."}
//   GET  .../1/ai/<product_id>/results/<batch_id>            -> {status: pending|processing|success|failed|cancelled, url, data}
//   (data: the transcript as object, JSON string, or null with a download url)
// Docs: https://developer.infomaniak.com/docs/api/post/1/ai/{product_id}/openai/audio/transcriptions
//       https://developer.infomaniak.com/docs/api/get/1/ai/{product_id}/results/{batch_id}
// The server submits, polls every TRANSCRIBE_POLL_MS up to the deadline, and answers when done.
// Env: TRANSCRIBE_URL (the full POST URL incl. product id), TRANSCRIBE_KEY (bearer token), TRANSCRIBE_MODEL (default "whisper"),
//      TRANSCRIBE_RESULTS_URL (optional template with {batch_id}; derived from TRANSCRIBE_URL otherwise).
// Kept compiling and tested against a fake provider; Jakob dropped it for now (2026-10-07), the default provider is openrouter.

import fs from 'node:fs'
import { ProviderError, ProviderFailure, normalizeTranscript } from './transcribe_provider.mjs'

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

export function createInfomaniakProvider({ cfg, fetchImpl = fetch }) {
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

  /** Submit, poll, fetch under one deadline (`signal`). job.accepted flips once a batch id exists. */
  async function transcribe(spool, request, signal, job) {
    const batchId = await submit(spool, request, signal)
    job.accepted = true
    return normalizeTranscript(await awaitResult(batchId, signal))
  }

  return { name: 'infomaniak', timeoutMs: cfg.transcribeTimeoutMs, supports: () => true, transcribe }
}
