/**
 * The app's side of the Swiss server's newer routes (wave 1733 round B), coded
 * against DEVLOG/trustweb-wave-1733/services-api-contract.txt v1.3:
 *   GET  /hosted/status                     what is switched on (drives the Settings wording)
 *   GET  /hosted/<account>/usage | /recs    the free allowance and what is stored
 *   PUT  | GET | DELETE /hosted/<account>/rec/<rid>   one recording, ciphertext only
 *   POST /transcribe                        audio in, {text, segments} out, nothing kept
 * Same origin as /backup, so no CORS. Every error answer is JSON with an
 * "error" code; the app maps the code (SwissError) to its own words and never
 * shows the server's English message.
 *
 * The hosted account is a dedicated random secret made on this phone (kept in
 * the record, so it rides inside the encrypted backup and a restored phone
 * reaches the same recordings). Account id, write token and the recordings'
 * encryption key come from it by HKDF with the contract's info strings, so the
 * account id never equals a backup id. No per-recording read capability
 * (X-Read-Token) is ever sent: the owner reads with the write token, so the
 * contract's "read token must differ from write token" rule cannot be broken.
 *
 * DOM-free (fetch and WebCrypto only), so the unit tests run the exact code.
 */
import { InferenceRegion, ProviderDataPolicy, TranscribeProviderName } from './model'
import type { TranscribeProviderInfo } from './model'

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** The error codes the app tells apart (contract section 0, 3, 4), plus what can go wrong on the way. */
export enum SwissError {
  NotConfigured = 'not_configured',
  AllowanceReached = 'allowance_reached',
  /** 429 busy: the paid slot and its queue are full (the one answer worth retrying by itself). */
  Busy = 'busy',
  /** 429 busy_today / ip_daily_limit: the day's budget is used up. */
  BusyToday = 'busy_today',
  /** 429 rate_limited / account_rate_limited. */
  RateLimited = 'rate_limited',
  Forbidden = 'forbidden',
  NotFound = 'not_found',
  TooLarge = 'too_large',
  Unsupported = 'unsupported_media',
  StorageFull = 'storage_full',
  Provider = 'provider_error',
  /** 504 provider_timeout, or the app's own 15 minutes ran out, or the connection dropped: may still be charged. */
  Timeout = 'timeout',
  BadRequest = 'bad_request',
  /** The server could not be reached at all (offline, DNS, refused). */
  Network = 'network',
  Server = 'server_error',
}

export class SwissServerError extends Error {
  constructor(
    readonly code: SwissError,
    readonly status: number,
    readonly retryAfterS: number | null = null,
    readonly body: Record<string, unknown> | null = null,
  ) {
    super(`swiss server: ${code} (${status})`)
    this.name = 'SwissServerError'
  }
}

/** The free plan's numbers and what an account used of them (contract section 1 and 3, GET /usage). */
export interface Usage {
  plan: string
  secondsUsed: number
  secondsLimit: number
  bytesUsed: number
  bytesLimit: number
  recordings: number
  maxRecordings: number
  maxSecondsPerRecording: number
  maxBytesPerRecording: number
  transcription: { secondsUsed: number; secondsLimit: number }
}

/** GET /hosted/status. `plan` = the usage of an empty account (the limits); null when hosting is off. */
export interface ServerStatus {
  hosted: boolean
  transcribe: boolean
  feedback: boolean
  plan: Usage | null
  /** Who transcribes and where (wave 2, contract v1.5). Null: the server did not say (an older server). */
  provider: TranscribeProviderInfo | null
}

export interface HostedRecordingInfo {
  id: string
  bytes: number
  seconds: number
  stored: string
}

export interface TranscriptSegment {
  /** Seconds from the start of the audio. */
  start: number
  end: number
  text: string
}

export interface TranscribeResult {
  text: string
  segments: TranscriptSegment[]
  language: string | null
  secondsCharged: number
  /** The server estimated the segment times per sentence (contract v1.4 "approx": true). */
  approx: boolean
}

/** Account id and write token of the hosted account, and the key the recordings are sealed with. */
export interface HostedAccount {
  account: string
  token: string
  encKey: CryptoKey
}

