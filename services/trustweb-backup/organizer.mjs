// Organizer accounts (wave 8; contract: DEVLOG/trustweb-wave-1733/services-api-contract.txt, section 11).
//
//   POST /org        {name}                                  mint an organizer: 201 {org, secret, plan, limits}
//   POST /org/me     {org, secret}                           the organizer's own events and counters
//   POST /org/event  {org, secret, event, link, invitees, id?} create or update an event; {org, secret, id, delete: true} deletes it
//   POST /org/hit    {event, kind}                           204 always; counts opened | joined | tagged on a known event (the only route attendees touch)
//
// PRIVACY: the server holds what the organizer already has (event fields, invitee e-mails) plus aggregate counters, never an attendee's identity, web,
// tags or notes. /org/hit carries no identity and keeps no request data.
//
// NO ORACLE: an unknown org and a wrong secret answer with the same 403 (the store hashes and compares either way).
// LOGGING: none. No logger is passed to this module and server.mjs writes no "METHOD status" line for /org paths.
// ABUSE: per network address (IPv4 as it is, IPv6 by /64, in memory). Bodies are capped at 16 KB, JSON only, own-host Origin only, never cross-site.

import { CODE_RE } from './connect_names.mjs'
import { SECRET_RE, newSecret } from './connect_store.mjs'
import { jsonError, refuse, sendJson, tooManyRequests } from './http_util.mjs'
import { createWindowLimiter, ipKey } from './limits.mjs'
import { originAllowed, readJsonObject } from './links.mjs'
import { EVENT_ID_RE, KINDS, limitsFor } from './organizer_store.mjs'

const MAX_BYTES = 16 * 1024
const MAX_LINK_CHARS = 4096
const MAX_EMAIL_CHARS = 254
const MAX_THEMES = 20
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/
/** [field, max chars] of the required event fields (1 char minimum) and of the optional ones (0 = absent). */
const REQUIRED = [['name', 120], ['from', 200], ['where', 200]]
const OPTIONAL = [['to', 2000], ['conditions', 2000]]
const OPTIONAL_AFTER_THEMES = [['tagName', 60], ['organizer', 80]]

/** Is `pathname` one of the organizer routes? */
export const isOrgPath = (pathname) => pathname === '/org' || pathname.startsWith('/org/')

/** `v` trimmed when it is a string of min..max characters after trimming, else null. */
function text(v, min, max) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length >= min && t.length <= max ? t : null
}

/** The event fields of `raw` as {event} (known fields only, trimmed, empty optionals left out) or {field} naming the first bad one. */
export function parseEvent(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { field: 'event' }
  const event = {}
  const take = (list, min) => {
    for (const [key, max] of list) {
      if (raw[key] === undefined && min === 0) continue
      const v = text(raw[key], min, max)
      if (v === null) return `event.${key}`
      if (v !== '') event[key] = v
    }
    return null
  }
  let bad = take(REQUIRED, 1) ?? take(OPTIONAL, 0)
  if (bad !== null) return { field: bad }
  if (raw.themes !== undefined) {
    const themes = Array.isArray(raw.themes) && raw.themes.length <= MAX_THEMES ? raw.themes.map((t) => text(t, 1, 60)) : null
    if (themes === null || themes.includes(null)) return { field: 'event.themes' }
    event.themes = themes
  }
  bad = take(OPTIONAL_AFTER_THEMES, 0)
  return bad === null ? { event } : { field: bad }
}

/** The normalized link when `raw` is an https url of one of `hosts` (no port, no userinfo) whose fragment starts with ev_host=, else null. */
export function parseLink(raw, hosts) {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_CHARS) return null
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.port !== '' || u.username !== '' || u.password !== '' || !hosts.includes(u.hostname)) return null
  return u.hash.startsWith('#ev_host=') && u.href.length <= MAX_LINK_CHARS ? u.href : null
}

/** The unique, trimmed, lowercased addresses of `raw` (absent = none), or null when it is not a list of plausible e-mail addresses. */
export function parseInvitees(raw) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const mails = raw.map((m) => (typeof m === 'string' ? m.trim().toLowerCase() : ''))
  return mails.every((m) => m.length <= MAX_EMAIL_CHARS && EMAIL_RE.test(m)) ? [...new Set(mails)] : null
}

