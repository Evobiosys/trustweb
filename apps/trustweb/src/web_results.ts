/**
 * Web results inside the app (wave 3, Jakob 2026-10-07: "for the web results,
 * let's test it in a one-shot"), coded against
 * DEVLOG/trustweb-wave-1733/wave3/websearch-api-contract.txt v1.0:
 *   GET  /websearch/engines                which engines may answer inside the app (no query, costs nothing)
 *   POST /websearch {"q","engine"}         the words in the body, never in a URL (contract section 1)
 * Same origin as /hosted, so no CORS and no Origin the server refuses.
 *
 * Everything that comes back is data from the open web: read defensively,
 * shown as text only, links http(s) only, never fetched, no favicons. Nothing
 * is requested before the person taps "Show results here" (the engine list
 * is our own server's, carries no words and costs nothing).
 *
 * DOM-free: the unit tests run the exact parsing and the request.
 */
import type { AppState } from './model'

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

/** An engine that answers inside the app: an official API and a key placed on our server. */
export interface WebEngine {
  id: string
  label: string
}

export interface WebResult {
  title: string
  url: string
  /** The url's host name, shown muted under the title (never fetched). */
  host: string
  snippet: string
}

/** What went wrong, as the app tells it apart (contract section 5, plus what can go wrong on the way). A fixed set. */
export enum WebSearchError {
  NotConfigured = 'not_configured',
  RateLimited = 'rate_limited',
  DailyCap = 'engine_daily_cap',
  Busy = 'busy',
  Provider = 'provider_error',
  Timeout = 'provider_timeout',
  BadRequest = 'bad_request',
  Forbidden = 'forbidden_origin',
  /** The server could not be reached, or answered something this build cannot read. */
  Network = 'network',
}

export type WebSearchOutcome =
  | { ok: true; engine: WebEngine; results: WebResult[] }
  | { ok: false; error: WebSearchError }

const ENGINE_ID = /^[a-z0-9_-]{1,32}$/
const MAX_LABEL = 40
const MAX_TITLE = 200
const MAX_SNIPPET = 400
const MAX_URL = 2000
const MAX_RESULTS = 10
/** The words as the query dock caps them (contract: 1..200 characters). */
export const MAX_WEB_QUERY = 200
/** The server waits 8 s for the engine; the app gives the whole call 15 s. */
const SEARCH_TIMEOUT_MS = 15_000
/** Engines remembered as said yes to (one per engine, a handful at most). */
const MAX_CONSENTS = 10

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

/** The words as they are sent: spaces collapsed, trimmed, capped; empty when there are none. */
export function webQuery(words: string): string {
  return words.replace(/\s+/g, ' ').trim().slice(0, MAX_WEB_QUERY)
}

/** The engines that answer inside the app (mode "api" and configured); link-only and unconfigured ones never show. */
export function parseEngines(v: unknown): WebEngine[] {
  const list = typeof v === 'object' && v !== null ? (v as { engines?: unknown }).engines : null
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: WebEngine[] = []
  for (const e of list) {
    if (typeof e !== 'object' || e === null) continue
    const o = e as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const label = str(o.label, MAX_LABEL)
    if (!ENGINE_ID.test(id) || !label || o.mode !== 'api' || o.configured !== true || seen.has(id)) continue
    seen.add(id)
    out.push({ id, label })
  }
  return out
}

/** One result, or null when it has no usable http(s) link. */
function parseResult(v: unknown): WebResult | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const raw = typeof o.url === 'string' && o.url.length <= MAX_URL ? o.url.trim() : ''
  let url: URL
  try { url = new URL(raw) } catch { return null }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null
  const title = str(o.title, MAX_TITLE) || url.hostname
  return { title, url: url.href, host: url.hostname, snippet: str(o.snippet, MAX_SNIPPET) }
}

/** The 200 answer, read defensively (unknown fields ignored, at most 10 results); null when it is not one. */
export function parseResults(v: unknown, asked: WebEngine): { engine: WebEngine; results: WebResult[] } | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.results)) return null
  const label = str(o.label, MAX_LABEL) || asked.label
  const results = o.results.map(parseResult).filter((r): r is WebResult => r !== null).slice(0, MAX_RESULTS)
  return { engine: { id: asked.id, label }, results }
}

const KNOWN: ReadonlySet<string> = new Set(Object.values(WebSearchError))

/** An error answer's code; by status when the body says nothing this build knows. */
export function errorOf(status: number, body: unknown): WebSearchError {
  const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null
  if (typeof code === 'string' && KNOWN.has(code)) return code as WebSearchError
  switch (status) {
    case 400: return WebSearchError.BadRequest
    case 403: return WebSearchError.Forbidden
    case 429: return WebSearchError.RateLimited
    case 502: return WebSearchError.Provider
    case 503: return WebSearchError.Busy
    case 504: return WebSearchError.Timeout
    default: return WebSearchError.Network
  }
}

const browserFetch: FetchFn = (input, init) => fetch(input, init)

/** Which engines answer inside the app; [] when the server has no such route (404, an older server) or cannot be read. */
export async function fetchEngines(f: FetchFn = browserFetch): Promise<WebEngine[]> {
  try {
    const res = await f('/websearch/engines', { cache: 'no-store', credentials: 'same-origin' })
    return res.ok ? parseEngines(await res.json()) : []
  } catch {
    return []
  }
}

/** One search, after the person's tap. Never retried by itself. */
export async function searchWeb(engine: WebEngine, words: string, f: FetchFn = browserFetch): Promise<WebSearchOutcome> {
  const q = webQuery(words)
  if (!q) return { ok: false, error: WebSearchError.BadRequest }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), SEARCH_TIMEOUT_MS)
  let res: Response
  try {
    res = await f('/websearch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ q, engine: engine.id }),
      cache: 'no-store', credentials: 'same-origin', referrerPolicy: 'no-referrer', signal: ctl.signal,
    })
  } catch (e) {
    const name = (e as { name?: string } | null)?.name
    return { ok: false, error: name === 'AbortError' ? WebSearchError.Timeout : WebSearchError.Network }
  } finally {
    clearTimeout(timer)
  }
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) return { ok: false, error: errorOf(res.status, body) }
  const parsed = parseResults(body, engine)
  return parsed ? { ok: true, ...parsed } : { ok: false, error: WebSearchError.Network }
}

/** The engines this phone said yes to (contract section 4: once per install, per engine); odd values read as none. */
export function webConsents(s: Pick<AppState, 'webSearchConsent'>): string[] {
  const v: unknown = s.webSearchConsent
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && ENGINE_ID.test(x)).slice(0, MAX_CONSENTS) : []
}

/** Remembers the yes for one engine (idempotent, capped). */
export function giveWebConsent(s: Pick<AppState, 'webSearchConsent'>, engineId: string): void {
  if (!ENGINE_ID.test(engineId)) return
  const have = webConsents(s)
  if (!have.includes(engineId)) s.webSearchConsent = [...have, engineId].slice(-MAX_CONSENTS)
}
