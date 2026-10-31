#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * TrustWeb Signal link companion (wave 27, msg-signal-link). Runs on the owner's laptop only. Node stdlib only.
 *
 * It drives a SEPARATE, user-installed `signal-cli` (GPL-3.0; never embedded or vendored here), keeps a local message log
 * of KEPT WORDS + direction + time (no message bodies, no order) under ~/.trustweb-signal-link/ (mode 0600), and serves
 * the aggregate to the TrustWeb PWA over 127.0.0.1 with a per-start bearer token. See README.md for what is verified and guessed.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const DAY = 86_400_000
export const ALLOWED_ORIGINS = ['https://app.trustweb.one', 'https://dev.trustweb.one', 'https://pre.trustweb.one']

// ---- pure: words and aggregation -------------------------------------------------------------------------------------

// A small English + German stopword list (the owner's likely languages); extend per need.
export const STOPWORDS = new Set((
  'a an and are as at be but by for from had has have he her his i if in into is it its me my no not of on or our she so that the their them ' +
  'then there they this to up us was we were what when which who will with you your yes ok okay hi hey thanks thank lol ' +
  'aber als am auch auf aus bei bin bis da das dass dein dem den der des die doch du ein eine einen er es für hab habe hat ich im ist ja kann ' +
  'mal mein mich mir mit nach nicht noch nur oder sie sind so und uns von war wir wie wird zu zum zur'
).split(/\s+/))

/** Lower-cased words of 3+ letters, stopwords and digits-only tokens dropped. */
export function tokenize(text) {
  const out = []
  for (const w of String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}']+/u)) {
    const t = w.replace(/^'+|'+$/g, '')
    if (t.length < 3 || /^\p{N}+$/u.test(t) || STOPWORDS.has(t)) continue
    out.push(t)
  }
  return out
}

/** One log row from one message: kept words only, sorted (so the sentence cannot be read back), never the body. */
export function logRow(peer, dir, ts, text) {
  return { peer, dir, ts, w: tokenize(text).sort() }
}

/**
 * Pure. rows: log rows. contacts: [{e164, name}]. Returns per-contact counts over the 365 days before `now`, first/last (any age),
 * and the top words. Rows from peers that are not in `contacts` are ignored (only people you saved).
 */
export function aggregate(rows, contacts, now, topN = 12) {
  const by = new Map(contacts.map((c) => [c.e164, { e164: c.e164, name: c.name ?? '', n365: 0, out: 0, in: 0, firstTs: 0, lastTs: 0, _w: new Map() }]))
  for (const r of rows) {
    const a = by.get(r.peer)
    if (!a || !Number.isFinite(r.ts)) continue
    a.firstTs = a.firstTs === 0 ? r.ts : Math.min(a.firstTs, r.ts)
    a.lastTs = Math.max(a.lastTs, r.ts)
    if (r.ts > now || now - r.ts > 365 * DAY) continue
    a.n365++
    if (r.dir === 'out') a.out++; else a.in++
    for (const w of r.w ?? []) a._w.set(w, (a._w.get(w) ?? 0) + 1)
  }
  return [...by.values()].map(({ _w, ...a }) => ({
    ...a,
    words: [..._w].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, topN),
  }))
}

// ---- pure: signal-cli JSON-RPC envelopes (shape recalled from signal-cli's docs; UNVERIFIED here) -------------------------

/** A JSON-RPC `receive` notification line -> a log row, or null (receipts, typing, groups, empty bodies, unknown shapes). */
export function rowFromReceive(line) {
  let msg
  try { msg = JSON.parse(line) } catch { return null }
  const env = msg?.params?.envelope
  if (msg?.method !== 'receive' || !env) return null
  const d = env.dataMessage
  if (d && !d.groupInfo && typeof d.message === 'string' && env.sourceNumber) return logRow(env.sourceNumber, 'in', d.timestamp ?? env.timestamp, d.message)
  const s = env.syncMessage?.sentMessage
  if (s && !s.groupInfo && typeof s.message === 'string' && s.destinationNumber) return logRow(s.destinationNumber, 'out', s.timestamp ?? env.timestamp, s.message)
  return null
}

/** signal-cli's listContacts result (array of {number, name, profileName}) -> [{e164, name}]. Field names UNVERIFIED. */
export function contactsFromList(list) {
  const out = []
  for (const c of Array.isArray(list) ? list : []) {
    if (typeof c?.number === 'string' && /^\+[1-9]\d{6,14}$/.test(c.number)) out.push({ e164: c.number, name: String(c.name || c.profileName || '').slice(0, 80) })
  }
  return out
}

// ---- pure: the loopback gate -----------------------------------------------------------------------------------------------

export function newToken() { return crypto.randomBytes(24).toString('base64url') }

/** headers: lower-cased node headers. Returns {ok:true, origin?} or {ok:false, status}. Preflight needs no token. */
export function checkRequest({ method, headers }, port, token) {
  const host = headers.host
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return { ok: false, status: 421 }
  const origin = headers.origin
  const allowed = [...ALLOWED_ORIGINS, `http://localhost:${port}`]
  if (origin !== undefined && !allowed.includes(origin)) return { ok: false, status: 403 }
  if (method === 'OPTIONS') return { ok: true, origin }
  const auth = headers.authorization ?? ''
  const given = Buffer.from(auth.startsWith('Bearer ') ? auth.slice(7) : '')
  const want = Buffer.from(token)
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return { ok: false, status: 401 }
  return { ok: true, origin }
}

export const pairingUrl = (port, token) => `https://app.trustweb.one/#signal-link=${port}.${token}`

// ---- local files (mode 0600) -----------------------------------------------------------------------------------------------

export function dataDir(home = os.homedir()) { return path.join(home, '.trustweb-signal-link') }

