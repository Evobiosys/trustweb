// POST /feedback: website feedback, appended as one JSON line to a 0600 file (see services-api-contract.txt, section 6).
//
// The only cross-origin route. CORS is exact-match on FEEDBACK_ORIGINS (default https://idea2.site, https://app.idea2.site),
// scoped to POST and OPTIONS on /feedback by server.mjs; every other route keeps the same-host Origin guard.
// The answer never echoes the input. A filled honeypot field ("homepage") is answered 204 and dropped.
// Stored per entry: minute-precision UTC time, kind, text, contact, page. No IP, no user agent.
// Wave 2 (P14, P15): an entry may carry {notify:true, newsletter:true, email}. The email is validated and stored ONLY when notify or
// newsletter is true (else it is dropped unread), and ONLY newsletter:true forwards it to the subscriber service (newsletter.mjs),
// after the entry is safely stored. The answer is 204 whatever the subscriber does. The boxes must arrive as real booleans.
// review-wave2: with a ticked box the message may be empty (the form allows "just sign me up"); forwards are capped below every
// bucket the subscriber keeps for this server's one address (attempts, not successes, are what it counts): NEWSLETTER_PER_MINUTE 2,
// NEWSLETTER_PER_DAY 20, NEWSLETTER_PER_30_DAYS 240; past any of them the entry is stored with deferred:true and the log says
// "feedback newsletter deferred", for a later replay.

import fsp from 'node:fs/promises'
import { CapExceeded, jsonError, readSmallBody, refuse, sendJson, tooManyRequests } from './http_util.mjs'
import { createDailyMeter, createWindowLimiter, ipKey } from './limits.mjs'
import { createNewsletterForwarder } from './newsletter.mjs'

const MAX_BODY_BYTES = 16384
const KINDS = Object.freeze(['feedback', 'pricing', 'bug'])
const FIELD = Object.freeze({ text: [1, 4000], contact: [0, 200], page: [0, 200] })
const TEXT_WITH_A_BOX = Object.freeze([0, FIELD.text[1]])
const EMAIL_MAX = 254
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// Every control, format (zero-width, bidi, BOM, soft hyphen), private-use, unassigned and separator character: none belongs in an
// address, and an invisible one would make the stored and forwarded address differ from what the person sees.
const INVISIBLE = /[\p{C}\p{Z}]/u

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

/** A plausible single address (one @, a dot after it, no whitespace, control, format or separator characters, at most 254 characters), else null. */
export function parseEmail(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v.length <= EMAIL_MAX && EMAIL_SHAPE.test(v) && !INVISIBLE.test(v) ? v : null
}

/** Validates the JSON body. Returns {entry} or {field} (the first bad field). */
export function parseFeedback(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return { field: 'body' }
  const notify = checkbox(body.notify)
  if (notify === null) return { field: 'notify' }
  const newsletter = checkbox(body.newsletter)
  if (newsletter === null) return { field: 'newsletter' }
  const ticked = notify || newsletter
  // With a ticked box the message is optional (absent = empty); without one it is the whole point of the entry.
  const text = ticked && (body.text === undefined || body.text === null) ? '' : boundedText(body.text, ticked ? TEXT_WITH_A_BOX : FIELD.text)
  if (text === null) return { field: 'text' }
  const contact = body.contact === undefined || body.contact === null ? '' : boundedText(body.contact, FIELD.contact)
  if (contact === null) return { field: 'contact' }
  const page = body.page === undefined || body.page === null ? '' : boundedText(body.page, FIELD.page)
  if (page === null) return { field: 'page' }
  const kind = body.kind === undefined ? 'feedback' : body.kind
  if (!KINDS.includes(kind)) return { field: 'kind' }
  if (!ticked) return { entry: { kind, text, contact, page } } // an email sent without a ticked box is never read or kept
  const email = parseEmail(body.email)
  if (email === null) return { field: 'email' }
  return { entry: { kind, text, contact, page, notify, newsletter, email } }
}

export function createFeedback({ cfg, clientOf, withLock, fetchImpl = fetch }) {
  const newsletter = createNewsletterForwarder({ cfg, fetchImpl })
  const limiter = createWindowLimiter({ limit: cfg.feedbackPerHour, windowMs: 3600000, now: cfg.now })
  // One global count per UTC day, in memory (a restart starts it again: at worst one more day's cap, still below the subscriber's).
  const forwardsToday = createDailyMeter({ limit: cfg.newsletterPerDay, now: cfg.now })
  // The subscriber's other buckets for this server's one address (spider app.py RATE_LIMITS: 3/min, 20/h, 50/day, 250/30 days):
  // a sliding minute and a sliding 30 days, kept below them. In memory too (a restart forgets them; see README).
  const WINDOWS = Object.freeze([
    { limit: cfg.newsletterPerMinute, ms: 60_000 },
    { limit: cfg.newsletterPer30Days, ms: 30 * 86_400_000 },
  ])
  let forwardTimes = [] // newest last; only the last 30 days are kept

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

  /**
   * Takes today's forward for a newsletter entry BEFORE it is stored, so a deferred entry carries deferred:true in the file (an
   * append-only file cannot be marked afterwards). True = forward after storing; false = keep it for a replay. Forwarding off: true
   * (forwardOptIn then logs "off" as before, nothing leaves). A refused write (507) after a take costs one count of the day: harmless.
   */
  function takeForward() {
    if (!newsletter.enabled) return true
    const t = cfg.now()
    forwardTimes = forwardTimes.filter((x) => t - x < WINDOWS[WINDOWS.length - 1].ms)
    const windowFull = WINDOWS.some((w) => forwardTimes.filter((x) => t - x < w.ms).length >= w.limit)
    if (windowFull || !forwardsToday.fits(null, 1)) return false
    forwardsToday.add(null, 1)
    forwardTimes.push(t)
    return true
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
    const forwardNow = parsed.entry.newsletter === true && takeForward()
    const entry = parsed.entry.newsletter === true && !forwardNow ? { ...parsed.entry, deferred: true } : parsed.entry
    if (!(await append(entry))) return jsonError(res, 507, 'feedback_full', {}, cors)
    if (forwardNow) await forwardOptIn(entry.email)
    else if (entry.deferred) cfg.log('feedback newsletter deferred')
    sendJson(res, 204, undefined, cors)
    return 204
  }

  return { handle }
}
