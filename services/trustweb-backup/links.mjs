// Short connect links (wave 5; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, "Short links").
//
//   POST /link   {"url": "<long connect url>"}  ->  201 {"id", "expires_at"}   (200 with the same body when the url is already stored)
//   GET  /l/<id>                                ->  302 Location: <the stored url, fragment included>;  unknown, expired or malformed id: 404
//
// The long url is the connect link the QR already carries (https://app.<host>/?connect=did...&id=...&name=...#t=...). It is a
// capability that is shared openly, so nothing here encrypts it; TLS is the only protection in transit, and the id is as hard to
// guess as a 10 character [A-Za-z0-9] token (about 59.5 bits).
//
// OPEN REDIRECT: a url is stored only when, after WHATWG parsing, it is https, its host is exactly one of cfg.linkHosts, it has no
// port and no userinfo, and it has a non-empty `connect` query parameter. The PARSED form (href) is what is stored and what
// Location carries, so what was validated is what the browser gets (no CR/LF, no tab, no backslash tricks). The same check runs
// again on every GET.
//
// LOGGING: none. No logger is passed to this module, it never touches stdout/stderr, and server.mjs does not log these routes
// (test/links.test.mjs scans the source and captures the process output). A failure answers 500 server_error without a message.
//
// ABUSE: POST is limited per network address (IPv4 as it is, IPv6 by /64; counters in memory, so "per address", not anonymous),
// capped at cfg.linkMaxBytes (2 KB), JSON only, own-host Origin only, never cross-site. The store holds at most cfg.linkMax links.

import { CapExceeded, jsonError, readSmallBody, refuse, sendJson, tooManyRequests } from './http_util.mjs'
import { createWindowLimiter, ipKey } from './limits.mjs'
import { ID_RE } from './link_store.mjs'

const NOT_FOUND_PAGE =
  '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  '<title>Link not available</title><p style="font:16px system-ui;margin:2em">This link is not available.</p></html>'

/**
 * The normalized url (WHATWG href) when `raw` is an acceptable connect link for one of `hosts`, else null.
 * Rejects: other schemes, other hosts (also lookalikes such as app.idea2.site.evil.com), ports, userinfo, a missing or empty
 * `connect` parameter, a hand-over link (it carries a private key), and anything over `maxChars`.
 */
export function validLongUrl(raw, hosts, maxChars = 2048) {
  if (typeof raw !== 'string' || raw === '' || raw.length > maxChars) return null
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '') return null
  if (!hosts.includes(u.hostname)) return null
  if ((u.searchParams.get('connect') ?? '') === '') return null
  if (carriesPrivateKey(u)) return null
  return u.href.length <= maxChars ? u.href : null
}

/**
 * A hand-over link (?handover=1#k=<recovery key>&...) moves a demo account to another phone and carries its private key in the fragment.
 * It is not a connect link and must never be stored on a server, even when a client adds a `connect` parameter to it.
 */
function carriesPrivateKey(u) {
  return u.searchParams.has('handover') || new URLSearchParams(u.hash.replace(/^#/, '')).has('k')
}

/** Is `origin` (the Origin header) one of the app hosts? Anything unparsable, including the string "null", is not. */
export function originAllowed(origin, hosts) {
  try {
    const u = new URL(origin)
    return u.protocol === 'https:' && u.port === '' && hosts.includes(u.hostname)
  } catch {
    return false
  }
}

export function notFoundPage(res) {
  res.writeHead(404, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  })
  res.end(NOT_FOUND_PAGE)
  return 404
}

/** Reads a JSON object from a body of at most `maxBytes`. Returns {body} or {status, error} (the 413 is answered by the caller). */
export async function readJsonObject(req, maxBytes) {
  let body
  try {
    body = JSON.parse((await readSmallBody(req, maxBytes)).toString('utf8'))
  } catch (err) {
    return err instanceof CapExceeded ? { status: 413, error: 'too_large' } : { status: 400, error: 'bad_request' }
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { status: 400, error: 'bad_request' }
  return { body }
}

/** Reads {url} from a JSON body of at most cfg.linkMaxBytes. Returns {url} or {status, error} (the 413 is answered by the caller). */
async function readUrl(req, maxBytes) {
  const read = await readJsonObject(req, maxBytes)
  return read.body === undefined ? read : { url: read.body.url }
}

export function createLinks({ cfg, store, clientOf, now = Date.now }) {
  const perMinute = createWindowLimiter({ limit: cfg.linkPerMinute, windowMs: 60_000, now })
  const perHour = createWindowLimiter({ limit: cfg.linkPerHour, windowMs: 3_600_000, now })

  /** POST /link. Returns the status it answered. */
  async function create(req, res) {
    if (req.method !== 'POST') return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'POST' })
    if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return jsonError(res, 403, 'forbidden_origin')
    const origin = req.headers.origin
    if (origin !== undefined && !originAllowed(origin, cfg.linkHosts)) return jsonError(res, 403, 'forbidden_origin')
    const key = ipKey(clientOf(req))
    const minute = perMinute.hit(key)
    const hour = perHour.hit(key)
    if (minute.limited || hour.limited) return tooManyRequests(res, 'rate_limited', Math.max(minute.retryAfter, hour.retryAfter))
    if (!/^application\/json(\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) return refuse(req, res, 415, 'unsupported_media')
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > cfg.linkMaxBytes) return refuse(req, res, 413, 'too_large')
    const input = await readUrl(req, cfg.linkMaxBytes)
    if (input.error === 'too_large') return refuse(req, res, 413, 'too_large')
    if (input.error !== undefined) return jsonError(res, input.status, input.error)
    const url = validLongUrl(input.url, cfg.linkHosts, cfg.linkMaxBytes)
    if (url === null) return jsonError(res, 400, 'bad_request', { field: 'url' })
    let stored
    try {
      stored = await store.add(url)
    } catch {
      return jsonError(res, 500, 'server_error')
    }
    if (stored.kind === 'full') return jsonError(res, 507, 'storage_full')
    sendJson(res, stored.kind === 'created' ? 201 : 200, { id: stored.id, expires_at: stored.expires_at })
    return stored.kind === 'created' ? 201 : 200
  }

  /** GET|HEAD /l/<id>. pathname is the request path without its query. Returns the status it answered. */
  function open(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('method not allowed')
      return 405
    }
    const id = pathname.slice('/l/'.length)
    if (!ID_RE.test(id)) return notFoundPage(res)
    const stored = store.get(id)
    if (stored === null) return notFoundPage(res)
    const url = validLongUrl(stored, cfg.linkHosts, cfg.linkMaxBytes)
    if (url === null) {
      store.drop(id)
      return notFoundPage(res)
    }
    res.writeHead(302, {
      Location: url,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    })
    res.end()
    return 302
  }

  return { create, open }
}