export function appendRow(dir, row) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const f = path.join(dir, 'messages.jsonl')
  fs.appendFileSync(f, JSON.stringify(row) + '\n', { mode: 0o600 })
  fs.chmodSync(f, 0o600)
}

export function readRows(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'messages.jsonl'), 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } })
  } catch { return [] }
}

// ---- signal-cli process control (injectable spawn; the flags are marked verified/guessed in README.md) ----------------

/** First sgnl://linkdevice... URI in a chunk of signal-cli output, or null. */
export function findLinkUri(text) {
  const m = /sgnl:\/\/linkdevice\?[^\s"']+/.exec(text)
  return m ? m[0] : null
}

export function createLinker({ bin = 'signal-cli', spawnFn = spawn, deviceName = 'TrustWeb' } = {}) {
  let state = { phase: 'idle' } // idle | waiting | linked | failed
  let child = null
  return {
    get state() { return state },
    /** Starts `signal-cli link -n <name>`; resolves with the URI the phone scans. */
    start() {
      if (child) return Promise.reject(new Error('already linking'))
      return new Promise((resolve, reject) => {
        let buf = ''
        let got = false
        child = spawnFn(bin, ['link', '-n', deviceName], { stdio: ['ignore', 'pipe', 'pipe'] })
        const onData = (d) => {
          buf += d
          const uri = findLinkUri(buf)
          if (uri && !got) { got = true; state = { phase: 'waiting' }; resolve(uri) }
        }
        child.stdout.on('data', onData)
        child.stderr.on('data', onData)
        child.on('error', (e) => { child = null; state = { phase: 'failed', error: 'signal-cli not runnable: ' + e.code }; if (!got) reject(e) })
        child.on('close', (code) => {
          child = null
          state = code === 0 ? { phase: 'linked' } : { phase: 'failed', error: 'link ended with code ' + code }
          if (!got) reject(new Error('no link URI printed'))
        })
      })
    },
  }
}

/** Long-running `signal-cli -a <acct> jsonRpc`: logs received rows, answers one request at a time. */
export function createReceiver({ bin = 'signal-cli', account, dir, spawnFn = spawn }) {
  let child = null
  let pending = new Map()
  let nextId = 1
  const onLine = (line) => {
    const row = rowFromReceive(line)
    if (row) { appendRow(dir, row); return }
    try {
      const m = JSON.parse(line)
      if (m?.id !== undefined && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id) }
    } catch { /* not json */ }
  }
  return {
    get running() { return child !== null },
    start() {
      if (child) return
      child = spawnFn(bin, ['-a', account, 'jsonRpc'], { stdio: ['pipe', 'pipe', 'inherit'] })
      let buf = ''
      child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1) } })
      child.on('close', () => { child = null; for (const r of pending.values()) r([]); pending = new Map() })
      child.on('error', () => { child = null })
    },
    call(method, params = {}) {
      if (!child) return Promise.resolve([])
      const id = nextId++
      return new Promise((resolve) => {
        pending.set(id, resolve)
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params, id }) + '\n')
        setTimeout(() => { if (pending.delete(id)) resolve([]) }, 15_000).unref()
      })
    },
    stop() { child?.kill() },
  }
}

// ---- HTTP server -----------------------------------------------------------------------------------------------------------

export function createServer({ token, getPort, linker, receiver, dir, now = Date.now, account }) {
  return http.createServer(async (req, res) => {
    const gate = checkRequest({ method: req.method, headers: req.headers }, getPort(), token)
    const cors = gate.origin ? {
      'access-control-allow-origin': gate.origin, vary: 'Origin',
      'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-private-network': 'true',
    } : {}
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors })
      res.end(JSON.stringify(body))
    }
    if (!gate.ok) return send(gate.status, { error: 'refused' })
    if (req.method === 'OPTIONS') return send(204, {})
    const url = new URL(req.url, 'http://x')
    try {
      if (req.method === 'GET' && url.pathname === '/status') {
        return send(200, { v: 1, link: linker.state.phase, error: linker.state.error, account: Boolean(account()), receiving: receiver()?.running ?? false, messages: readRows(dir).length })
      }
      if (req.method === 'POST' && url.pathname === '/link') {
        return send(200, { uri: await linker.start() })
      }
      if (req.method === 'GET' && url.pathname === '/import') {
        const r = receiver()
        const contacts = contactsFromList(r ? await r.call('listContacts') : [])
        return send(200, { v: 1, generatedAt: now(), note: 'history starts when this computer was linked', conversations: aggregate(readRows(dir), contacts, now()) })
      }
      return send(404, { error: 'not found' })
    } catch (e) {
      return send(500, { error: String(e?.message ?? e).slice(0, 120) })
    }
  })
}

// ---- main ------------------------------------------------------------------------------------------------------------------

async function main(argv) {
  const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }
  const bin = arg('--signal-cli') ?? 'signal-cli'
  const dir = dataDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const account = arg('--account')
  let receiver = null
  const startReceiver = () => { if (account && !receiver) { receiver = createReceiver({ bin, account, dir }); receiver.start() } }
  const linker = createLinker({ bin })
  const token = newToken()
  let port = 0
  const server = createServer({ token, getPort: () => port, linker, receiver: () => receiver, dir, account: () => account })
  // Collecting starts once `--account` is given (the owner restarts the companion after linking; account discovery is left out on purpose).
  startReceiver()
  await new Promise((r) => server.listen(Number(arg('--port') ?? 0), '127.0.0.1', r))
  port = server.address().port
  console.log(`TrustWeb Signal link companion on 127.0.0.1:${port}`)
  console.log(`Open this on this computer to pair the app (once):\n  ${pairingUrl(port, token)}`)
  if (!account) console.log('After linking, start again with --account +<your number> so incoming messages are collected.')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2))