const HEX64 = /^[0-9a-f]{64}$/
const HEX32 = /^[0-9a-f]{32}$/
const INFO_ACCOUNT = 'trustweb-hosted/v1/account'
const INFO_TOKEN = 'trustweb-hosted/v1/token'
const INFO_ENC = 'trustweb-hosted/v1/enc'
/** /transcribe may wait 4 min for the slot and 10 min for the job (contract v1.3): the app allows 15 minutes in all. */
export const TRANSCRIBE_TIMEOUT_MS = 15 * 60_000
/** One recording on the server, and one transcription: at most 1 hour (contract section 1 and 4). */
export const MAX_SECONDS_PER_CALL = 3600

const enc = new TextEncoder()

function buf(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes)
  crypto.getRandomValues(b)
  return toHex(b)
}

/** A new hosted-account secret (32 random bytes, hex). */
export function newHostedSecret(): string {
  return randomHex(32)
}

/** A new recording id as the contract wants it (32 lowercase hex, chosen by the phone). */
export function newRecordingId(): string {
  return randomHex(16)
}

export function isHostedSecret(v: unknown): v is string {
  return typeof v === 'string' && HEX64.test(v)
}

export function isRecordingId(v: unknown): v is string {
  return typeof v === 'string' && HEX32.test(v)
}

export async function hostedAccount(secret: string): Promise<HostedAccount> {
  if (!isHostedSecret(secret)) throw new Error('not a hosted-account secret')
  const ikm = await crypto.subtle.importKey('raw', buf(fromHex(secret)), 'HKDF', false, ['deriveBits', 'deriveKey'])
  const params = (info: string): HkdfParams => ({ name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(0), info: buf(enc.encode(info)) })
  const bits = async (info: string): Promise<string> => toHex(new Uint8Array(await crypto.subtle.deriveBits(params(info), ikm, 256)))
  const encKey = await crypto.subtle.deriveKey(params(INFO_ENC), ikm, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  return { account: await bits(INFO_ACCOUNT), token: await bits(INFO_TOKEN), encKey }
}

const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

/** The usage body, read defensively (any missing number reads 0; the transcription part may be absent). */
export function parseUsage(v: unknown): Usage | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.secondsLimit !== 'number' || typeof o.bytesLimit !== 'number') return null
  const t = typeof o.transcription === 'object' && o.transcription !== null ? o.transcription as Record<string, unknown> : {}
  return {
    plan: typeof o.plan === 'string' ? o.plan : 'free',
    secondsUsed: num(o.secondsUsed), secondsLimit: num(o.secondsLimit),
    bytesUsed: num(o.bytesUsed), bytesLimit: num(o.bytesLimit),
    recordings: num(o.recordings), maxRecordings: num(o.maxRecordings),
    maxSecondsPerRecording: num(o.maxSecondsPerRecording, MAX_SECONDS_PER_CALL), maxBytesPerRecording: num(o.maxBytesPerRecording),
    transcription: { secondsUsed: num(t.secondsUsed), secondsLimit: num(t.secondsLimit, num(o.secondsLimit)) },
  }
}

/** One of a fixed set of string values, else null. */
function oneOf<T extends string>(values: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (values as readonly string[]).includes(v) ? (v as T) : null
}

/** The `provider.transcribe` block of /hosted/status, read defensively; null when absent or not an object. */
export function parseProviderInfo(v: unknown): TranscribeProviderInfo | null {
  const block = typeof v === 'object' && v !== null ? (v as Record<string, unknown>).transcribe : null
  if (typeof block !== 'object' || block === null) return null
  const b = block as Record<string, unknown>
  return {
    provider: oneOf(Object.values(TranscribeProviderName), b.provider),
    region: oneOf(Object.values(InferenceRegion), b.region),
    dataPolicy: oneOf(Object.values(ProviderDataPolicy), b.dataPolicy),
  }
}

export function parseStatus(v: unknown): ServerStatus | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const hosted = o.hosted === true
  return {
    hosted, transcribe: hosted && o.transcribe === true, feedback: o.feedback === true, plan: hosted ? parseUsage(o.plan) : null,
    provider: parseProviderInfo(o.provider),
  }
}

