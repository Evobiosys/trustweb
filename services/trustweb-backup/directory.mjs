// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Name directory (wave 43c social-hosting; app side: apps/trustweb/src/directory_client.ts, design: DEVLOG/wave43/social-hosting_DESIGN.txt).
// The fallback of friends-first hosting: a signed name record {first, last, key (did), ts, open, srv} someone switched "Discoverable by name" on for.
//
//   PUT    /directory           {rec}                 204. Anyone may PUT a validly signed record (the owner, or a friend handing it over): the signature is the proof.
//   GET    /directory?q=<first last>                  200 {records: [...]}  EXACT normalised name, newest first, at most 10. No prefix search, no listing.
//   DELETE /directory           {key, ts, sig}        204. Signed withdrawal by the key itself.
//   POST   /directory/intent    {intent}              204. A signed "intend to connect" left for a key (max 20 waiting per key, one per sender, 30 days).
//   POST   /directory/intents   {key, ts, sig}        200 {intents: [...]} and they are cleared. Signed pull by the key itself.
//
// Signatures: ed25519 by the signing key inside the did:peer:2 "V" element; messages "tw-name-v1" / "tw-intent-v1" / "tw-del-v1" / "tw-pull-v1"
// (identical bytes to apps/trustweb/src/name_record.ts, proven by test/unit/directory_server_cross.test.mjs). ts of del and pull must be within 5 minutes.
// A record with srv=false is REFUSED: its owner did not allow any server (trusted-only), so a hosting friend cannot hand it over.
// hosts[] is never stored (the server is the fallback, not a host). Store: <BACKUP_DIR>/directory.json. Never logged (the module has no logger).
// Honest labelling (I7): the server sees first name, last name, did, open flag and time of everyone who switched Discoverable on, and intents (from, to).
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CapExceeded, jsonError, readSmallBody, refuse, sendJson, tooManyRequests } from './http_util.mjs'
import { createWindowLimiter, ipKey } from './limits.mjs'

const MAX_BODY = 4096
const MAX_NAME = 60
const MAX_DID = 512
const MAX_RESULTS = 10
const MAX_WAITING = 20
const INTENT_MS = 30 * 86_400_000
const WINDOW_MS = 5 * 60_000
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex')

export const isDirectoryPath = (pathname) => pathname === '/directory' || pathname === '/directory/intent' || pathname === '/directory/intents'

/** The directory key of a name: same as name_record.ts normName. */
export const normName = (first, last) => `${first} ${last}`.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

function base58(s) {
  let n = 0n
  for (const c of s) {
    const i = ALPHABET.indexOf(c)
    if (i < 0) return null
    n = n * 58n + BigInt(i)
  }
  let hex = n.toString(16)
  if (hex.length % 2) hex = `0${hex}`
  const lead = s.length - s.replace(/^1+/, '').length
  return Buffer.concat([Buffer.alloc(lead), n === 0n ? Buffer.alloc(0) : Buffer.from(hex, 'hex')])
}

/** The 32-byte ed25519 key of a did:peer:2 (its "V" element: "z" + base58(0xed01 + key)), or null. */
function signingKey(did) {
  if (typeof did !== 'string' || !did.startsWith('did:peer:2.')) return null
  const v = did.slice(11).split('.').find((e) => e[0] === 'V')
  if (v === undefined || v[1] !== 'z') return null
  const raw = base58(v.slice(2))
  return raw !== null && raw.length === 34 && raw[0] === 0xed && raw[1] === 0x01 ? raw.subarray(2) : null
}

/** Is `sig` (base64url) a valid ed25519 signature of `message` by the key inside `did`? Never throws. */
export function verifyDid(did, message, sig) {
  try {
    const raw = signingKey(did)
    if (raw === null || typeof sig !== 'string' || sig.length > 200) return false
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' })
    return crypto.verify(null, Buffer.from(message), key, Buffer.from(sig, 'base64url'))
  } catch {
    return false
  }
}

const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max
const recordMessage = (r) => `tw-name-v1\n${normName(r.first, r.last)}\n${r.key}\n${r.ts}\n${r.open ? 1 : 0}\n${r.srv ? 1 : 0}`
const intentMessage = (i) => `tw-intent-v1\n${i.to}\n${i.from.key}\n${normName(i.from.first, i.from.last)}\n${i.ts}`

