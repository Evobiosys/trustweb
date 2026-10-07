// What every transcription provider (transcribe_infomaniak.mjs, transcribe_openrouter.mjs) shares: the error type,
// the normalised transcript shape, and the sentence-level fallback for providers that return no usable segment times.
//
// A provider is {name, timeoutMs, supports(ext), transcribe(spool, request, signal, job)} and resolves to a Transcript:
//   {text, segments:[{start,end,text}], duration (seconds or null), language (or null), approx (bool), cost (number or null),
//    costKey (the log key naming cost's unit; absent = cost_usd)}
//   supports(ext): can the provider take this file extension at all (else it is skipped, and with no other provider the caller answers 415).
//   timeoutMs: its own deadline for one transcribe call.
// It throws a ProviderError otherwise. `job.accepted` is set to true the moment the provider may bill the job
// (Infomaniak: a batch id exists; OpenRouter: the request went out), because a timeout after that point still costs money.

/** How a provider call ended when it did not deliver a transcript. */
export const ProviderFailure = Object.freeze({
  Error: 'error', // refused or failed: nothing billed, the seconds go back
  Timeout: 'timeout', // the deadline passed
  Busy: 'busy', // the provider (or the key's rate limit) asks to come back later: nothing billed
})

export class ProviderError extends Error {
  constructor(kind, status = null) {
    super(`provider ${kind}`)
    this.kind = kind // a ProviderFailure
    this.status = status
    this.accepted = false // set by the transcriber from job.accepted
  }
}

/** Whisper reports the language by English name; the contract says ISO 639-1. */
const LANGUAGE_CODES = Object.freeze({
  german: 'de', english: 'en', french: 'fr', italian: 'it', spanish: 'es', dutch: 'nl', portuguese: 'pt', russian: 'ru', polish: 'pl',
  czech: 'cs', slovak: 'sk', slovenian: 'sl', hungarian: 'hu', croatian: 'hr', serbian: 'sr', swedish: 'sv', danish: 'da',
  norwegian: 'no', finnish: 'fi', turkish: 'tr', ukrainian: 'uk', greek: 'el', romanian: 'ro', bulgarian: 'bg', japanese: 'ja',
  chinese: 'zh', korean: 'ko', arabic: 'ar', hindi: 'hi', swahili: 'sw', latin: 'la',
})

/** ISO code from whatever the provider reported, or null. */
export function isoLanguage(raw) {
  if (typeof raw !== 'string') return null
  const v = raw.trim().toLowerCase()
  if (/^[a-z]{2}$/.test(v)) return v
  return Object.hasOwn(LANGUAGE_CODES, v) ? LANGUAGE_CODES[v] : null
}

const round2 = (n) => Math.round(n * 100) / 100

/** Segments the provider returned, cleaned: finite numbers, trimmed text, no empty text. */
export function cleanSegments(rawSegments) {
  return rawSegments
    .filter((s) => s !== null && typeof s === 'object' && Number.isFinite(s.start) && Number.isFinite(s.end) && typeof s.text === 'string')
    .map((s) => ({ start: round2(s.start), end: round2(s.end), text: s.text.trim() }))
}

/**
 * Provider result data in any of its shapes -> {text, segments, duration, language, approx:false, cost:null}.
 * Accepts an object, a JSON string, a bare segment array or plain text. Throws ProviderError('error') when unusable.
 */
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
  if (typeof v === 'string') return { text: v.trim(), segments: [], duration: null, language: null, approx: false, cost: null }
  if (v === null || typeof v !== 'object') throw new ProviderError(ProviderFailure.Error)
  const segments = cleanSegments(Array.isArray(v) ? v : Array.isArray(v.segments) ? v.segments : [])
  const text = !Array.isArray(v) && typeof v.text === 'string' ? v.text.trim() : segments.map((s) => s.text).join(' ').trim()
  const lastEnd = segments.reduce((max, s) => Math.max(max, s.end), 0)
  const duration = !Array.isArray(v) && Number.isFinite(v.duration) ? Math.max(v.duration, lastEnd) : lastEnd || null
  const language = !Array.isArray(v) && typeof v.language === 'string' ? v.language : null
  return { text, segments, duration, language, approx: false, cost: null }
}

/** Sentences of `text`, in order (Intl.Segmenter where the runtime has it, a punctuation split otherwise). */
export function splitSentences(text) {
  const trimmed = text.trim()
  if (trimmed === '') return []
  const parts =
    typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(trimmed), (s) => s.segment)
      : (trimmed.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [trimmed])
  return parts.map((s) => s.trim()).filter((s) => s !== '')
}

/**
 * Sentence-level segments with times proportional to each sentence's share of the characters, spread over `seconds`.
 * An approximation: the app shows it as such (the answer carries approx:true).
 */
export function approxSegments(text, seconds) {
  const sentences = splitSentences(text)
  if (sentences.length === 0 || !Number.isFinite(seconds) || seconds <= 0) return []
  const total = sentences.reduce((n, s) => n + s.length, 0)
  let done = 0
  return sentences.map((sentence) => {
    const start = (done / total) * seconds
    done += sentence.length
    return { start: round2(start), end: round2((done / total) * seconds), text: sentence }
  })
}

/**
 * Can the provider's segment times be believed? They must exist, be ordered, stay inside the audio (declared or reported
 * duration, 5 % + 1 s slack) and carry most of the text. Otherwise the caller falls back to approxSegments.
 */
export function segmentsReliable(segments, text, seconds) {
  if (segments.length === 0 || !Number.isFinite(seconds) || seconds <= 0) return false
  let previousStart = -1
  for (const s of segments) {
    if (s.start < 0 || s.end < s.start || s.start < previousStart) return false
    previousStart = s.start
  }
  if (segments[segments.length - 1].end > seconds * 1.05 + 1) return false
  const covered = segments.reduce((n, s) => n + s.text.length, 0)
  return covered >= text.length * 0.5
}

/**
 * Final shape of a transcript: provider segments when reliable, else sentence-level approximations (approx:true).
 * `seconds` = the duration to spread them over (reported duration, else what was declared).
 */
export function withSegments(transcript, seconds) {
  const span = transcript.duration ?? seconds
  if (transcript.text === '' || segmentsReliable(transcript.segments, transcript.text, span)) return { ...transcript, approx: false }
  const approx = approxSegments(transcript.text, span)
  return { ...transcript, segments: approx, approx: approx.length > 0 }
}