/** The transcription answer, read defensively: segments with finite times and text only, in order. */
export function parseTranscript(v: unknown): TranscribeResult | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.text !== 'string') return null
  const segments = (Array.isArray(o.segments) ? o.segments : [])
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .filter((s) => typeof s.text === 'string' && Number.isFinite(s.start) && Number.isFinite(s.end))
    .map((s) => ({ start: Math.max(0, s.start as number), end: Math.max(0, s.end as number), text: (s.text as string).trim() }))
    .filter((s) => s.text)
    .sort((a, b) => a.start - b.start)
  return { text: o.text.trim(), segments, language: typeof o.language === 'string' ? o.language : null, secondsCharged: num(o.secondsCharged), approx: o.approx === true }
}

/** An error answer's code -> SwissError (unknown codes by status). */
export function errorFor(status: number, body: Record<string, unknown> | null, retryAfterS: number | null): SwissServerError {
  const code = typeof body?.error === 'string' ? body.error : ''
  const known: Record<string, SwissError> = {
    not_configured: SwissError.NotConfigured, allowance_reached: SwissError.AllowanceReached, busy: SwissError.Busy,
    busy_today: SwissError.BusyToday, ip_daily_limit: SwissError.BusyToday, rate_limited: SwissError.RateLimited,
    account_rate_limited: SwissError.RateLimited, forbidden_token: SwissError.Forbidden, forbidden_origin: SwissError.Forbidden,
    not_found: SwissError.NotFound, too_large: SwissError.TooLarge, unsupported_media: SwissError.Unsupported,
    storage_full: SwissError.StorageFull, provider_error: SwissError.Provider, provider_timeout: SwissError.Timeout,
    bad_request: SwissError.BadRequest, seconds_mismatch: SwissError.BadRequest,
  }
  const byStatus = (): SwissError => {
    switch (status) {
      case 402: return SwissError.AllowanceReached
      case 403: return SwissError.Forbidden
      case 404: return SwissError.NotFound
      case 408: return SwissError.Timeout
      case 413: return SwissError.TooLarge
      case 415: return SwissError.Unsupported
      case 429: return SwissError.RateLimited
      case 503: return SwissError.NotConfigured
      case 504: return SwissError.Timeout
      case 507: return SwissError.StorageFull
      default: return status >= 400 && status < 500 ? SwissError.BadRequest : SwissError.Server
    }
  }
  return new SwissServerError(known[code] ?? byStatus(), status, retryAfterS, body)
}

async function failure(res: Response): Promise<SwissServerError> {
  let body: Record<string, unknown> | null = null
  try {
    const v: unknown = await res.json()
    body = typeof v === 'object' && v !== null ? v as Record<string, unknown> : null
  } catch { /* no JSON body (408, 421) */ }
  const header = Number(res.headers.get('Retry-After'))
  const retry = Number.isFinite(header) && header > 0 ? header : num(body?.retryAfter, 0) || null
  return errorFor(res.status, body, retry)
}

/** fetch, with "could not reach it" and "our deadline passed" told apart from the server's own answers. */
async function call(f: FetchFn, url: string, init: RequestInit): Promise<Response> {
  try {
    return await f(url, init)
  } catch (e) {
    const name = (e as { name?: string } | null)?.name
    if (name === 'AbortError' || name === 'TimeoutError') throw new SwissServerError(SwissError.Timeout, 0)
    throw new SwissServerError(SwissError.Network, 0)
  }
}

const browserFetch: FetchFn = (input, init) => fetch(input, init)

/** What the server has switched on. null when it cannot be reached; a server without hosting reads as all off. */
export async function fetchStatus(f: FetchFn = browserFetch): Promise<ServerStatus | null> {
  let res: Response
  try {
    res = await f('/hosted/status', { cache: 'no-store' })
  } catch {
    return null
  }
  if (!res.ok) return res.status === 503 || res.status === 404 ? { hosted: false, transcribe: false, feedback: false, plan: null, provider: null } : null
  try {
    return parseStatus(await res.json())
  } catch {
    return null
  }
}