/** A well-formed, validly signed record that allows a server; returns the stored form (no hosts) or null. */
export function checkRecord(r) {
  if (typeof r !== 'object' || r === null || r.v !== 1) return null
  if (!text(r.first, MAX_NAME) || !text(r.last, MAX_NAME) || !text(r.key, MAX_DID) || !text(r.sig, 200)) return null
  if (typeof r.ts !== 'number' || !Number.isFinite(r.ts) || typeof r.open !== 'boolean' || r.srv !== true) return null
  if (!Array.isArray(r.hosts) || r.hosts.length > 20 || !r.hosts.every((h) => text(h, MAX_DID))) return null
  if (!verifyDid(r.key, recordMessage(r), r.sig)) return null
  return { v: 1, first: r.first.trim(), last: r.last.trim(), key: r.key, ts: r.ts, open: r.open, srv: true, hosts: [], sig: r.sig }
}

export function checkIntent(i) {
  if (typeof i !== 'object' || i === null || !text(i.to, MAX_DID) || typeof i.from !== 'object' || i.from === null) return null
  const f = i.from
  if (!text(f.first, MAX_NAME) || !text(f.last, MAX_NAME) || !text(f.key, MAX_DID) || typeof i.ts !== 'number' || !Number.isFinite(i.ts) || !text(i.sig, 200)) return null
  if (!verifyDid(f.key, intentMessage(i), i.sig)) return null
  return { to: i.to, from: { first: f.first.trim(), last: f.last.trim(), key: f.key }, ts: i.ts, sig: i.sig }
}

