// Connect codes and usernames (wave 6b; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 10).
//
//   POST /connect {url, code?, secret?}   mint (201 {code, secret, url}) or update (200 {code, url}) the long connect url stored under a stable code
//   POST /connect {code, secret, rotate:true}   unlink: a NEW secret for the code (200 {code, secret, url}), the old one is dead (wave 15)
//   GET  /c/<code>                        302 to the stored (re-validated) url
//   POST /name {code, secret, name?, alias?, release?}   claim a primary name or an alias, release one, or (nothing else given) READ the names (wave 6e)
//   POST /name {code, secret, move, from:{code, secret}, as?}   MOVE a name between two codes of one account (wave 15, devices; both secrets, 400 when code === from)
//   GET  /who/<name>                      302 to https://<same app host>/c/<code>   (the primary name or an alias)
//
// OPEN REDIRECT: /c/ redirects ONLY to a url that passes validLongUrl (https, one of cfg.linkHosts exactly, no port or userinfo, a connect
// parameter) on this very request, so a tampered store file gives 404. /who/ redirects ONLY to https://<request Host, exactly one of
// cfg.linkHosts>/c/<22 characters of the code regex> and only when that code's url passes the same check. Both are rebuilt from validated parts.
//
// THE APP'S OWN LOOKUP (review 6b): the app resolves a typed code or @name with a same-origin fetch that follows the redirects. When the code
// was made on ANOTHER app host, the stored url leaves the page's origin and the browser turns the last hop into a network error (no CORS on
// app pages). So a request the browser marks as a same-origin, non-navigation fetch (Sec-Fetch-Site: same-origin, Sec-Fetch-Mode not
// "navigate") gets the same connect link on the REQUEST host (its app path, the stored query and fragment), re-validated like any other.
// The app hosts share one relay, so the link works from there. A navigation (a scanned QR, a tapped link) keeps the stored url unchanged:
// it lands on the host the sharer chose. A request without the headers (old browsers, curl) also keeps it.
//
// NO ORACLE: an unknown or expired code and a wrong secret answer with the same 403 (store.update and store.setName hash and compare either way).
//
// LOGGING: none. No logger is passed to this module, it never touches stdout/stderr, and server.mjs does not log these routes
// (test/connect.test.mjs scans the source and captures the process output). A failure answers 500 server_error without a message.
//
// ABUSE: GET /who/<name> also has a per-name budget (cfg.whoPerNamePerMinute, all addresses together) so one name cannot be burned from many addresses;
// every /c/ and /who/ answer carries X-Robots-Tag: noindex, nofollow. POST /connect and POST /name share one per-address budget (IPv4 as it is, IPv6 by /64, in memory); GET /c/ and GET /who/ share a more
// generous one and answer a plain-text 429. Bodies are capped at cfg.connectMaxBytes, JSON only, own-host Origin only, never cross-site.

import { CODE_RE, isNameShape, squash } from './connect_names.mjs'
import { newSecret, SECRET_RE } from './connect_store.mjs'
import { jsonError, refuse, sendJson, tooManyRequests } from './http_util.mjs'
import { createWindowLimiter, ipKey } from './limits.mjs'
import { capFor } from './name_cap.mjs'
import { notFoundPage, originAllowed, readJsonObject, validLongUrl } from './links.mjs'

/** What a store refusal answers on POST /name: [status, error]. The `field` is always "name". */
const NAME_REFUSALS = Object.freeze({
  locked: [409, 'name_locked'],
  reserved: [409, 'reserved'],
  taken: [409, 'name_taken'],
  too_many: [409, 'too_many_names'],
  not_held: [409, 'not_held'],
  alias_cap: [409, 'alias_cap'],
  moved_lately: [409, 'name_moved'],
})

/**
 * The ONE intent of a POST /name body (wave 6e, contract 10.9.2), judged on shape alone:
 * {intent: 'claim', name, alias} | {intent: 'move', name, from: {code, secret}, as} | {intent: 'release', name} (name null = the legacy {"name": ""}: the primary) | {intent: 'read'} | {field} (a 400 naming the field).
 */