const recUrl = (a: HostedAccount, rid: string): string => `/hosted/${a.account}/rec/${rid}`

export async function fetchUsage(a: HostedAccount, f: FetchFn = browserFetch): Promise<Usage> {
  const res = await call(f, `/hosted/${a.account}/usage`, { headers: { 'X-Write-Token': a.token }, cache: 'no-store' })
  if (!res.ok) throw await failure(res)
  const u = parseUsage(await res.json().catch(() => null))
  if (!u) throw new SwissServerError(SwissError.Server, res.status)
  return u
}

export async function listRecordings(a: HostedAccount, f: FetchFn = browserFetch): Promise<HostedRecordingInfo[]> {
  const res = await call(f, `/hosted/${a.account}/recs`, { headers: { 'X-Write-Token': a.token }, cache: 'no-store' })
  if (!res.ok) throw await failure(res)
  const v: unknown = await res.json().catch(() => null)
  const list = typeof v === 'object' && v !== null && Array.isArray((v as { recordings?: unknown }).recordings) ? (v as { recordings: unknown[] }).recordings : []
  return list
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null && isRecordingId((r as Record<string, unknown>).id))
    .map((r) => ({ id: r.id as string, bytes: num(r.bytes), seconds: num(r.seconds), stored: typeof r.stored === 'string' ? r.stored : '' }))
}

/** Stores (or replaces) one sealed recording. `seconds` is its declared length, 1..3600. Returns the account's seconds used after it. */
export async function putRecording(a: HostedAccount, rid: string, seconds: number, sealed: Blob, f: FetchFn = browserFetch): Promise<number | null> {
  const res = await call(f, recUrl(a, rid), {
    method: 'PUT',
    headers: { 'X-Write-Token': a.token, 'X-Seconds': String(seconds), 'Content-Type': 'application/octet-stream' },
    body: sealed,
  })
  if (res.status !== 204) throw await failure(res)
  const used = Number(res.headers.get('X-Seconds-Used'))
  return Number.isFinite(used) && res.headers.get('X-Seconds-Used') !== null ? used : null
}

export async function getRecording(a: HostedAccount, rid: string, f: FetchFn = browserFetch): Promise<ArrayBuffer> {
  const res = await call(f, recUrl(a, rid), { headers: { 'X-Write-Token': a.token }, cache: 'no-store' })
  if (!res.ok) throw await failure(res)
  return res.arrayBuffer()
}

/** Removes one recording; one already gone counts as removed. */
export async function deleteRecording(a: HostedAccount, rid: string, f: FetchFn = browserFetch): Promise<void> {
  const res = await call(f, recUrl(a, rid), { method: 'DELETE', headers: { 'X-Write-Token': a.token } })
  if (res.status !== 204 && res.status !== 404) throw await failure(res)
}

/**
 * One transcription call. Never retried here: a job the provider accepted is
 * charged even when its answer is lost (contract v1.3), so the caller decides.
 * `signal` should carry the 15-minute deadline (TRANSCRIBE_TIMEOUT_MS).
 */
export async function transcribe(
  a: HostedAccount,
  audio: Blob,
  seconds: number,
  mimeType: string,
  signal: AbortSignal,
  f: FetchFn = browserFetch,
): Promise<TranscribeResult> {
  const res = await call(f, '/transcribe', {
    method: 'POST',
    headers: {
      'X-Account': a.account, 'X-Write-Token': a.token, 'X-Audio-Seconds': String(seconds),
      'Content-Type': mimeType.split(';')[0] || 'audio/webm',
    },
    body: audio,
    signal,
  })
  if (!res.ok) throw await failure(res)
  // The job ran (and was charged); an answer that does not arrive whole is a LOST answer, not a refusal (review-app-b).
  const t = parseTranscript(await res.json().catch(() => null))
  if (!t) throw new SwissServerError(SwissError.Timeout, res.status)
  return t
}

/** Declared seconds for a recording of `ms` (rounded up, at least 1). */
export function declaredSeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000))
}
