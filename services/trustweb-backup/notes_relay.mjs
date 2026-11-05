// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Notes relay (wave 32; app side: apps/trustweb/src/notes_relay.ts). A shared note too big for the direct way waits here, encrypted, for its recipient.
//
//   POST   /notes/relay {to, from, blob (base64), size, expires}   header X-Relay-Token. 201 {id}
//   GET    /notes/relay?for=<did>                                  header X-Relay-Token. 200 {items: [{id, from, size, expires}]}
//   GET    /notes/relay?for=<did>&id=<id>                          200 {id, from, size, expires, blob}
//   DELETE /notes/relay?for=<did>&id=<id>                          204 (the recipient deletes after fetching)
//
// OPAQUE: the blob is ciphertext made on the sender's phone for the recipient; the server never sees note text and stores the bytes as given.
// AUTH (first claim, like /backup): the first POST for a sender did stores SHA-256 of its token, the first GET for a recipient did that has mail waiting stores SHA-256 of
// that token; later requests must present the same token. A claim is never answered separately from a refusal.
// NO ORACLE: a wrong or missing token, an unknown mailbox, an unknown id, a full mailbox and an expired blob all answer the same 404 (400 only for a malformed post, 413 over the blob cap).
// LIMITS: blob <= notesRelayMaxBlobBytes (20 MB), <= notesRelayMaxPerRecipient (100) waiting per recipient, expires <= 30 days ahead; own per-address budget.
// Store: <BACKUP_DIR>/notes_relay/claims.json (hashes only) and <mailbox = sha256(did)>/<id>.json (metadata) + <id>.bin (the blob bytes). Expired blobs go on the next access.
// Never logged at all (the server treats the path like the connect routes).
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CapExceeded, HEX32, HEX64, jsonError, readSmallBody, refuse, sendJson, sha256Hex, tooManyRequests } from './http_util.mjs'
import { createWindowLimiter, ipKey } from './limits.mjs'

const MAX_DAYS_MS = 30 * 86_400_000
const MAX_DID = 512
const MAX_CLAIMS = 200_000
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/

const didOk = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_DID

/** The path is the relay's (a prefix of /notes/relay with no further segments). */
export const isNotesRelayPath = (pathname) => pathname === '/notes/relay'