export function nameIntent(body) {
  const { name, alias, release, move, from, as } = body
  if (move !== undefined) {
    if (name !== undefined || alias !== undefined || release !== undefined || !isNameShape(move)) return { field: 'move' }
    const fromOk = from !== null && typeof from === 'object' && typeof from.code === 'string' && CODE_RE.test(from.code) && typeof from.secret === 'string' && SECRET_RE.test(from.secret)
    if (!fromOk) return { field: 'from' }
    if (as !== undefined && as !== 'primary' && as !== 'alias') return { field: 'as' }
    return { intent: 'move', name: move, from: { code: from.code, secret: from.secret }, as }
  }
  if (alias !== undefined && typeof alias !== 'boolean') return { field: 'alias' }
  if (release !== undefined) {
    if (name !== undefined) return { field: 'release' }
    if (alias !== undefined) return { field: 'alias' }
    return isNameShape(release) ? { intent: 'release', name: release } : { field: 'release' }
  }
  if (name === undefined) return alias === undefined ? { intent: 'read' } : { field: 'alias' }
  if (name === '') return alias === true ? { field: 'alias' } : { intent: 'release', name: null }
  return isNameShape(name) ? { intent: 'claim', name, alias: alias === true } : { field: 'name' }
}

const NOINDEX = 'noindex, nofollow'
const PORT_SUFFIX = /:\d+$/
/** Where the app lives on each app host: under /trustweb/ on app.idea2.site (scripts/deploy_wot.sh), at the root everywhere else. */
const APP_PATHS = new Map([['app.idea2.site', '/trustweb/']])
const appPathOf = (host) => APP_PATHS.get(host) ?? '/'

/** Is this request the app's own fetch from one of its pages (not a navigation)? Only the browser's fetch-metadata headers decide. */
export function isSameOriginFetch(req) {
  const site = String(req.headers['sec-fetch-site'] ?? '').toLowerCase()
  const mode = String(req.headers['sec-fetch-mode'] ?? '').toLowerCase()
  return site === 'same-origin' && mode !== '' && mode !== 'navigate'
}

/** `url` (already validated) moved onto `host` with the app path of that host, query and fragment kept; `url` itself when it is on `host`. */
export function onHost(url, host) {
  const u = new URL(url)
  return u.hostname === host ? url : `https://${host}${appPathOf(host)}${u.search}${u.hash}`
}

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

/** `url` with prev=1 in its query when `prev` (the name had another holder lately: the app shows a dismissible note); the fragment is kept; `url` itself if that fails. */
export function withPrev(url, prev) {
  if (!prev) return url
  const u = new URL(url)
  u.searchParams.set('prev', '1')
  return u.toString()
}

