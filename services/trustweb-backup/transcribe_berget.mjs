// Provider "berget" (the default when its key exists): Berget AI, Sweden, an OpenAI-compatible speech-to-text endpoint, one SYNCHRONOUS call.
//   POST {BERGET_URL}/audio/transcriptions      (default https://api.berget.ai/v1/audio/transcriptions)
//     multipart: file, model, response_format=verbose_json, timestamp_granularities=segment, language?
//     -> {text, duration?, language?, segments?:[{id,start,end,text}]}      (json instead of verbose_json = {text})
// Sources (read 2026-10-07): the machine-readable API description https://api.berget.ai/openapi.json (operation createTranscription),
//   the live model list https://api.berget.ai/v1/models (price EUR per SECOND, no key needed), https://docs.berget.ai/quickstart (base URL, Bearer key).
//   Formats: mp3, mp4, mpeg, mpga, m4a, wav, webm. NOT ogg, opus, aac, flac: those are not sent here (supports() says so; the chain
//   goes to the fallback, or the server answers 415 when there is none).
// Model: Systran/faster-whisper-large-v3 (multilingual; KBLab/kb-whisper-large is tuned for Swedish and the alias "whisper" means it).
// Price: EUR 0.000033 per second = about EUR 0.12 per hour of audio. There is NO free transcription model. The answer carries no cost,
//   so the log line carries an ESTIMATE (duration x TRANSCRIBE_BERGET_EUR_PER_SECOND) under the key cost_eur_est.
// Data: Berget states zero retention and that nothing leaves Sweden (https://berget.ai); there is no per-request data-policy parameter.
// A failed or rejected call never relays the provider's body (it is not even read). The key only ever goes to BERGET_URL.

import fsp from 'node:fs/promises'
import { ProviderError, ProviderFailure, isoLanguage, normalizeTranscript, withSegments } from './transcribe_provider.mjs'

/** Our file extension (transcribe.mjs AUDIO_TYPES) -> the file name extension Berget accepts. Anything else is not supported here. */
const FORMATS = Object.freeze({ webm: 'webm', m4a: 'm4a', mp3: 'mp3', wav: 'wav' })

const AUDIO_CONTENT_TYPES = Object.freeze({ webm: 'audio/webm', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' })

export function createBergetProvider({ cfg, fetchImpl = fetch }) {
  const endpoint = `${cfg.bergetUrl.replace(/\/+$/, '')}/audio/transcriptions`

  /** One POST. A non-2xx is a ProviderError (body never read); 429 is Busy; a thrown fetch is Timeout or Error. */
  async function post(form, signal, job) {
    job.accepted = true // from here on the request may be billed, even if the answer never arrives
    let response
    try {
      response = await fetchImpl(endpoint, { method: 'POST', signal, headers: { Authorization: `Bearer ${cfg.bergetKey}` }, body: form })
    } catch {
      throw new ProviderError(signal.aborted ? ProviderFailure.Timeout : ProviderFailure.Error)
    }
    if (response.status === 429) throw new ProviderError(ProviderFailure.Busy, 429)
    if (!response.ok) throw new ProviderError(ProviderFailure.Error, response.status)
    return response
  }

  /** The multipart body. A fresh FormData per request: a body is consumed by sending it. */
  function requestForm({ audio, ext, language, verbose }) {
    const form = new FormData()
    form.set('file', new Blob([audio], { type: AUDIO_CONTENT_TYPES[ext] }), `audio.${FORMATS[ext]}`)
    form.set('model', cfg.transcribeBergetModel)
    form.set('response_format', verbose ? 'verbose_json' : 'json')
    if (verbose) form.set('timestamp_granularities', 'segment')
    if (language !== null) form.set('language', language)
    return form
  }

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
    if (!supports(request.ext)) throw new ProviderError(ProviderFailure.Error)
    const audio = await fsp.readFile(spool)
    const language = request.language !== null && /^[a-z]{2}$/.test(request.language) ? request.language : null
    let response
    try {
      response = await post(requestForm({ audio, ext: request.ext, language, verbose: true }), signal, job)
    } catch (err) {
      // A 400 means Berget refused the request (e.g. the segment option) before it processed anything: ask once more for plain json,
      // same job, same charge. Any other failure ends the job.
      if (!(err instanceof ProviderError) || err.status !== 400) throw err
      response = await post(requestForm({ audio, ext: request.ext, language, verbose: false }), signal, job)
    }
    const body = await readAnswer(response, signal)
    const finite = (v) => (Number.isFinite(v) && v >= 0 ? v : 0)
    // The seconds the provider says it heard. A segment end is NOT counted (a model inventing "end: 500" for a 30 s clip must not
    // lengthen it: its segments are then dropped as unreliable instead).
    const reported = Math.max(finite(body.duration), finite(body.usage?.seconds)) || null
    const cost = reported === null ? null : Math.round(reported * cfg.transcribeBergetEurPerSecond * 1e6) / 1e6
    const parsed = normalizeTranscript(body)
    return withSegments({ ...parsed, duration: reported, language: isoLanguage(body.language), cost, costKey: 'cost_eur_est' }, request.seconds)
  }

  function supports(ext) {
    return Object.hasOwn(FORMATS, ext)
  }

  return { name: 'berget', timeoutMs: cfg.transcribeBergetTimeoutMs, supports, transcribe }
}
