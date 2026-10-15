// The admin routes of the usernames (wave 6e; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 10.9.3).
//
//   POST   /admin/name   {code, name, alias?}   grant a name to an existing code (reserved names allowed)
//   DELETE /admin/name   {code, name}           remove a name from a code (a locked one too)
//   GET    /admin/names                         who holds the env RESERVED_NAMES
//   POST   /admin/org    {org, plan}            wave 8: switch an organizer to plan "free" or "hosted" (the paid tier; money changes hands outside the server)
//
// These routes are for the operator, on this machine only, and are NEVER in Caddy. The guard has five steps:
//   1 the socket peer is loopback;   2 the Host header is exactly 127.0.0.1 / localhost (with or without the bound port), never a public app host
//   (Caddy forwards those from loopback too, so step 1 alone is no guard);   3 no Forwarded, X-Forwarded-*, X-Real-IP or Origin header;
//   4 an admin token is configured (else 503 not_configured);   5 X-Admin-Token equals it (sha256 digests, crypto.timingSafeEqual; else 401).
// Steps 1 to 3 are `permits`, asked by server.mjs BEFORE its Host gate (production ALLOWED_HOSTS has no 127.0.0.1); a request that fails them is
// not answered here at all, it falls through to the unchanged pipeline and so looks like any unknown path. Steps 4 and 5 are `handle`.
//
// LOGGING: none here (server.mjs writes the single line "admin grant" after a successful change). The token, codes and names never reach a log.

import crypto from 'node:crypto'
import { CODE_RE, isNameShape, squash } from './connect_names.mjs'
import { jsonError, refuse, sendJson, tooManyRequests } from './http_util.mjs'
import { ipKey } from './limits.mjs'
import { readJsonObject } from './links.mjs'
import { limitsFor, PLANS } from './organizer_store.mjs'

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const FAILED_TOKENS_PER_MINUTE = 5
const MINUTE_MS = 60_000

/** Is `pathname` one of the admin routes? (exact, no trailing slash) */
export const isAdminPath = (pathname) => pathname === '/admin/name' || pathname === '/admin/names' || pathname === '/admin/org'

/** Does this header name betray a proxy hop or a browser? (Forwarded, X-Forwarded-*, X-Real-IP, Origin) */
const isProxyOrBrowserHeader = (header) => header === 'forwarded' || header === 'x-real-ip' || header === 'origin' || header.startsWith('x-forwarded-')

/** Guard steps 1 to 3: loopback peer, a loopback Host naming this very port, no proxy or browser headers. `port` = the port the server bound. */
export function permits(req, port) {
  if (!LOOPBACK.has(req.socket?.remoteAddress ?? '')) return false
  const host = req.headers.host
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return false
  return !Object.keys(req.headers).some(isProxyOrBrowserHeader)
}

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest()

/** Does the presented header value equal the configured token? Equal-length digests, constant time; a missing header is compared as "". */
export function tokenMatches(presented, token) {
  return crypto.timingSafeEqual(sha256(typeof presented === 'string' ? presented : ''), sha256(token))
}

/** Counts failed token attempts per key in a sliding minute; `retryAfter(key)` is the seconds to wait once the limit is reached, else 0. */
function createFailureGate({ limit, now }) {
  const failures = new Map()
  const recent = (key, t) => (failures.get(key) ?? []).filter((x) => t - x < MINUTE_MS)
  return {
    retryAfter(key) {
      const t = now()
      const list = recent(key, t)
      return list.length >= limit ? Math.ceil((list[0] + MINUTE_MS - t) / 1000) : 0
    },
    record(key) {
      const t = now()
      failures.set(key, [...recent(key, t), t])
      if (failures.size > 1000) failures.clear()
    },
  }
}

