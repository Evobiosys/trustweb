// /websearch: web results from a real search API, through this server (services-api-contract: DEVLOG/trustweb-wave-1733/wave3/websearch-api-contract.txt).
//
//   GET  /websearch/engines                          which engines exist and are switched on
//   POST /websearch   {"q","engine"}                 (recommended: the words never sit in a URL)
//   GET  /websearch?q=...&engine=...                 same handler
//
// PRIVACY: the engine receives the query words, the operator's key and a fixed User-Agent. Never the person's IP (we are its client),
// cookies, Referer, Accept-Language or X-Forwarded-For. Nothing about the query or the results is stored, cached or logged: a log line
// carries the engine id and a status, never req.url, q or the upstream URL (which can hold the key). Counters are kept per network address in memory, not anonymous.
// MONEY: anyone can call this route, so the operator's key is protected by a per-client rate limit, a daily budget per engine,
// a bound on calls in flight, and a refusal of Sec-Fetch-Site: cross-site.
// SAFETY: engine output is untrusted: capped body, JSON only, results cleaned by websearch_clean.mjs (plain text, http(s) urls, caps).

import { jsonError, readSmallBody, sendJson, tooManyRequests } from './http_util.mjs'
import { createDailyMeter, createInFlight, createWindowLimiter, ipKey } from './limits.mjs'
import { cleanResults } from './websearch_clean.mjs'
import { ENGINES, EngineMode, engineById } from './websearch_engines.mjs'
import { readCredential } from './config.mjs'

export const MAX_QUERY_CHARS = 200
const MAX_POST_BYTES = 2048
const UPSTREAM_USER_AGENT = 'TrustWeb-websearch/1 (+https://idea2.site/trustweb/)'
const CONTROL_OR_FORMAT = /\p{C}/u

/** Upstream base URLs may be overridden (tests, staging) but must be https, or http to loopback: the key travels in them. */
function checkedBase(value, fallback) {
  try {
    const u = new URL(value)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
    return u.protocol === 'https:' || (u.protocol === 'http:' && loopback) ? u.href : fallback
  } catch {
    return fallback
  }
}

function envValue(envName, fallback, parse) {
  const raw = process.env[envName]
  return raw === undefined || raw === '' ? fallback : parse(raw)
}
const envNumber = (envName, fallback) => envValue(envName, fallback, Number)
const pick = (options, key, envName, fallback, parse = Number) => options[key] ?? envValue(envName, fallback, parse)

/**
 * Settings of the route. options (tests) win over env, env over defaults.
 *   WEBSEARCH_PER_MINUTE (6), WEBSEARCH_PER_HOUR (40), WEBSEARCH_PER_DAY (10)  per client (IPv4, IPv6 /64); the day count keeps one
 *                                                      client from spending an engine's whole daily budget for everyone
 *   WEBSEARCH_DAILY_<ID>                               calls per UTC day for one engine, e.g. WEBSEARCH_DAILY_BRAVE (default: the adapter's)
 *   WEBSEARCH_TIMEOUT_MS (8000), WEBSEARCH_MAX_BYTES (524288), WEBSEARCH_MAX_IN_FLIGHT (4)
 *   WEBSEARCH_BRAVE_URL, WEBSEARCH_MOJEEK_URL          upstream endpoints (https, or http to loopback)
 * Keys: systemd credentials websearch-brave, websearch-mojeek (JSON {"key": "..."}), or options.websearchKeys {id: key} in tests.
 */