export function createConnect({ cfg, store, clientOf, now = Date.now, nameCapAllow = { list: () => [] } }) {
  const writeMinute = createWindowLimiter({ limit: cfg.connectPerMinute, windowMs: 60_000, now })
  const writeHour = createWindowLimiter({ limit: cfg.connectPerHour, windowMs: 3_600_000, now })
  const readMinute = createWindowLimiter({ limit: cfg.connectGetPerMinute, windowMs: 60_000, now })
  const readHour = createWindowLimiter({ limit: cfg.connectGetPerHour, windowMs: 3_600_000, now })
  const perName = createWindowLimiter({ limit: cfg.whoPerNamePerMinute, windowMs: 60_000, now })

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
  async function rotate(res, req, code, secret) {
    let result
    try {
      result = await store.rotate(code, secret)
    } catch {
      return jsonError(res, 500, 'server_error')
    }
    if (result.kind === 'forbidden') return jsonError(res, 403, 'forbidden')
    sendJson(res, 200, { code, secret: result.secret, url: shortUrl(req, code) })
    return 200
  }

  async function create(req, res) {
    const got = await receive(req, res)
    if (got.body === undefined) return got.status
    if (got.body.rotate !== undefined) {
      const { code, secret, rotate: wanted } = got.body
      if (wanted !== true) return jsonError(res, 400, 'bad_request', { field: 'rotate' })
      if (typeof code !== 'string' || !CODE_RE.test(code)) return jsonError(res, 400, 'bad_request', { field: 'code' })
      if (typeof secret !== 'string' || !SECRET_RE.test(secret)) return jsonError(res, 400, 'bad_request', { field: 'secret' })
      return rotate(res, req, code, secret)
    }
    const url = validLongUrl(got.body.url, cfg.linkHosts, cfg.connectMaxBytes)
    if (url === null) return jsonError(res, 400, 'bad_request', { field: 'url' })
    const { code, secret } = got.body
    const bad = badCredentialField(code, secret)
    if (bad !== null) return jsonError(res, 400, 'bad_request', { field: bad })
    return code === undefined ? mint(res, req, url) : replace(res, req, code, secret, url)
  }

  /** The store call of a POST /name intent. */
  function applyIntent(intent, code, secret, addr) {
    if (intent.intent === 'read') return store.read(code, secret)
    if (intent.intent === 'release') return store.release(code, secret, intent.name)
    if (intent.intent === 'move') return store.move(code, secret, intent)
    return store.claim(code, secret, { name: intent.name, alias: intent.alias, addr, cap: capFor(nameCapAllow.list(), addr, code, cfg.nameCap) })
  }

  /** POST /name: claim, release or read (contract 10.9.2). Returns the status it answered. */
  async function name(req, res) {
    const got = await receive(req, res)
    if (got.body === undefined) return got.status
    const { code, secret } = got.body
    const intent = nameIntent(got.body)
    if (intent.field !== undefined) return jsonError(res, 400, 'bad_request', { field: intent.field })
    if (typeof code !== 'string' || !CODE_RE.test(code)) return jsonError(res, 400, 'bad_request', { field: 'code' })
    if (typeof secret !== 'string' || !SECRET_RE.test(secret)) return jsonError(res, 400, 'bad_request', { field: 'secret' })
    if (intent.intent === 'move' && intent.from.code === code) return jsonError(res, 400, 'bad_request', { field: 'from' })
    let result
    try {
      result = await applyIntent(intent, code, secret, ipKey(clientOf(req)))
    } catch {
      return jsonError(res, 500, 'server_error')
    }
    if (result.kind === 'forbidden') return jsonError(res, 403, 'forbidden')
    if (result.kind === 'name_cap') return jsonError(res, 429, 'name-cap', { until: result.until, field: 'name' })
    if (result.kind !== 'named') {
      const [status, error] = NAME_REFUSALS[result.kind]
      return jsonError(res, status, error, { field: 'name', ...(result.until === undefined ? {} : { until: result.until }) })
    }
    sendJson(res, 200, { name: result.name, aliases: result.aliases, locked: result.locked })
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

  /** Where /c/ sends this request: the stored url, or for the app's own same-origin fetch the same link on the request host (see the head). */
  function landingFor(req, url) {
    const host = appHostOf(req, cfg.linkHosts)
    if (host === null || !isSameOriginFetch(req)) return url
    return validLongUrl(onHost(url, host), cfg.linkHosts, cfg.connectMaxBytes) ?? url
  }

  /** GET|HEAD /c/<code>. pathname is the request path without its query. Returns the status it answered. */
  function open(req, res, pathname) {
    res.setHeader('X-Robots-Tag', NOINDEX)
    const gated = readGate(req, res)
    if (gated !== null) return gated
    const url = checkedUrl(pathname.slice('/c/'.length), { touch: true })
    return url === null ? notFoundPage(res) : redirect(res, withPrev(landingFor(req, url), store.hadPreviousHolder(pathname.slice('/c/'.length))))
  }

  /** GET|HEAD /who/<name>. Returns the status it answered. */
  function who(req, res, pathname) {
    res.setHeader('X-Robots-Tag', NOINDEX)
    const gated = readGate(req, res)
    if (gated !== null) return gated
    const host = appHostOf(req, cfg.linkHosts)
    const wanted = pathname.slice('/who/'.length)
    if (host === null || !isNameShape(wanted)) return notFoundPage(res)
    const burst = perName.hit(squash(wanted))
    if (burst.limited) return slowDownText(res, burst.retryAfter)
    const code = store.codeOf(wanted)
    if (code === null || checkedUrl(code, { touch: false }) === null) return notFoundPage(res)
    return redirect(res, `https://${host}/c/${code}`)
  }

  return { create, name, open, who }
}