export function createAdmin({ cfg, store, orgStore = null, clientOf, now = Date.now }) {
  const gate = createFailureGate({ limit: FAILED_TOKENS_PER_MINUTE, now })

  const bodyOf = (result) => ({ name: result.name, aliases: result.aliases, locked: result.locked })

  /** The status an admin store result answers with (a `named` result is answered by the caller). */
  function refusal(res, result) {
    if (result.kind === 'unknown') return jsonError(res, 404, 'unknown_code')
    if (result.kind === 'not_held') return jsonError(res, 404, 'not_held')
    if (result.kind === 'taken') return jsonError(res, 409, 'name_taken', { field: 'name' })
    return jsonError(res, 409, 'too_many_names', { field: 'name' })
  }

  /** The JSON body of POST / DELETE /admin/name once the token passed, or {status} when already answered. */
  async function receive(req, res) {
    if (!/^application\/json(\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) return { status: refuse(req, res, 415, 'unsupported_media') }
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > cfg.connectMaxBytes) return { status: refuse(req, res, 413, 'too_large') }
    const read = await readJsonObject(req, cfg.connectMaxBytes)
    if (read.error === 'too_large') return { status: refuse(req, res, 413, 'too_large') }
    if (read.error !== undefined) return { status: jsonError(res, read.status, read.error) }
    return { body: read.body }
  }

  async function changeName(req, res) {
    const got = await receive(req, res)
    if (got.body === undefined) return got.status
    const { code, name, alias } = got.body
    if (typeof code !== 'string' || !CODE_RE.test(code)) return jsonError(res, 400, 'bad_request', { field: 'code' })
    if (typeof name !== 'string' || !isNameShape(name)) return jsonError(res, 400, 'bad_request', { field: 'name' })
    if (alias !== undefined && typeof alias !== 'boolean') return jsonError(res, 400, 'bad_request', { field: 'alias' })
    let result
    try {
      result = req.method === 'POST' ? await store.grant(code, name, alias === true) : await store.remove(code, name)
    } catch {
      return jsonError(res, 500, 'server_error')
    }
    if (result.kind !== 'named') return refusal(res, result)
    sendJson(res, 200, bodyOf(result))
    return 200
  }

  async function changePlan(req, res) {
    const got = await receive(req, res)
    if (got.body === undefined) return got.status
    const { org, plan } = got.body
    if (typeof org !== 'string' || !CODE_RE.test(org)) return jsonError(res, 400, 'bad_request', { field: 'org' })
    if (!PLANS.includes(plan)) return jsonError(res, 400, 'bad_request', { field: 'plan' })
    let result
    try {
      result = await orgStore.setPlan(org, plan)
    } catch {
      return jsonError(res, 500, 'server_error')
    }
    if (result.kind !== 'ok') return jsonError(res, 404, 'unknown_org')
    sendJson(res, 200, { org, plan, limits: limitsFor(cfg, plan) })
    return 200
  }

  /** One row per env reserved name with the code that holds it (null: nobody), plus any held name that only matches after squashing (contract C8). */
  function reservedRows() {
    const rows = []
    for (const entry of cfg.reservedNames) {
      if (!rows.some((r) => r.name === entry)) rows.push({ name: entry, code: store.codeOf(entry) })
      const key = squash(entry)
      for (const held of store.holders((n) => squash(n) === key)) if (!rows.some((r) => r.name === held.name)) rows.push(held)
    }
    return rows
  }

  /** Guard steps 4 and 5, then the route. `permits` must have said yes. Returns the status it answered. */
  async function handle(req, res, pathname) {
    if ((pathname === '/admin/org' ? orgStore : store) === null || cfg.adminToken === '') return jsonError(res, 503, 'not_configured')
    const key = ipKey(clientOf(req))
    const wait = gate.retryAfter(key)
    if (wait > 0) return tooManyRequests(res, 'rate_limited', wait)
    if (!tokenMatches(req.headers['x-admin-token'], cfg.adminToken)) {
      gate.record(key)
      return jsonError(res, 401, 'unauthorized')
    }
    if (pathname === '/admin/names') {
      if (req.method !== 'GET') return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'GET' })
      sendJson(res, 200, { reserved: reservedRows() })
      return 200
    }
    if (pathname === '/admin/org') return req.method === 'POST' ? changePlan(req, res) : jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'POST' })
    if (req.method !== 'POST' && req.method !== 'DELETE') return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'POST, DELETE' })
    return changeName(req, res)
  }

  return { handle }
}
