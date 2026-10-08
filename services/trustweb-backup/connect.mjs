// Connect codes and usernames (wave 6b; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 10).
//
//   POST /connect {url, code?, secret?}   mint (201 {code, secret, url}) or update (200 {code, url}) the long connect url stored under a stable code
//   GET  /c/<code>                        302 to the stored (re-validated) url
//   POST /name {name, code, secret}       claim a username for the code ("" releases)
//   GET  /who/<name>                      302 to https://<same app host>/c/<code>
//
// OPEN REDIRECT: /c/ redirects ONLY to a url that passes validLongUrl (https, one of cfg.linkHosts exactly, no port or userinfo, a connect
// parameter) on this very request, so a tampered store file gives 404. /who/ redirects ONLY to https://<request Host, exactly one of
// cfg.linkHosts>/c/<22 characters of the code regex> and only when that code's url passes the same check. Both are rebuilt from validated parts.
//
// NO ORACLE: an unknown or expired code and a wrong secret answer with the same 403 (store.update and store.setName hash and compare either way).
//
// LOGGING: none. No logger is passed to this module, it never touches stdout/stderr, and server.mjs does not log these routes
// (test/connect.test.mjs scans the source and captures the process output). A failure answers 500 server_error without a message.
//
// ABUSE: POST /connect and POST /name share one per-address budget (IPv4 as it is, IPv6 by /64, in memory); GET /c/ and GET /who/ share a more
// generous one and answer a plain-text 429. Bodies are capped at cfg.connectMaxBytes, JSON only, own-host Origin only, never cross-site.

import { CODE_RE, isClaimableName, isNameShape } from './connect_names.mjs'
import { newSecret, SECRET_RE } from './connect_store.mjs'
import { jsonError, refuse, sendJson, tooManyRequests } from './http_util.mjs'
import { createWindowLimiter, ipKey } from './limits.mjs'
import { notFoundPage, originAllowed, readJsonObject, validLongUrl } from './links.mjs'

const PORT_SUFFIX = /:\d+$/

/** The request Host when it is exactly one of `hosts` (a port is dropped), else null. */
export function appHostOf(req, hosts) {
  const raw = req.headers.host
  if (typeof raw !== 'string') return null
  const host = raw.trim().toLowerCase().replace(PORT_SUFFIX, '')
  return hosts.includes(host) ? host : null
}

function methodNotAllowedText(res) {
  res.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('method not allowed')
  return 405
}

function slowDownText(res, retryAfterSeconds) {
  res.writeHead(429, { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))), 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('slow down')
  return 429
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end()
  return 302
}

