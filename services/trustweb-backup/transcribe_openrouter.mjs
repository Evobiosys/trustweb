// Provider "openrouter" (the default): OpenRouter's dedicated speech-to-text endpoint, one SYNCHRONOUS call.
//   POST {OPENROUTER_URL}/audio/transcriptions   (default https://openrouter.ai/api/v1/audio/transcriptions)
//     JSON {model, input_audio:{data:<base64>, format}, language?, response_format:"verbose_json",
//           timestamp_granularities:["segment"], provider:{data_collection:"deny"}}
//     -> {text, language?, duration?, segments?, usage:{seconds, cost, ...}}
// Docs (read 2026-10-07): https://openrouter.ai/docs/guides/overview/multimodal/stt
//   formats wav, mp3, flac, m4a, ogg, webm, aac; verbose_json = segments with start/end where the serving provider supports it
//   (a provider that cannot answers 400: we then ask once more for plain json and approximate sentence times);
//   multipart takes no `provider` field, so the JSON form is used to carry the data policy (privacy: data_collection deny);
//   routing order/only/ignore is NOT applied to transcription, so which inference provider serves a call is up to OpenRouter.
// Price: duration-based, usage.cost in USD comes back with every answer. Upstream providers time out after ~60 s per request.
//
// Env: OPENROUTER_URL (base, default https://openrouter.ai/api/v1), TRANSCRIBE_MODEL (default openai/whisper-large-v3-turbo),
//      TRANSCRIBE_DATA_COLLECTION (deny | allow; default deny), the key from the systemd credential (see config.mjs).
// A failed or rejected call never relays the provider's body (it is not even read). The key only ever goes to OPENROUTER_URL.

import fsp from 'node:fs/promises'
import { ProviderError, ProviderFailure, isoLanguage, normalizeTranscript, withSegments } from './transcribe_provider.mjs'

export { isoLanguage } // kept here for the importers that already take it from this module

/** Our file extension (transcribe.mjs AUDIO_TYPES) -> the `format` OpenRouter expects. */
const FORMATS = Object.freeze({ webm: 'webm', ogg: 'ogg', opus: 'ogg', m4a: 'm4a', mp3: 'mp3', wav: 'wav', aac: 'aac', flac: 'flac' })

export function createOpenRouterProvider({ cfg, fetchImpl = fetch }) {
  const endpoint = `${cfg.openrouterUrl.replace(/\/+$/, '')}/audio/transcriptions`

  /** One POST. A non-2xx is a ProviderError (body never read); 429 is Busy; a thrown fetch is Timeout or Error. */
  async function post(body, signal, job) {
    job.accepted = true // from here on the request may be billed, even if the answer never arrives
    let response
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        signal,
        headers: { Authorization: `Bearer ${cfg.transcribeKey}`, 'Content-Type': 'application/json' },
        body,
      })
    } catch {
      throw new ProviderError(signal.aborted ? ProviderFailure.Timeout : ProviderFailure.Error)
    }
    if (response.status === 429) throw new ProviderError(ProviderFailure.Busy, 429)
    if (!response.ok) throw new ProviderError(ProviderFailure.Error, response.status)
    return response
  }

  /** The request JSON as a string: the audio is base64 inside it (peak memory about 4x the audio, one job at a time). */
  function requestBody({ audio, format, language, verbose }) {
    const head = {
      model: cfg.transcribeModel,
      input_audio: { data: '@@AUDIO@@', format },
      provider: { data_collection: cfg.transcribeDataCollection },
    }
    if (language !== null) head.language = language
    if (verbose) Object.assign(head, { response_format: 'verbose_json', timestamp_granularities: ['segment'] })
    const [before, after] = JSON.stringify(head).split('"@@AUDIO@@"')
    return `${before}"${audio.toString('base64')}"${after}`
  }

  /** The answer body as an object with a string `text`, else a ProviderError. */
  async function readAnswer(response, signal) {
    let body
    try {
      body = await response.json()
    } catch {
      throw new ProviderError(signal.aborted ? ProviderFailure.Timeout : ProviderFailure.Error)
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body) || typeof body.text !== 'string') throw new ProviderError(ProviderFailure.Error)
    return body
  }

  async function transcribe(spool, request, signal, job) {
    const format = FORMATS[request.ext]
    if (format === undefined) throw new ProviderError(ProviderFailure.Error)
    const audio = await fsp.readFile(spool)
    const language = request.language !== null && /^[a-z]{2}$/.test(request.language) ? request.language : null
    let response
    try {
      response = await post(requestBody({ audio, format, language, verbose: true }), signal, job)
    } catch (err) {
      // A provider that cannot give segment times refuses verbose_json with a 400 before it processes anything:
      // ask once more for plain json (same job, same charge). Any other failure ends the job.
      if (!(err instanceof ProviderError) || err.status !== 400) throw err
      response = await post(requestBody({ audio, format, language, verbose: false }), signal, job)
    }
    const body = await readAnswer(response, signal)
    const finite = (v) => (Number.isFinite(v) && v >= 0 ? v : 0)
    // The seconds the provider says it billed or heard. A segment end is NOT counted: a model that invents "end: 500" for a
    // 30 s clip must not make the clip 500 s long (its segments are then dropped as unreliable instead).
    const reported = Math.max(finite(body.duration), finite(body.usage?.seconds)) || null
    const cost = Number.isFinite(body.usage?.cost) ? body.usage.cost : null
    const parsed = normalizeTranscript(body)
    return withSegments({ ...parsed, duration: reported, language: isoLanguage(body.language), cost }, request.seconds)
  }

  return { name: 'openrouter', timeoutMs: cfg.transcribeTimeoutMs, supports: () => true, transcribe }
}
