// TrustWeb encrypted-backup store. node:http stdlib only.
//
// The server holds opaque ciphertext. It cannot read it and does not try to.
//
//   PUT /backup/<id>   header X-Write-Token: <64 hex>, body = opaque bytes (max 1 MB)
//   GET /backup/<id>   returns the opaque bytes
//   GET /health        returns "ok"
//
// Added 2026-10-06 (wave 1733; full contract in DEVLOG/trustweb-wave-1733/services-api-contract.txt):
//   GET /backup/<id> now also sends ETag + Last-Modified and answers If-None-Match with 304 (late-transcript packs).
//   /hosted/*      hosted recordings with a free allowance        (hosted.mjs, hosted_store.mjs, quota.mjs; HOSTED_DIR)
//   POST /transcribe  server-side transcription proxy              (transcribe.mjs; TRANSCRIBE_URL/KEY)
//   POST|OPTIONS /feedback  website feedback, CORS for FEEDBACK_ORIGINS only   (feedback.mjs; FEEDBACK_FILE)
// The three groups answer errors as JSON; /backup keeps its plain-text answers and its on-disk format.
// The old request deadline of 30 s stays on /backup and /feedback; /hosted and /transcribe get LONG_REQUEST_MS
// (15 min) because a 20 MB upload from a phone takes minutes.
//
// <id> is exactly 64 lowercase hex characters (derived from the person's key on the phone).
// The first PUT for an id claims the slot and stores SHA-256(token). Later PUTs must present
// the same token. GET needs no token: the id itself is a 256-bit secret, and the bytes are
// ciphertext.
//
// Status codes:
//   204 stored            200 returned          400 malformed id/token/body
//   403 wrong write token (or foreign Origin) 404 no such id (GET only)
//   405 method not allowed 413 body over the cap  421 Host not configured
//   429 rate limit        507 storage slot cap reached (new ids only)
//
// 404 vs 403: a PUT to an unknown id creates it, so a PUT never returns 404; GET returns 404
// for unknown ids; 403 only ever means "slot exists, token does not match".
//
// Env: BACKUP_DIR (required), PORT (8960), HOST (127.0.0.1), ALLOWED_HOSTS (comma list,
//      default "localhost,127.0.0.1"), MAX_BYTES (1048576), RATE_LIMIT (30 requests),
//      RATE_WINDOW_MS (60000), MAX_BLOBS (5000).
//      New (all optional; see config.mjs for the full list and defaults): HOSTED_DIR, HOSTED_MAX_BYTES (2 GB),
//      HOSTED_MIN_FREE_BYTES (2 GB), HOSTED_RETENTION_DAYS (90), TRANSCRIBE_URL, TRANSCRIBE_KEY, TRANSCRIBE_MODEL,
//      TRANSCRIBE_DAILY_SECONDS (7200), FEEDBACK_FILE, FEEDBACK_ORIGINS.
//
// Client IP for rate limiting: the socket peer, except when the peer is loopback (the reverse
// proxy on this machine), then the LAST X-Forwarded-For entry (the one the proxy appended).
// Never expose this port beyond loopback, or that header becomes spoofable.
//
// Logging: method and status only. No ids, tokens, IPs or bodies.

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig } from './config.mjs'
import { createFeedback } from './feedback.mjs'
import { createHosted } from './hosted.mjs'
import { createHostedStore } from './hosted_store.mjs'
import { etagMatches, jsonError, sendJson, sha256Hex, tooManyRequests } from './http_util.mjs'
import { createTranscriber } from './transcribe.mjs'

const ID_RE = /^[0-9a-f]{64}$/
const TOKEN_RE = /^[0-9a-f]{64}$/
const ROUTE_RE = /^(?:\/backup)?\/([^/]+)$/
const MAGIC = Buffer.from('TWB1')
const HEADER_BYTES = MAGIC.length + 32
const MAX_TRACKED_CLIENTS = 10000