export async function openNotesRelay({ cfg, clientOf, withLock, now = Date.now }) {
  const root = path.join(cfg.dir, 'notes_relay')
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const claimsFile = path.join(root, 'claims.json')
  let claims = {}
  try {
    claims = JSON.parse(await fs.readFile(claimsFile, 'utf8')).claims ?? {}
  } catch { /* first start, or unreadable: nobody has claimed anything yet */ }
  let chain = Promise.resolve()
  const saveClaims = async () => {
    const tmp = `${claimsFile}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ v: 1, claims }), { mode: 0o600 })
    await fs.rename(tmp, claimsFile)
  }
  const persist = () => (chain = chain.then(saveClaims, saveClaims))

  const minute = createWindowLimiter({ limit: cfg.notesRelayPerMinute, windowMs: 60_000, now })
  const hour = createWindowLimiter({ limit: cfg.notesRelayPerHour, windowMs: 3_600_000, now })
  const maxBody = Math.ceil(cfg.notesRelayMaxBlobBytes / 3) * 4 + 4096

  /** True when `token` is the one this role+did claimed; with `mayClaim` the first token seen claims it. */
  async function authorised(role, did, token, mayClaim) {
    const key = sha256Hex(`${role}\0${did}`)
    const hash = sha256Hex(token)
    const held = claims[key]
    if (held === undefined) {
      if (!mayClaim || Object.keys(claims).length >= MAX_CLAIMS) return false
      claims[key] = hash
      await persist()
      return true
    }
    return crypto.timingSafeEqual(Buffer.from(held, 'hex'), Buffer.from(hash, 'hex'))
  }

  const notFound = (res) => jsonError(res, 404, 'not_found')
  const boxOf = (did) => path.join(root, sha256Hex(did))

  /** The live items of a mailbox, oldest first; expired ones are removed here. */
  async function items(box) {
    let names
    try {
      names = (await fs.readdir(box)).filter((n) => n.endsWith('.json'))
    } catch {
      return []
    }
    const live = []
    for (const name of names) {
      let meta
      try {
        meta = JSON.parse(await fs.readFile(path.join(box, name), 'utf8'))
      } catch {
        continue
      }
      if (meta.expires <= now()) {
        await Promise.all([fs.unlink(path.join(box, name)), fs.unlink(path.join(box, `${meta.id}.bin`))]).catch(() => undefined)
        continue
      }
      live.push(meta)
    }
    return live.sort((a, b) => a.at - b.at)
  }

  async function post(req, res, token) {
    if (!HEX64.test(token)) return jsonError(res, 400, 'bad_request', { field: 'token' })
    let body
    try {
      body = JSON.parse((await readSmallBody(req, maxBody)).toString('utf8'))
    } catch (err) {
      if (err instanceof CapExceeded) return refuse(req, res, 413, 'too_large')
      return jsonError(res, 400, 'bad_request')
    }
    if (body === null || typeof body !== 'object') return jsonError(res, 400, 'bad_request')
    const { to, from, blob, size, expires } = body
    if (!didOk(to)) return jsonError(res, 400, 'bad_request', { field: 'to' })
    if (!didOk(from)) return jsonError(res, 400, 'bad_request', { field: 'from' })
    if (typeof blob !== 'string' || !BASE64_RE.test(blob)) return jsonError(res, 400, 'bad_request', { field: 'blob' })
    if (!Number.isInteger(size) || size <= 0) return jsonError(res, 400, 'bad_request', { field: 'size' })
    if (size > cfg.notesRelayMaxBlobBytes) return jsonError(res, 413, 'too_large')
    const bytes = Buffer.from(blob, 'base64')
    if (bytes.length !== size) return jsonError(res, 400, 'bad_request', { field: 'size' })
    const t = now()
    if (!Number.isFinite(expires) || expires <= t || expires > t + MAX_DAYS_MS) return jsonError(res, 400, 'bad_request', { field: 'expires' })
    if (!(await authorised('send', from, token, true))) return notFound(res)
    const box = boxOf(to)
    return withLock(`relay:${box}`, async () => {
      if ((await items(box)).length >= cfg.notesRelayMaxPerRecipient) return notFound(res)
      const id = crypto.randomBytes(16).toString('hex')
      await fs.mkdir(box, { recursive: true, mode: 0o700 })
      await fs.writeFile(path.join(box, `${id}.bin`), bytes, { mode: 0o600 })
      await fs.writeFile(path.join(box, `${id}.json`), JSON.stringify({ id, from, size, expires, at: t }), { mode: 0o600 })
      sendJson(res, 201, { id })
      return 201
    })
  }

  async function read(res, box, id) {
    const all = await items(box)
    if (id === null) {
      sendJson(res, 200, { items: all.map(({ id: i, from, size, expires }) => ({ id: i, from, size, expires })) })
      return 200
    }
    const meta = all.find((m) => m.id === id)
    if (meta === undefined) return notFound(res)
    const bytes = await fs.readFile(path.join(box, `${id}.bin`))
    sendJson(res, 200, { id, from: meta.from, size: meta.size, expires: meta.expires, blob: bytes.toString('base64') })
    return 200
  }

  async function remove(res, box, id) {
    if (!(await items(box)).some((m) => m.id === id)) return notFound(res)
    await Promise.all([fs.unlink(path.join(box, `${id}.json`)), fs.unlink(path.join(box, `${id}.bin`))])
    res.writeHead(204, { 'Cache-Control': 'no-store' })
    res.end()
    return 204
  }

  /** Returns the status it answered. */
  async function handle(req, res) {
    const key = ipKey(clientOf(req))
    const m = minute.hit(key)
    const h = hour.hit(key)
    if (m.limited || h.limited) return tooManyRequests(res, 'rate_limited', Math.max(m.retryAfter, h.retryAfter))
    const token = typeof req.headers['x-relay-token'] === 'string' ? req.headers['x-relay-token'] : ''
    if (req.method === 'POST') return post(req, res, token)
    if (req.method !== 'GET' && req.method !== 'DELETE') return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'GET, POST, DELETE' })
    const query = new URL(req.url, 'http://relay.invalid').searchParams
    const did = query.get('for')
    const id = query.get('id')
    if (!didOk(did) || !HEX64.test(token) || (id !== null && !HEX32.test(id)) || !(await authorised('read', did, token, (await items(boxOf(did))).length > 0))) return notFound(res)
    if (req.method === 'DELETE') return id === null ? notFound(res) : withLock(`relay:${boxOf(did)}`, () => remove(res, boxOf(did), id))
    return read(res, boxOf(did), id)
  }

  return { handle }
}
