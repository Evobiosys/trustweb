// HTTP side of the hosted recordings (see services-api-contract.txt, section 3).
//
//   GET    /hosted/status
//   PUT    /hosted/<account>/rec/<rid>     X-Write-Token, X-Seconds, [X-Read-Token]; streamed body
//   GET    /hosted/<account>/rec/<rid>     X-Write-Token | X-Read-Token (never public by id alone)
//   DELETE /hosted/<account>/rec/<rid>     X-Write-Token
//   GET    /hosted/<account>/recs          X-Write-Token
//   GET    /hosted/<account>/usage         X-Write-Token
//
// The server holds opaque ciphertext. Every body is streamed to disk with a hard cut-off; nothing is buffered.

import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import {
  CapExceeded,
  HEX32,
  HEX64,
  IdleTimeout,
  declaredLength,
  etagMatches,
  jsonError,
  refuse,
  sendJson,
  sha256Hex,
  streamToFile,
  tooManyRequests,
} from './http_util.mjs'
import { createDailyMeter, createWindowLimiter } from './limits.mjs'
import { AllowanceReason, CapReason, checkBeforeWrite, planFromConfig, usageBody, usageOf, writeCap } from './quota.mjs'

const ROUTE = /^\/hosted\/([^/]+)\/(rec|recs|usage)(?:\/([^/]+))?$/

function tokenHeader(req, name) {
  const v = req.headers[name]
  return typeof v === 'string' && HEX64.test(v) ? v : null
}