function hostOnly(value) {
  const v = String(value).trim().toLowerCase()
  if (v.startsWith('[')) return v.slice(0, v.indexOf(']') + 1)
  const i = v.lastIndexOf(':')
  return i === -1 ? v : v.slice(0, i)
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest()
}

export async function startServer(options = {}) {
  const cfg = {
    dir: options.dir ?? process.env.BACKUP_DIR,
    port: options.port ?? Number(process.env.PORT ?? 8960),
    host: options.host ?? process.env.HOST ?? '127.0.0.1',
    allowedHosts: (options.allowedHosts ?? (process.env.ALLOWED_HOSTS ?? 'localhost,127.0.0.1').split(','))
      .map(hostOnly)
      .filter(Boolean),
    maxBytes: options.maxBytes ?? Number(process.env.MAX_BYTES ?? 1048576),
    rateLimit: options.rateLimit ?? Number(process.env.RATE_LIMIT ?? 30),
    rateWindowMs: options.rateWindowMs ?? Number(process.env.RATE_WINDOW_MS ?? 60000),
    maxBlobs: options.maxBlobs ?? Number(process.env.MAX_BLOBS ?? 5000),
    log: options.log ?? ((line) => console.log(line)),
    ...loadConfig(options),
  }
  if (!cfg.dir) throw new Error('BACKUP_DIR is required')
  await fs.mkdir(path.join(cfg.dir, 'tmp'), { recursive: true, mode: 0o700 })
  const blobDir = path.join(cfg.dir, 'blobs')
  await fs.mkdir(blobDir, { recursive: true, mode: 0o700 })
  let blobCount = (await fs.readdir(blobDir)).filter((n) => n.endsWith('.bin')).length

  // The hosted store must never keep /backup (Jakob's real backups) from starting: if it cannot start, hosting is off.
  let store = null
  if (cfg.hostedDir) {
    try {
      store = await createHostedStore(cfg)
      if (store.unreadable() > 0) cfg.log(`hosted store: ${store.unreadable()} unreadable recording json(s) skipped`)
    } catch {
      cfg.log('hosted store unavailable: hosting off')
    }
  }
  const hosted = store === null ? null : createHosted({ cfg, store, withLock, clientOf })
  const transcriber = hosted === null ? null : createTranscriber({ cfg, hosted, store, clientOf, fetchImpl: options.fetchImpl })
  const feedback = createFeedback({ cfg, clientOf, withLock })

  const hits = new Map() // client -> timestamps within the window
  const locks = new Map() // id -> promise chain (serialises writes per id)

  function clientOf(req) {
    const peer = req.socket.remoteAddress ?? ''
    const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1'
    const xff = req.headers['x-forwarded-for']
    if (loopback && typeof xff === 'string' && xff.trim() !== '') {
      const parts = xff.split(',')
      return parts[parts.length - 1].trim()
    }
    return peer
  }

  function limited(client) {
    const now = Date.now()
    if (hits.size > MAX_TRACKED_CLIENTS) {
      for (const [k, v] of hits) if (v.every((t) => now - t >= cfg.rateWindowMs)) hits.delete(k)
      if (hits.size > MAX_TRACKED_CLIENTS) hits.clear()
    }
    const recent = (hits.get(client) ?? []).filter((t) => now - t < cfg.rateWindowMs)
    recent.push(now)
    hits.set(client, recent)
    return recent.length > cfg.rateLimit
  }

  function withLock(id, task) {
    const prev = locks.get(id) ?? Promise.resolve()
    const next = prev.then(task, task)
    const tail = next.catch(() => undefined)
    locks.set(id, tail)
    tail.then(() => {
      if (locks.get(id) === tail) locks.delete(id)
    })
    return next
  }

  function send(res, status, body = '', extra = {}) {
    res.writeHead(status, {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Type': typeof body === 'string' ? 'text/plain; charset=utf-8' : 'application/octet-stream',
      ...extra,
    })
    res.end(body)
  }

  function rejectTooLarge(req, res) {
    send(res, 413, 'too large', { Connection: 'close' })
    // Drop the socket only once the answer is flushed, so the client can read the 413.
    res.once('finish', () => req.socket.destroy())
  }

  // Returns the body Buffer, or null after answering 413. Counts streamed bytes, not just the header.
  function readBody(req, res) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'])
      if (Number.isFinite(declared) && declared > cfg.maxBytes) {
        rejectTooLarge(req, res)
        resolve(null)
        return
      }
      const chunks = []
      let total = 0
      req.on('data', (chunk) => {
        total += chunk.length
        if (total > cfg.maxBytes) {
          chunks.length = 0
          req.removeAllListeners('data')
          rejectTooLarge(req, res)
          resolve(null)
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolve(Buffer.concat(chunks)))
      req.on('error', reject)
    })
  }

  async function readHeader(file) {
    let handle
    try {
      handle = await fs.open(file, 'r')
    } catch (err) {
      if (err.code === 'ENOENT') return null
      throw err
    }
    try {
      const head = Buffer.alloc(HEADER_BYTES)
      const { bytesRead } = await handle.read(head, 0, HEADER_BYTES, 0)
      if (bytesRead !== HEADER_BYTES || !head.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('corrupt slot')
      return head.subarray(MAGIC.length)
    } finally {
      await handle.close()
    }
  }

  async function writeAtomic(file, tokenHash, body) {
    const tmp = path.join(cfg.dir, 'tmp', crypto.randomBytes(12).toString('hex'))
    const handle = await fs.open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(Buffer.concat([MAGIC, tokenHash, body]))
      await handle.sync()
    } finally {
      await handle.close()
    }
    await fs.rename(tmp, file)
  }

  async function handlePut(req, res, id) {
    const token = req.headers['x-write-token']
    if (typeof token !== 'string' || !TOKEN_RE.test(token)) {
      send(res, 400, 'bad token')
      return
    }
    const body = await readBody(req, res)
    if (body === null) return
    if (body.length === 0) {
      send(res, 400, 'empty body')
      return
    }
    const tokenHash = sha256(token)
    const file = path.join(blobDir, `${id}.bin`)
    const outcome = await withLock(id, async () => {
      const stored = await readHeader(file)
      if (stored === null) {
        if (blobCount >= cfg.maxBlobs) return 507
        await writeAtomic(file, tokenHash, body)
        blobCount += 1
        return 204
      }
      if (!crypto.timingSafeEqual(stored, tokenHash)) return 403
      await writeAtomic(file, tokenHash, body)
      return 204
    })
    send(res, outcome, outcome === 204 ? '' : outcome === 403 ? 'forbidden' : 'storage full')
  }

  async function handleGet(req, res, id) {
    const file = path.join(blobDir, `${id}.bin`)
    let data
    let mtime
    try {
      data = await fs.readFile(file)
      mtime = (await fs.stat(file)).mtime
    } catch (err) {
      if (err.code === 'ENOENT') {
        send(res, 404, 'not found')
        return
      }
      throw err
    }
    const body = data.subarray(HEADER_BYTES)
    // Strong validator: first 128 bits of SHA-256 of the stored bytes. A reader polling for a late transcript sends If-None-Match.
    const etag = `"${sha256Hex(body).slice(0, 32)}"`
    const validators = { ETag: etag, 'Last-Modified': mtime.toUTCString() }
    if (etagMatches(req.headers['if-none-match'], etag)) {
      send(res, 304, '', validators)
      return
    }
    send(res, 200, body, validators)
  }

  /** The old request timeout (30 s to receive a request), kept per request so the long routes can have a longer one. */
  function armDeadline(req, res, ms) {
    const timer = setTimeout(() => {
      if (!res.headersSent) send(res, 408, 'request timeout', { Connection: 'close' })
      res.once('finish', () => req.socket.destroy())
      setTimeout(() => req.socket.destroy(), 1000).unref()
    }, ms)
    const clear = () => clearTimeout(timer)
    res.once('close', clear)
    req.once('end', clear)
  }

  async function route(req, res) {
    const host = req.headers.host
    if (typeof host !== 'string' || !cfg.allowedHosts.includes(hostOnly(host))) {
      send(res, 421, 'misdirected request')
      return 421
    }
    const pathname = (req.url ?? '').split('?')[0]
    const longRoute = pathname.startsWith('/hosted/') || pathname === '/transcribe'
    // The new routes answer in JSON (services-api-contract.txt); /backup and /health keep their plain-text answers.
    const jsonRoute = longRoute || pathname === '/feedback'
    const slowDown = () => {
      const retryAfter = Math.ceil(cfg.rateWindowMs / 1000)
      if (jsonRoute) return tooManyRequests(res, 'rate_limited', retryAfter)
      send(res, 429, 'slow down', { 'Retry-After': String(retryAfter) })
      return 429
    }
    if (!longRoute) armDeadline(req, res, cfg.shortRequestMs)
    if (pathname === '/feedback' && (req.method === 'POST' || req.method === 'OPTIONS')) {
      // The one cross-origin route: its own exact-match Origin allowlist (feedback.mjs), checked INSTEAD of the same-host guard below.
      if (limited(clientOf(req))) return slowDown()
      return feedback.handle(req, res)
    }
    const origin = req.headers.origin
    if (origin !== undefined) {
      // Same-origin fetch from the app sends Origin; accept only our own hosts (DNS-rebinding guard).
      let originHost = ''
      try {
        originHost = hostOnly(new URL(origin).host)
      } catch {
        originHost = ''
      }
      if (!cfg.allowedHosts.includes(originHost)) {
        if (jsonRoute) return jsonError(res, 403, 'forbidden_origin')
        send(res, 403, 'forbidden origin')
        return 403
      }
    }
    if (limited(clientOf(req))) return slowDown()
    // /backup/health is the same probe as seen through the same-origin proxy
    // (the app hides its backup card unless this answers "ok").
    if ((pathname === '/health' || pathname === '/backup/health') && req.method === 'GET') {
      send(res, 200, 'ok')
      return 200
    }
    if (pathname === '/feedback') return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'POST, OPTIONS' })
    if (pathname === '/transcribe') return transcriber === null ? jsonError(res, 503, 'not_configured') : transcriber.handle(req, res)
    if (pathname === '/hosted/status' && hosted === null && req.method === 'GET') {
      // Hosting off: the app still gets a clean answer and hides its hosting card.
      sendJson(res, 200, { hosted: false, transcribe: false, feedback: cfg.feedbackConfigured, plan: null })
      return 200
    }
    if (pathname.startsWith('/hosted/')) return hosted === null ? jsonError(res, 503, 'not_configured') : hosted.handle(req, res, pathname)
    const m = ROUTE_RE.exec(pathname)
    if (m === null || !ID_RE.test(m[1])) {
      send(res, 400, 'bad id')
      return 400
    }
    if (req.method === 'PUT') {
      await handlePut(req, res, m[1])
    } else if (req.method === 'GET') {
      await handleGet(req, res, m[1])
    } else {
      send(res, 405, 'method not allowed', { Allow: 'GET, PUT' })
      return 405
    }
    return res.statusCode
  }

  const server = http.createServer((req, res) => {
    route(req, res)
      .then((status) => cfg.log(`${req.method} ${status}`))
      .catch(() => {
        if (!res.headersSent) send(res, 500, 'server error')
        cfg.log(`${req.method} 500`)
      })
  })
  server.requestTimeout = cfg.longRequestMs // per-request deadlines (armDeadline) keep 30 s on the short routes
  server.headersTimeout = 10000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(cfg.port, cfg.host, resolve)
  })
  const address = server.address()
  return {
    server,
    port: typeof address === 'object' && address !== null ? address.port : cfg.port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer()
    .then(({ port }) => console.log(`trustweb-backup listening on ${process.env.HOST ?? '127.0.0.1'}:${port}`))
    .catch((err) => {
      console.error(String(err.message ?? err))
      process.exit(1)
    })
}