export function loadWebsearchConfig(options = {}) {
  const keys = {}
  const dailyCaps = {}
  for (const e of ENGINES) {
    if (e.mode !== EngineMode.Api) continue
    keys[e.id] = options.websearchKeys?.[e.id] ?? readCredential(e.credential)
    dailyCaps[e.id] = options.websearchDailyCaps?.[e.id] ?? envNumber(`WEBSEARCH_DAILY_${e.id.toUpperCase()}`, e.dailyCap)
  }
  return {
    websearchKeys: keys,
    websearchDailyCaps: dailyCaps,
    websearchPerMinute: pick(options, 'websearchPerMinute', 'WEBSEARCH_PER_MINUTE', 6),
    websearchPerHour: pick(options, 'websearchPerHour', 'WEBSEARCH_PER_HOUR', 40),
    websearchPerDay: pick(options, 'websearchPerDay', 'WEBSEARCH_PER_DAY', 10),
    websearchTimeoutMs: pick(options, 'websearchTimeoutMs', 'WEBSEARCH_TIMEOUT_MS', 8000),
    websearchMaxBytes: pick(options, 'websearchMaxBytes', 'WEBSEARCH_MAX_BYTES', 524288),
    websearchMaxInFlight: pick(options, 'websearchMaxInFlight', 'WEBSEARCH_MAX_IN_FLIGHT', 4),
    websearchBraveUrl: checkedBase(pick(options, 'websearchBraveUrl', 'WEBSEARCH_BRAVE_URL', '', String), 'https://api.search.brave.com/res/v1/web/search'),
    websearchMojeekUrl: checkedBase(pick(options, 'websearchMojeekUrl', 'WEBSEARCH_MOJEEK_URL', '', String), 'https://www.mojeek.com/search'),
  }
}

/** The query as typed, trimmed, or null when it is not a 1..200 character string without control or format characters. */
export function validQuery(value) {
  if (typeof value !== 'string') return null
  const q = value.trim()
  const length = Array.from(q).length
  return length >= 1 && length <= MAX_QUERY_CHARS && !CONTROL_OR_FORMAT.test(q) ? q : null
}

/** {q, engine} from the query string (GET): each name at most once, nothing else read. Raw values (strings or null). */
function fromQueryString(url) {
  const params = new URL(url, 'http://x').searchParams
  const once = (name) => (params.getAll(name).length === 1 ? params.get(name) : null)
  return { q: once('q'), engine: once('engine') }
}