function tokenMatches(storedHashHex, token) {
  const a = Buffer.from(storedHashHex, 'hex')
  const b = crypto.createHash('sha256').update(token).digest()
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** X-Seconds: a plain integer 1..maxSeconds, else null. */
function parseSeconds(value, max) {
  if (typeof value !== 'string' || !/^\d{1,5}$/.test(value)) return null
  const n = Number(value)
  return n >= 1 && n <= max ? n : null
}

export function createHosted({ cfg, store, withLock, clientOf }) {
  const plan = planFromConfig(cfg)
  const writes = createWindowLimiter({ limit: cfg.hostedWritesPerHourPerIp, windowMs: 3600000, now: cfg.now })
  const recReads = createWindowLimiter({ limit: cfg.recGetsPerHour, windowMs: 3600000, now: cfg.now })
  const creations = createDailyMeter({ limit: cfg.accountCreatesPerIpDay, now: cfg.now })
  let uploadsInFlight = 0

  function allowanceBody(res, reason, recs, tSeconds) {
    return jsonError(res, 402, 'allowance_reached', { reason, ...usageBody(plan, recs, tSeconds) })
  }

  /** Answers for a stream that stopped at one of the caps. */
  function capAnswer(req, res, reason, recs, tSeconds) {
    switch (reason) {
      case CapReason.Recording:
        return refuse(req, res, 413, 'too_large', { maxBytes: plan.maxBytesPerRecording })
      case CapReason.Sanity:
        return refuse(req, res, 400, 'seconds_mismatch', { field: 'X-Seconds' })
      case CapReason.Account:
        jsonError(res, 402, 'allowance_reached', { reason: AllowanceReason.Bytes, ...usageBody(plan, recs, tSeconds) }, { Connection: 'close' })
        res.once('finish', () => req.socket.destroy())
        return 402
      default:
        return refuse(req, res, 507, 'storage_full')
    }
  }

  async function putRecording(req, res, account, rid) {
    const token = tokenHeader(req, 'x-write-token')
    if (token === null) return jsonError(res, 400, 'bad_request', { field: 'X-Write-Token' })
    const seconds = parseSeconds(req.headers['x-seconds'], plan.maxSecondsPerRecording)
    if (seconds === null) return jsonError(res, 400, 'bad_request', { field: 'X-Seconds' })
    let readHash = null
    if (req.headers['x-read-token'] !== undefined) {
      const readToken = tokenHeader(req, 'x-read-token')
      if (readToken === null) return jsonError(res, 400, 'bad_request', { field: 'X-Read-Token' })
      readHash = sha256Hex(readToken)
    }
    const hit = writes.hit(clientOf(req))
    if (hit.limited) return tooManyRequests(res, 'rate_limited', hit.retryAfter)
    if (uploadsInFlight >= cfg.maxConcurrentUploads) return refuse(req, res, 429, 'busy', {}, { 'Retry-After': '5' })
    uploadsInFlight += 1
    try {
      return await withLock(`hosted:${account}`, () => putLocked(req, res, { account, rid, token, seconds, readHash }))
    } finally {
      uploadsInFlight -= 1
    }
  }

  async function putLocked(req, res, { account, rid, token, seconds, readHash }) {
    const ip = clientOf(req)
    const acct = await store.loadAccount(account)
    if (acct !== null && !tokenMatches(acct.token, token)) return refuse(req, res, 403, 'forbidden_token')
    if (acct === null && !creations.fits(ip, 1)) {
      return refuse(req, res, 429, 'account_rate_limited', { retryAfter: creations.secondsToReset() }, { 'Retry-After': String(creations.secondsToReset()) })
    }
    const recs = acct === null ? [] : await store.listRecs(account)
    const tSeconds = acct?.tSeconds ?? 0
    const blocked = checkBeforeWrite(plan, recs, rid, seconds)
    if (blocked !== null) {
      jsonError(res, 402, 'allowance_reached', { reason: blocked.reason, ...usageBody(plan, recs, tSeconds) }, { Connection: 'close' })
      res.once('finish', () => req.socket.destroy())
      return 402
    }
    const cap = writeCap(plan, recs, rid, seconds, await store.globalRemaining())
    const declared = declaredLength(req)
    if (cap.bytes <= 0 || (declared !== null && declared > cap.bytes)) return capAnswer(req, res, cap.reason, recs, tSeconds)
    if (declared === 0) return refuse(req, res, 400, 'bad_request', { field: 'body' })

    store.reserve(cap.bytes)
    const tmp = store.newTmpFile()
    try {
      let streamed
      try {
        streamed = await streamToFile(req, tmp, { maxBytes: cap.bytes, idleMs: cfg.uploadIdleMs })
      } catch (err) {
        if (err instanceof CapExceeded) return capAnswer(req, res, cap.reason, recs, tSeconds)
        if (err instanceof IdleTimeout || err?.code === 'ERR_STREAM_PREMATURE_CLOSE') return 408
        throw err
      }
      if (streamed.bytes === 0) return jsonError(res, 400, 'bad_request', { field: 'body' })
      if (acct === null) {
        await store.claimAccount(account, sha256Hex(token))
        creations.add(ip, 1)
      }
      await store.commitRecording(account, { id: rid, tmpFile: tmp, seconds, bytes: streamed.bytes, etag: streamed.etag, readHash })
      const after = usageOf([...recs.filter((r) => r.id !== rid), { id: rid, seconds, bytes: streamed.bytes }])
      res.writeHead(204, {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Seconds-Used': String(after.seconds),
        'X-Bytes-Used': String(after.bytes),
      })
      res.end()
      return 204
    } finally {
      store.release(cap.bytes)
      await fsp.rm(tmp, { force: true })
    }
  }

  async function getRecording(req, res, account, rid) {
    const rec = await store.getRec(account, rid)
    const acct = rec === null ? null : await store.loadAccount(account)
    if (rec === null || acct === null) return jsonError(res, 404, 'not_found')
    const hit = recReads.hit(`${account}/${rid}`)
    if (hit.limited) return tooManyRequests(res, 'rate_limited', hit.retryAfter)
    const owner = tokenHeader(req, 'x-write-token')
    const reader = tokenHeader(req, 'x-read-token')
    const ownerOk = owner !== null && tokenMatches(acct.token, owner)
    const readerOk = reader !== null && rec.readHash !== null && tokenMatches(rec.readHash, reader)
    if (!ownerOk && !readerOk) return jsonError(res, 403, 'forbidden_token')
    await store.touch(account, rid)
    const etag = `"${rec.etag}"`
    const headers = {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ETag: etag,
      'Last-Modified': new Date(rec.stored).toUTCString(),
      'X-Seconds': String(rec.seconds),
    }
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.writeHead(304, headers)
      res.end()
      return 304
    }
    let handle
    try {
      handle = await fsp.open(store.recFile(account, rec), 'r')
    } catch (err) {
      if (err.code === 'ENOENT') return jsonError(res, 404, 'not_found')
      throw err
    }
    res.writeHead(200, { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(rec.bytes) })
    try {
      await pipeline(fs.createReadStream(null, { fd: handle.fd, autoClose: false }), res)
    } catch {
      res.destroy()
    } finally {
      await handle.close().catch(() => undefined)
    }
    return 200
  }

  async function deleteRecording(req, res, account, rid) {
    const token = tokenHeader(req, 'x-write-token')
    if (token === null) return jsonError(res, 400, 'bad_request', { field: 'X-Write-Token' })
    return withLock(`hosted:${account}`, async () => {
      const acct = await store.loadAccount(account)
      if (acct === null) return jsonError(res, 404, 'not_found')
      if (!tokenMatches(acct.token, token)) return jsonError(res, 403, 'forbidden_token')
      const removed = await store.deleteRecording(account, rid)
      if (removed === null) return jsonError(res, 404, 'not_found')
      sendJson(res, 204)
      return 204
    })
  }

  /** Token check shared by list and usage. Unknown account = empty answer (never creates one). */
  async function ownerView(req, res, account, build) {
    const token = tokenHeader(req, 'x-write-token')
    if (token === null) return jsonError(res, 400, 'bad_request', { field: 'X-Write-Token' })
    const acct = await store.loadAccount(account)
    if (acct !== null && !tokenMatches(acct.token, token)) return jsonError(res, 403, 'forbidden_token')
    const recs = acct === null ? [] : await store.listRecs(account)
    sendJson(res, 200, build(recs, acct?.tSeconds ?? 0))
    return 200
  }

  const listBody = (recs) => ({
    recordings: recs.map((r) => ({ id: r.id, bytes: r.bytes, seconds: r.seconds, stored: r.stored, hasReadToken: r.readHash !== null })),
  })

  function statusBody() {
    return { hosted: true, transcribe: cfg.transcribeConfigured, feedback: cfg.feedbackConfigured, plan: usageBody(plan, [], 0) }
  }

  /** Returns the HTTP status that was sent. pathname has no query string. */
  async function handle(req, res, pathname) {
    if (!cfg.hostedDir) return jsonError(res, 503, 'not_configured')
    if (pathname === '/hosted/status') {
      if (req.method !== 'GET') return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'GET' })
      sendJson(res, 200, statusBody())
      return 200
    }
    const m = ROUTE.exec(pathname)
    if (m === null) return jsonError(res, 404, 'not_found')
    const [, account, kind, rid] = m
    if (!HEX64.test(account)) return jsonError(res, 400, 'bad_request', { field: 'account' })
    if (kind === 'rec') {
      if (rid === undefined || !HEX32.test(rid)) return jsonError(res, 400, 'bad_request', { field: 'recording' })
      if (req.method === 'PUT') return putRecording(req, res, account, rid)
      if (req.method === 'GET') return getRecording(req, res, account, rid)
      if (req.method === 'DELETE') return deleteRecording(req, res, account, rid)
      return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'GET, PUT, DELETE' })
    }
    if (rid !== undefined) return jsonError(res, 404, 'not_found')
    if (req.method !== 'GET') return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'GET' })
    return kind === 'recs' ? ownerView(req, res, account, listBody) : ownerView(req, res, account, (recs, t) => usageBody(plan, recs, t))
  }

  /**
   * Transcription allowance, claimed before any audio is read. Claims the account on first use.
   * Returns {ok:true} | {ok:false, kind:'forbidden'|'account_rate_limited'|'allowance', retryAfter?, body?}.
   */
  function reserveTranscription(account, token, seconds, ip) {
    return withLock(`hosted:${account}`, async () => {
      let acct = await store.loadAccount(account)
      if (acct !== null && !tokenMatches(acct.token, token)) return { ok: false, kind: 'forbidden' }
      if (acct === null) {
        if (!creations.fits(ip, 1)) return { ok: false, kind: 'account_rate_limited', retryAfter: creations.secondsToReset() }
        await store.claimAccount(account, sha256Hex(token))
        creations.add(ip, 1)
        acct = await store.loadAccount(account)
      }
      if (acct.tSeconds + seconds > plan.secondsLimit) {
        return { ok: false, kind: 'allowance', body: { scope: 'transcription', ...usageBody(plan, [], acct.tSeconds) } }
      }
      await store.adjustTranscribed(account, seconds, 1)
      return { ok: true, secondsUsed: acct.tSeconds + seconds }
    })
  }

  /** Read-only twin of reserveTranscription: would this call be allowed? Writes nothing, so no audio is read for a forged account. */
  async function checkTranscription(account, token, seconds, ip) {
    const acct = await store.loadAccount(account)
    if (acct === null) {
      return creations.fits(ip, 1) ? { ok: true } : { ok: false, kind: 'account_rate_limited', retryAfter: creations.secondsToReset() }
    }
    if (!tokenMatches(acct.token, token)) return { ok: false, kind: 'forbidden' }
    if (acct.tSeconds + seconds > plan.secondsLimit) {
      return { ok: false, kind: 'allowance', body: { scope: 'transcription', ...usageBody(plan, [], acct.tSeconds) } }
    }
    return { ok: true }
  }

  /** Correct a reservation afterwards (refund = negative). Never throws on a vanished account. */
  function adjustTranscription(account, deltaSeconds, deltaCount = 0) {
    return withLock(`hosted:${account}`, () => store.adjustTranscribed(account, deltaSeconds, deltaCount))
  }

  /** What an account has used for transcription (for the answer body). */
  async function transcriptionUsed(account) {
    return (await store.loadAccount(account))?.tSeconds ?? 0
  }

  return { handle, plan, checkTranscription, reserveTranscription, adjustTranscription, transcriptionUsed }
}