export function createConnect({ cfg, store, clientOf, now = Date.now }) {
  const writeMinute = createWindowLimiter({ limit: cfg.connectPerMinute, windowMs: 60_000, now })
  const writeHour = createWindowLimiter({ limit: cfg.connectPerHour, windowMs: 3_600_000, now })
  const readMinute = createWindowLimiter({ limit: cfg.connectGetPerMinute, windowMs: 60_000, now })
  const readHour = createWindowLimiter({ limit: cfg.connectGetPerHour, windowMs: 3_600_000, now })

  /** The short link the answers carry (informational: the client builds its own from location.origin). */
  const shortUrl = (req, code) => `https://${appHostOf(req, cfg.linkHosts) ?? cfg.linkHosts[0]}/c/${code}`

  /**
   * Everything both POST routes check before they look at the fields. Returns {body} or {status} (already answered).
   * The limiter counts before the content is looked at, so invalid posts count too.
   */
  async function receive(req, res, method = 'POST') {
    if (req.method !== method) return { status: jsonError(res, 405, 'method_not_allowed', {}, { Allow: method }) }
    if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return { status: jsonError(res, 403, 'forbidden_origin') }
    const origin = req.headers.origin
    if (origin !== undefined && !originAllowed(origin, cfg.linkHosts)) return { status: jsonError(res, 403, 'forbidden_origin') }
    const key = ipKey(clientOf(req))
    const minute = writeMinute.hit(key)
    const hour = writeHour.hit(key)
    if (minute.limited || hour.limited) return { status: tooManyRequests(res, 'rate_limited', Math.max(minute.retryAfter, hour.retryAfter)) }
    if (!/^application\/json(\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) return { status: refuse(req, res, 415, 'unsupported_media') }
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > cfg.connectMaxBytes) return { status: refuse(req, res, 413, 'too_large') }
    const read = await readJsonObject(req, cfg.connectMaxBytes)
    if (read.error === 'too_large') return { status: refuse(req, res, 413, 'too_large') }
    if (read.error !== undefined) return { status: jsonError(res, read.status, read.error) }
    return { body: read.body }
  }

  /** The field (code or secret) that is of the wrong shape, or missing while the other is given; null when both are absent or both fine. */
  function badCredentialField(code, secret) {
    const codeOk = typeof code === 'string' && CODE_RE.test(code)
    const secretOk = typeof secret === 'string' && SECRET_RE.test(secret)
    if (code !== undefined && !codeOk) return 'code'
    if (secret !== undefined && !secretOk) return 'secret'
    if (code !== undefined && secret === undefined) return 'secret'
    if (secret !== undefined && code === undefined) return 'code'
    return null
  }

  async function mint(res, req, url) {
    const secret = newSecret()
    let made
    try {
      made = await store.mint(url, secret)
    } catch {
      return jsonError(res, 500, 'server_error')
    }
    if (made.kind === 'full') return jsonError(res, 507, 'storage_full')
    sendJson(res, 201, { code: made.code, secret, url: shortUrl(req, made.code) })
    return 201
  }

  async function replace(res, req, code, secret, url) {
    let result
    try {
      result = await store.update(code, secret, url)
    } catch {
      return jsonError(res, 500, 'server_error')
    }
    if (result.kind === 'forbidden') return jsonError(res, 403, 'forbidden')
    sendJson(res, 200, { code, url: shortUrl(req, code) })
    return 200
  }

  /** POST /connect. Returns the status it answered. */
  async function create(req, res) {
    const got = await receive(req, res)
    if (got.body === undefined) return got.status
    const url = validLongUrl(got.body.url, cfg.linkHosts, cfg.connectMaxBytes)
    if (url === null) return jsonError(res, 400, 'bad_request', { field: 'url' })
    const { code, secret } = got.body
    const bad = badCredentialField(code, secret)
    if (bad !== null) return jsonError(res, 400, 'bad_request', { field: bad })
    return code === undefined ? mint(res, req, url) : replace(res, req, code, secret, url)
  }

  /** POST /name. Returns the status it answered. */
  async function name(req, res) {
    const got = await receive(req, res)
    if (got.body === undefined) return got.status
    const { name: wanted, code, secret } = got.body
    if (typeof wanted !== 'string' || (wanted !== '' && !isClaimableName(wanted))) return jsonError(res, 400, 'bad_request', { field: 'name' })
    if (typeof code !== 'string' || !CODE_RE.test(code)) return jsonError(res, 400, 'bad_request', { field: 'code' })
    if (typeof secret !== 'string' || !SECRET_RE.test(secret)) return jsonError(res, 400, 'bad_request', { field: 'secret' })
    let result
    try {
      result = await store.setName(code, secret, wanted)
    } catch {
      return jsonError(res, 500, 'server_error')
    }
    if (result.kind === 'forbidden') return jsonError(res, 403, 'forbidden')
    if (result.kind === 'taken') return jsonError(res, 409, 'name_taken', { field: 'name' })
    sendJson(res, 200, { name: wanted })
    return 200
  }

  /** GET|HEAD gate: method, then the shared read budget. Returns the status when it answered, else null. */
  function readGate(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowedText(res)
    const key = ipKey(clientOf(req))
    const minute = readMinute.hit(key)
    const hour = readHour.hit(key)
    return minute.limited || hour.limited ? slowDownText(res, Math.max(minute.retryAfter, hour.retryAfter)) : null
  }

  /**
   * The stored url of `code` when it passes validation now, else null. An invalid one (a tampered file, a changed host list) is NOT deleted: the
   * code keeps its place and its age, so a misconfigured host list can never erase people's permanent codes. The check comes before `open`
   * so that an entry that does not validate never has its last-use time refreshed.
   */
  function checkedUrl(code, { touch }) {
    if (!CODE_RE.test(code)) return null
    const url = validLongUrl(store.peek(code), cfg.linkHosts, cfg.connectMaxBytes)
    if (url !== null && touch) store.open(code)
    return url
  }

  /** GET|HEAD /c/<code>. pathname is the request path without its query. Returns the status it answered. */
  function open(req, res, pathname) {
    const gated = readGate(req, res)
    if (gated !== null) return gated
    const url = checkedUrl(pathname.slice('/c/'.length), { touch: true })
    return url === null ? notFoundPage(res) : redirect(res, url)
  }

  /** GET|HEAD /who/<name>. Returns the status it answered. */
  function who(req, res, pathname) {
    const gated = readGate(req, res)
    if (gated !== null) return gated
    const host = appHostOf(req, cfg.linkHosts)
    const wanted = pathname.slice('/who/'.length)
    if (host === null || !isNameShape(wanted)) return notFoundPage(res)
    const code = store.codeOf(wanted)
    if (code === null || checkedUrl(code, { touch: false }) === null) return notFoundPage(res)
    return redirect(res, `https://${host}/c/${code}`)
  }

  return { create, name, open, who }
}