export async function openDirectory({ cfg, clientOf, now = Date.now }) {
  const file = path.join(cfg.dir, 'directory.json')
  await fs.mkdir(cfg.dir, { recursive: true, mode: 0o700 })
  /** key -> record */
  const records = new Map()
  /** normalised name -> Set of keys */
  const byName = new Map()
  /** to-key -> [intent + at] */
  const intents = new Map()
  try {
    const saved = JSON.parse(await fs.readFile(file, 'utf8'))
    for (const r of saved.records ?? []) { const ok = checkRecord(r); if (ok) index(ok) }
    for (const [to, list] of Object.entries(saved.intents ?? {})) intents.set(to, list.filter((i) => checkIntent(i) !== null && now() - i.at < INTENT_MS))
  } catch { /* first start, or unreadable: the directory starts empty */ }

  function index(rec) {
    const held = records.get(rec.key)
    if (held !== undefined) {
      const old = byName.get(normName(held.first, held.last))
      old?.delete(rec.key)
      if (old?.size === 0) byName.delete(normName(held.first, held.last))
    }
    records.set(rec.key, rec)
    const n = normName(rec.first, rec.last)
    byName.set(n, (byName.get(n) ?? new Set()).add(rec.key))
  }
  function unindex(key) {
    const held = records.get(key)
    if (held === undefined) return
    const n = normName(held.first, held.last)
    byName.get(n)?.delete(key)
    if (byName.get(n)?.size === 0) byName.delete(n)
    records.delete(key)
  }

  let chain = Promise.resolve()
  const save = async () => {
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ v: 1, records: [...records.values()], intents: Object.fromEntries(intents) }), { mode: 0o600 })
    await fs.rename(tmp, file)
  }
  const persist = () => (chain = chain.then(save, save))

  const minute = createWindowLimiter({ limit: cfg.directoryPerMinute, windowMs: 60_000, now })
  const hour = createWindowLimiter({ limit: cfg.directoryPerHour, windowMs: 3_600_000, now })
  const getMinute = createWindowLimiter({ limit: cfg.directoryGetPerMinute, windowMs: 60_000, now })

  const bad = (res) => jsonError(res, 400, 'bad_request')
  const fresh = (ts) => typeof ts === 'number' && Math.abs(now() - ts) <= WINDOW_MS

  async function body(req, res) {
    try {
      const parsed = JSON.parse((await readSmallBody(req, MAX_BODY)).toString('utf8'))
      return parsed !== null && typeof parsed === 'object' ? parsed : (bad(res), null)
    } catch (err) {
      if (err instanceof CapExceeded) refuse(req, res, 413, 'too_large')
      else bad(res)
      return null
    }
  }
  const done = (res) => { res.writeHead(204, { 'Cache-Control': 'no-store' }); res.end(); return 204 }

  async function put(req, res) {
    const b = await body(req, res)
    if (b === null) return res.statusCode
    const rec = checkRecord(b.rec)
    if (rec === null) return bad(res)
    const held = records.get(rec.key)
    if (held === undefined && records.size >= cfg.directoryMax) return bad(res)
    if (held === undefined || rec.ts > held.ts) { index(rec); await persist() }
    return done(res)
  }

  function search(res, url) {
    const q = new URL(url, 'http://dir.invalid').searchParams.get('q')
    if (!text(q, 2 * MAX_NAME + 1)) return bad(res)
    const keys = byName.get(normName(...splitName(q))) ?? new Set()
    const found = [...keys].map((k) => records.get(k)).sort((a, b) => b.ts - a.ts).slice(0, MAX_RESULTS)
    sendJson(res, 200, { records: found })
    return 200
  }

  async function withdraw(req, res) {
    const b = await body(req, res)
    if (b === null) return res.statusCode
    if (!text(b.key, MAX_DID) || !fresh(b.ts) || !verifyDid(b.key, `tw-del-v1\n${b.key}\n${b.ts}`, b.sig)) return bad(res)
    if (records.has(b.key)) { unindex(b.key); await persist() }
    return done(res)
  }

  async function leave(req, res) {
    const b = await body(req, res)
    if (b === null) return res.statusCode
    const i = checkIntent(b.intent)
    if (i === null) return bad(res)
    const t = now()
    const waiting = (intents.get(i.to) ?? []).filter((x) => t - x.at < INTENT_MS)
    const same = waiting.findIndex((x) => x.from.key === i.from.key)
    if (same >= 0) { if (i.ts > waiting[same].ts) waiting[same] = { ...i, at: t } }
    else if (waiting.length < MAX_WAITING) waiting.push({ ...i, at: t })
    intents.set(i.to, waiting)
    await persist()
    return done(res)
  }

  async function take(req, res) {
    const b = await body(req, res)
    if (b === null) return res.statusCode
    if (!text(b.key, MAX_DID) || !fresh(b.ts) || !verifyDid(b.key, `tw-pull-v1\n${b.key}\n${b.ts}`, b.sig)) return bad(res)
    const t = now()
    const mine = (intents.get(b.key) ?? []).filter((x) => t - x.at < INTENT_MS)
    if (intents.delete(b.key)) await persist()
    sendJson(res, 200, { intents: mine.map(({ at: _at, ...i }) => i) })
    return 200
  }

  /** Returns the status it answered. */
  async function handle(req, res) {
    const key = ipKey(clientOf(req))
    const m = minute.hit(key)
    const h = hour.hit(key)
    if (m.limited || h.limited) return tooManyRequests(res, 'rate_limited', Math.max(m.retryAfter, h.retryAfter))
    const pathname = (req.url ?? '').split('?')[0]
    if (pathname === '/directory/intent') return req.method === 'POST' ? leave(req, res) : jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'POST' })
    if (pathname === '/directory/intents') return req.method === 'POST' ? take(req, res) : jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'POST' })
    if (req.method === 'PUT') return put(req, res)
    if (req.method === 'DELETE') return withdraw(req, res)
    if (req.method === 'GET') {
      const g = getMinute.hit(key)
      return g.limited ? tooManyRequests(res, 'rate_limited', g.retryAfter) : search(res, req.url ?? '')
    }
    return jsonError(res, 405, 'method_not_allowed', {}, { Allow: 'GET, PUT, DELETE' })
  }

  return { handle }
}

/** "first last" typed as one string: the first word is the first name, the rest the last name (normName squashes them back together). */
function splitName(q) {
  const [first, ...rest] = q.trim().split(/\s+/)
  return [first ?? '', rest.join(' ')]
}
