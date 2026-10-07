// POST /feedback: website feedback, appended as one JSON line to a 0600 file (see services-api-contract.txt, section 6).
//
// The only cross-origin route. CORS is exact-match on FEEDBACK_ORIGINS (default https://idea2.site, https://app.idea2.site),
// scoped to POST and OPTIONS on /feedback by server.mjs; every other route keeps the same-host Origin guard.
// The answer never echoes the input. A filled honeypot field ("homepage") is answered 204 and dropped.
// Stored per entry: minute-precision UTC time, kind, text, contact, page. No IP, no user agent.
// Wave 2 (P14, P15): an entry may carry {notify:true, newsletter:true, email}. The email is validated and stored ONLY when notify or
// newsletter is true (else it is dropped unread), and ONLY newsletter:true forwards it to the subscriber service (newsletter.mjs),
// after the entry is safely stored. The answer is 204 whatever the subscriber does. The boxes must arrive as real booleans.

import fsp from 'node:fs/promises'
import { CapExceeded, jsonError, readSmallBody, refuse, sendJson, tooManyRequests } from './http_util.mjs'
import { createWindowLimiter, ipKey } from './limits.mjs'
import { createNewsletterForwarder } from './newsletter.mjs'

const MAX_BODY_BYTES = 16384
const KINDS = Object.freeze(['feedback', 'pricing', 'bug'])
const FIELD = Object.freeze({ text: [1, 4000], contact: [0, 200], page: [0, 200] })
const EMAIL_MAX = 254
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/

/** Optional string within [min,max] characters, else null. */
function boundedText(value, [min, max]) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v.length >= min && v.length <= max ? v : null
}

/** A checkbox value: absent or null = unticked, a real boolean = itself, anything else (the string "true", 1) = invalid (null). */
function checkbox(value) {
  if (value === undefined || value === null) return false
  return typeof value === 'boolean' ? value : null
}

/** A plausible single address (one @, a dot after it, no whitespace or control characters, at most 254 characters), else null. */
export function parseEmail(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v.length <= EMAIL_MAX && EMAIL_SHAPE.test(v) && !CONTROL.test(v) ? v : null
}

/** Validates the JSON body. Returns {entry} or {field} (the first bad field). */
export function parseFeedback(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { field: 'body' }
  const text = boundedText(body.text, FIELD.text)
  if (text === null) return { field: 'text' }
  const contact = body.contact === undefined || body.contact === null ? '' : boundedText(body.contact, FIELD.contact)
  if (contact === null) return { field: 'contact' }
  const page = body.page === undefined || body.page === null ? '' : boundedText(body.page, FIELD.page)
  if (page === null) return { field: 'page' }
  const kind = body.kind === undefined ? 'feedback' : body.kind
  if (!KINDS.includes(kind)) return { field: 'kind' }
  const notify = checkbox(body.notify)
  if (notify === null) return { field: 'notify' }
  const newsletter = checkbox(body.newsletter)
  if (newsletter === null) return { field: 'newsletter' }
  if (!notify && !newsletter) return { entry: { kind, text, contact, page } } // an email sent without a ticked box is never read or kept
  const email = parseEmail(body.email)
  if (email === null) return { field: 'email' }
  return { entry: { kind, text, contact, page, notify, newsletter, email } }
}

export function createFeedback({ cfg, clientOf, withLock, fetchImpl = fetch }) {
  const newsletter = createNewsletterForwarder({ cfg, fetchImpl })
  const limiter = createWindowLimiter({ limit: cfg.feedbackPerHour, windowMs: 3600000, now: cfg.now })

  function corsHeaders(origin) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    }
  }

  async function append(entry) {
    const line = `${JSON.stringify({ t: new Date(cfg.now()).toISOString().slice(0, 16) + 'Z', ...entry })}\n`
    return withLock('feedback-file', async () => {
      let size = 0
      try {
        size = (await fsp.stat(cfg.feedbackFile)).size
      } catch (err) {
        if (err.code !== 'ENOENT') throw err
      }
      if (size + Buffer.byteLength(line) > cfg.feedbackMaxBytes) return false
      await fsp.appendFile(cfg.feedbackFile, line, { mode: 0o600 })
      await fsp.chmod(cfg.feedbackFile, 0o600)
      return true
    })
  }

  /** After the entry is stored, outside the file lock. Logs the outcome (never the address); the visitor's answer does not depend on it. */
  async function forwardOptIn(email) {
    const { outcome, status } = await newsletter.forward(email)
    cfg.log(`feedback newsletter ${outcome}${status === undefined ? '' : ` status=${status}`}`)
  }

  /** The Origin check of this route: exactly one of the allowed origins, scheme included. */
  function allowedOrigin(req) {
    const origin = req.headers.origin
    return typeof origin === 'string' && cfg.feedbackOrigins.includes(origin) ? origin : null
  }

  /** POST and OPTIONS /feedback. Returns the status sent. Rate limiting is applied here (not by the caller). */
  async function handle(req, res) {
    const origin = allowedOrigin(req)
    if (origin === null) return refuse(req, res, 403, 'forbidden_origin')
    const cors = corsHeaders(origin)
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors })
      res.end()
      return 204
    }
    if (!cfg.feedbackFile) return jsonError(res, 503, 'not_configured', {}, cors)
    const hit = limiter.hit(ipKey(clientOf(req)))
    if (hit.limited) return tooManyRequests(res, 'rate_limited', hit.retryAfter, cors)
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      return refuse(req, res, 415, 'unsupported_media', {}, cors)
    }
    let body
    try {
      body = JSON.parse((await readSmallBody(req, MAX_BODY_BYTES)).toString('utf8'))
    } catch (err) {
      if (err instanceof CapExceeded) return refuse(req, res, 413, 'too_large', {}, cors)
      return jsonError(res, 400, 'bad_request', { field: 'body' }, cors)
    }
    if (typeof body?.homepage === 'string' && body.homepage !== '') {
      sendJson(res, 204, undefined, cors)
      return 204
    }
    const parsed = parseFeedback(body)
    if (parsed.field) return jsonError(res, 400, 'bad_request', { field: parsed.field }, cors)
    if (!(await append(parsed.entry))) return jsonError(res, 507, 'feedback_full', {}, cors)
    if (parsed.entry.newsletter) await forwardOptIn(parsed.entry.email)
    sendJson(res, 204, undefined, cors)
    return 204
  }

  return { handle }
}