export function createOrganizer({ cfg, store, clientOf, now = Date.now }) {
  const limiter = (limit, windowMs) => createWindowLimiter({ limit, windowMs, now })
  const createLimits = [limiter(cfg.orgCreatePerMinute, 60_000), limiter(cfg.orgCreatePerHour, 3_600_000)]
  const writeLimits = [limiter(cfg.orgWritePerMinute, 60_000), limiter(cfg.orgWritePerHour, 3_600_000)]
  const hitLimits = [limiter(cfg.orgHitPerMinute, 60_000)]

  /** Everything every POST checks before it looks at the fields. Returns {body} or {status} (already answered). The limits count invalid posts too. */
  async function receive(req, res, limits) {
    if (req.method !== 'POST') return { status: jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'POST' }) }
    if (String(req.headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return { status: jsonError(res, 403, 'forbidden_origin') }
    const origin = req.headers.origin
    if (origin !== undefined && !originAllowed(origin, cfg.linkHosts)) return { status: jsonError(res, 403, 'forbidden_origin') }
    const key = ipKey(clientOf(req))
    const hits = limits.map((l) => l.hit(key))
    if (hits.some((h) => h.limited)) return { status: tooManyRequests(res, 'rate_limited', Math.max(...hits.map((h) => h.retryAfter))) }
    if (!/^application\/json(\s*;|$)/i.test(String(req.headers['content-type'] ?? ''))) return { status: refuse(req, res, 415, 'unsupported_media') }
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_BYTES) return { status: refuse(req, res, 413, 'too_large') }
    const read = await readJsonObject(req, MAX_BYTES)
    if (read.error === 'too_large') return { status: refuse(req, res, 413, 'too_large') }
    if (read.error !== undefined) return { status: jsonError(res, read.status, read.error) }
    return { body: read.body }
  }

  /** The field (org or secret) that is of the wrong shape, else null. */
  function badCredentialField({ org, secret }) {
    if (typeof org !== 'string' || !CODE_RE.test(org)) return 'org'
    return typeof secret === 'string' && SECRET_RE.test(secret) ? null : 'secret'
  }

  const badRequest = (res, field) => jsonError(res, 400, 'bad_request', { field })

  /** Runs `body` with the store; a store failure answers 500 without a message. */
  async function guarded(res, run) {
    try {
      return await run()
    } catch {
      return jsonError(res, 500, 'server_error')
    }
  }

  const refusal = (res, kind) => {
    if (kind === 'forbidden') return jsonError(res, 403, 'forbidden')
    if (kind === 'not_found') return jsonError(res, 404, 'not_found')
    return jsonError(res, 409, kind)
  }

  async function create(req, res) {
    const got = await receive(req, res, createLimits)
    if (got.body === undefined) return got.status
    const name = text(got.body.name, 1, 80)
    if (name === null) return badRequest(res, 'name')
    const secret = newSecret()
    return guarded(res, async () => {
      const made = await store.create(name, secret)
      if (made.kind === 'full') return jsonError(res, 503, 'full')
      sendJson(res, 201, { org: made.org, secret, plan: 'free', limits: limitsFor(cfg, 'free') })
      return 201
    })
  }

  async function me(req, res) {
    const got = await receive(req, res, writeLimits)
    if (got.body === undefined) return got.status
    const bad = badCredentialField(got.body)
    if (bad !== null) return badRequest(res, bad)
    return guarded(res, async () => {
      const result = await store.me(got.body.org, got.body.secret)
      if (result.kind !== 'ok') return refusal(res, result.kind)
      sendJson(res, 200, { name: result.name, plan: result.plan, limits: limitsFor(cfg, result.plan), events: result.events })
      return 200
    })
  }

  /** The delete form of POST /org/event. */
  function remove(res, { org, secret, id }) {
    if (typeof id !== 'string' || !EVENT_ID_RE.test(id)) return badRequest(res, 'id')
    return guarded(res, async () => {
      const result = await store.deleteEvent(org, secret, id)
      if (result.kind !== 'deleted') return refusal(res, result.kind)
      sendJson(res, 204)
      return 204
    })
  }

  async function event(req, res) {
    const got = await receive(req, res, writeLimits)
    if (got.body === undefined) return got.status
    const { org, secret, id } = got.body
    const bad = badCredentialField(got.body)
    if (bad !== null) return badRequest(res, bad)
    if (got.body.delete !== undefined) return got.body.delete === true ? remove(res, got.body) : badRequest(res, 'delete')
    if (id !== undefined && (typeof id !== 'string' || !EVENT_ID_RE.test(id))) return badRequest(res, 'id')
    const parsed = parseEvent(got.body.event)
    if (parsed.field !== undefined) return badRequest(res, parsed.field)
    const link = parseLink(got.body.link, cfg.linkHosts)
    if (link === null) return badRequest(res, 'link')
    const invitees = parseInvitees(got.body.invitees)
    if (invitees === null) return badRequest(res, 'invitees')
    return guarded(res, async () => {
      const result = await store.saveEvent(org, secret, { id, event: parsed.event, link, invitees })
      if (result.kind !== 'created' && result.kind !== 'updated') return refusal(res, result.kind)
      const status = result.kind === 'created' ? 201 : 200
      sendJson(res, status, { id: result.id, counts: result.counts })
      return status
    })
  }

  async function hit(req, res) {
    const got = await receive(req, res, hitLimits)
    if (got.body === undefined) return got.status
    const { event: id, kind } = got.body
    if (typeof id !== 'string' || !EVENT_ID_RE.test(id)) return badRequest(res, 'event')
    if (!KINDS.includes(kind)) return badRequest(res, 'kind')
    store.hit(id, kind)
    sendJson(res, 204)
    return 204
  }

  const routes = new Map([['/org', create], ['/org/me', me], ['/org/event', event], ['/org/hit', hit]])

  /** Dispatches an /org path. Returns the status it answered. */
  function handle(req, res, pathname) {
    const run = routes.get(pathname)
    return run === undefined ? jsonError(res, 404, 'not_found') : run(req, res)
  }

  return { handle }
}