/** Reads {q, engine} of a POST: JSON object, Content-Type application/json, at most 2 KB. Returns {q, engine} or {field}. */
async function fromBody(req) {
  if (!/^application\/json(\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) return { field: 'body' }
  let body
  try {
    body = JSON.parse((await readSmallBody(req, MAX_POST_BYTES)).toString('utf8'))
  } catch {
    return { field: 'body' } // not JSON, or over the cap (CapExceeded)
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { field: 'body' }
  return { q: body.q, engine: body.engine }
}

/** Reads the whole upstream body up to maxBytes; null when it is bigger. */
async function readCapped(response, maxBytes) {
  const chunks = []
  let total = 0
  for await (const chunk of response.body ?? []) {
    total += chunk.length
    if (total > maxBytes) return null
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function createWebsearch({ cfg, clientOf, fetchImpl = globalThis.fetch, now = Date.now }) {
  const perMinute = createWindowLimiter({ limit: cfg.websearchPerMinute, windowMs: 60_000, now })
  const perHour = createWindowLimiter({ limit: cfg.websearchPerHour, windowMs: 3_600_000, now })
  const perClientDay = createDailyMeter({ limit: cfg.websearchPerDay, now })
  const meters = new Map(ENGINES.filter((e) => e.mode === EngineMode.Api).map((e) => [e.id, createDailyMeter({ limit: cfg.websearchDailyCaps[e.id], now })]))
  const inFlight = createInFlight({ total: cfg.websearchMaxInFlight, perKey: 2 })

  const configured = (engine) => engine.mode === EngineMode.Api && (cfg.websearchKeys[engine.id] ?? '') !== ''
  const fail = (res, status, error, message, fields = {}, headers = {}) => jsonError(res, status, error, { message, ...fields }, headers)

  function listEngines(res) {
    sendJson(res, 200, { engines: ENGINES.map((e) => ({ id: e.id, label: e.label, mode: e.mode, configured: configured(e) })) })
    return 200
  }

  /** The engine call. Resolves {results} or {status, error, message, retryAfter?}; never includes the query or the key. */
  async function callEngine(engine, q) {
    const { url, headers } = engine.request(q, cfg.websearchKeys[engine.id], cfg)
    let response
    try {
      response = await fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': UPSTREAM_USER_AGENT, ...headers },
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(cfg.websearchTimeoutMs),
      })
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
      return timedOut
        ? { status: 504, error: 'provider_timeout', message: 'The search engine took too long.' }
        : { status: 502, error: 'provider_error', message: 'The search engine could not be reached.' }
    }
    cfg.log?.(`websearch ${engine.id} upstream ${response.status}`)
    if (response.status === 429) return { status: 429, error: 'rate_limited', message: 'The search engine asked us to wait.', retryAfter: 60 }
    if (response.status !== 200) {
      response.body?.cancel?.().catch(() => undefined)
      return { status: 502, error: 'provider_error', message: 'The search engine answered with an error.' }
    }
    let json
    try {
      const text = await readCapped(response, cfg.websearchMaxBytes)
      json = text === null ? null : JSON.parse(text)
    } catch {
      json = null
    }
    const raw = json === null ? null : engine.parse(json)
    if (raw === null) return { status: 502, error: 'provider_error', message: 'The search engine answered in an unexpected form.' }
    return { results: cleanResults(raw) }
  }

  async function search(req, res, client) {
    const input = req.method === 'POST' ? await fromBody(req) : fromQueryString(req.url ?? '')
    if (input.field !== undefined) return fail(res, 400, 'bad_request', 'The body must be JSON {q, engine}, at most 2 KB.', { field: input.field })
    const engine = typeof input.engine === 'string' ? engineById(input.engine) : undefined
    if (engine === undefined || engine.mode !== EngineMode.Api) return fail(res, 400, 'bad_request', 'Unknown or link-only engine.', { field: 'engine' })
    const q = validQuery(input.q)
    if (q === null) return fail(res, 400, 'bad_request', 'The query must be 1 to 200 characters without control characters.', { field: 'q' })
    if (!configured(engine)) return fail(res, 503, 'not_configured', 'This engine has no key on this server.', { engine: engine.id })

    const key = ipKey(client)
    const minute = perMinute.hit(key)
    const hour = perHour.hit(key)
    if (minute.limited || hour.limited) return tooManyRequests(res, 'rate_limited', Math.max(minute.retryAfter, hour.retryAfter))
    if (!perClientDay.fits(key, 1)) return tooManyRequests(res, 'rate_limited', perClientDay.secondsToReset())
    const meter = meters.get(engine.id)
    if (!meter.fits(null, 1)) {
      return fail(res, 429, 'engine_daily_cap', 'The daily budget of this engine is spent.', { retryAfter: meter.secondsToReset(), engine: engine.id }, { 'Retry-After': String(meter.secondsToReset()) })
    }
    const release = inFlight.tryAcquire(key)
    if (release === null) return fail(res, 503, 'busy', 'Too many searches at once.', {}, { 'Retry-After': '2' })
    meter.add(null, 1)
    perClientDay.add(key, 1)
    let outcome
    try {
      outcome = await callEngine(engine, q)
    } finally {
      release()
    }
    if (outcome.results === undefined) {
      if (outcome.retryAfter !== undefined) return tooManyRequests(res, outcome.error, outcome.retryAfter)
      return fail(res, outcome.status, outcome.error, outcome.message)
    }
    sendJson(res, 200, { engine: engine.id, label: engine.label, results: outcome.results, untrusted: true })
    return 200
  }

  return {
    /** pathname is /websearch or /websearch/engines. Returns the status it answered. */
    async handle(req, res, pathname) {
      const isEngines = pathname === '/websearch/engines'
      const allowed = isEngines ? ['GET'] : ['GET', 'POST']
      if (!allowed.includes(req.method)) return jsonError(res, 405, 'method_not_allowed', {}, { Allow: allowed.join(', ') })
      if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return jsonError(res, 403, 'forbidden_origin')
      if (isEngines) return listEngines(res)
      return search(req, res, clientOf(req))
    },
  }
}
