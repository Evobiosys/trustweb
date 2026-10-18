// Shared HTTP helpers for the hosted, transcribe and feedback modules (node stdlib only).
// The old /backup routes keep their own plain-text helpers inside server.mjs.

import crypto from 'node:crypto'
import fs from 'node:fs'

export const HEX64 = /^[0-9a-f]{64}$/
export const HEX32 = /^[0-9a-f]{32}$/

/** A streamed body went past its hard cap. */
export class CapExceeded extends Error {
  constructor() {
    super('body over the cap')
    this.name = 'CapExceeded'
  }
}

/** The sender stopped sending for too long. */
export class IdleTimeout extends Error {
  constructor() {
    super('upload idle')
    this.name = 'IdleTimeout'
  }
}

export function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

/** Does an If-None-Match header (a list, `*`, weak prefix allowed) match this strong ETag (with its quotes)? */
export function etagMatches(header, etag) {
  if (typeof header !== 'string') return false
  return header.split(',').some((part) => {
    const v = part.trim()
    return v === '*' || v.replace(/^W\//, '') === etag
  })
}

export function utcDay(nowMs) {
  return new Date(nowMs).toISOString().slice(0, 10)
}

const MESSAGES = {
  bad_request: 'The request is malformed.',
  forbidden_token: 'The token does not match.',
  forbidden: 'Not allowed.',
  name_taken: 'That name is taken.',
  'name-cap': 'Three names per connection in 30 days; organizers can ask the steward for more.',
  reserved: 'That name is reserved.',
  name_locked: 'That name is reserved for you; ask to change it.',
  too_many_names: 'A code can hold up to 3 names.',
  unknown_code: 'No such code.',
  not_held: 'The code does not hold that name.',
  unauthorized: 'Not authorized.',
  forbidden_origin: 'This origin is not allowed.',
  not_found: 'Not found.',
  method_not_allowed: 'Method not allowed.',
  too_large: 'The body is over the size cap.',
  rate_limited: 'Too many requests, slow down.',
  allowance_reached: 'The free allowance is reached.',
  storage_full: 'The server cannot store more right now.',
  not_configured: 'This feature is not switched on.',
  busy: 'The server is busy, try again shortly.',
  busy_today: 'The daily transcription budget is used up, try again tomorrow.',
  ip_daily_limit: 'The daily limit for this network is reached.',
  account_rate_limited: 'Too many new accounts from this network today.',
  unsupported_media: 'Unsupported media type.',
  seconds_mismatch: 'The declared duration does not fit the size.',
  provider_error: 'The transcription provider failed.',
  provider_timeout: 'The transcription provider took too long.',
  feedback_full: 'The feedback store is full.',
  unknown_org: 'No such organizer.',
  limit_events: 'The event limit of this plan is reached.',
  limit_invitees: 'The invitee limit of this plan is reached.',
  full: 'The server cannot take more organizers right now.',
  server_error: 'Server error.',
}

/** JSON answer. Headers match the plain-text helper of server.mjs (no-store, nosniff). */
export function sendJson(res, status, body, extra = {}) {
  const text = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(text === '' ? {} : { 'Content-Type': 'application/json; charset=utf-8' }),
    ...extra,
  })
  res.end(text)
}

/** Error JSON {error, message, ...fields}. Returns the status so handlers can `return jsonError(...)`. */
export function jsonError(res, status, error, fields = {}, extra = {}) {
  sendJson(res, status, { error, message: MESSAGES[error] ?? error, ...fields }, extra)
  return status
}

/** 429 with Retry-After (seconds) and a JSON body. */
export function tooManyRequests(res, error, retryAfterSeconds, extra = {}) {
  const retryAfter = Math.max(1, Math.ceil(retryAfterSeconds))
  return jsonError(res, 429, error, { retryAfter }, { 'Retry-After': String(retryAfter), ...extra })
}

/** After answering without reading the body, drop the socket once the answer is flushed. */
export function closeAfterAnswer(req, res) {
  res.setHeader?.('Connection', 'close')
  res.once('finish', () => req.socket.destroy())
}

/** Answer and drop the connection (used when a request body is refused unread or cut off mid-stream). */
export function refuse(req, res, status, error, fields = {}, extra = {}) {
  jsonError(res, status, error, fields, { Connection: 'close', ...extra })
  res.once('finish', () => req.socket.destroy())
  return status
}

/** Content-Length as a number, or null when absent/invalid. */
export function declaredLength(req) {
  const raw = req.headers['content-length']
  if (raw === undefined) return null
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : null
}

/**
 * Streams the request body into a new file (mode 0600, exclusive create) with a hard byte cap
 * and an idle timeout. Never holds the body in memory. Resolves {bytes, etag} where etag is
 * the first 128 bits of the SHA-256 of the bytes; rejects with CapExceeded / IdleTimeout /
 * a stream error. On rejection the request is only paused (not destroyed), so the caller can
 * still send its answer; the caller removes the file.
 */
export function streamToFile(req, file, { maxBytes, idleMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const out = fs.createWriteStream(file, { flags: 'wx', mode: 0o600 })
    let total = 0
    let settled = false
    let idle
    const detach = () => {
      clearTimeout(idle)
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', fail)
      req.removeListener('close', onClose)
    }
    function fail(err) {
      if (settled) return
      settled = true
      detach()
      req.pause()
      // Settle only once the file is closed: destroy() during a pending open still creates the file afterwards,
      // and the caller's rm would run first and leave an empty spool file behind.
      out.once('close', () => reject(err))
      out.destroy()
    }
    const arm = () => {
      clearTimeout(idle)
      idle = setTimeout(() => {
        fail(new IdleTimeout())
        req.destroy()
      }, idleMs)
    }
    function onData(chunk) {
      total += chunk.length
      if (total > maxBytes) {
        fail(new CapExceeded())
        return
      }
      hash.update(chunk)
      arm()
      if (!out.write(chunk)) {
        req.pause()
        out.once('drain', () => req.resume())
      }
    }
    function onEnd() {
      if (settled) return
      out.end(() => {
        if (settled) return
        settled = true
        detach()
        resolve({ bytes: total, etag: hash.digest('hex').slice(0, 32) })
      })
    }
    function onClose() {
      if (!req.complete) fail(Object.assign(new Error('client closed'), { code: 'ERR_STREAM_PREMATURE_CLOSE' }))
    }
    out.on('error', fail)
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', fail)
    req.on('close', onClose)
    arm()
  })
}

/** Reads a SMALL body (JSON forms) into a Buffer with a hard cap. Rejects with CapExceeded. */
export function readSmallBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = declaredLength(req)
    if (declared !== null && declared > maxBytes) {
      reject(new CapExceeded())
      return
    }
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        chunks.length = 0
        req.removeAllListeners('data')
        reject(new CapExceeded())
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}
