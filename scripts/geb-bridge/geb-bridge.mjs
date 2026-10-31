#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Geb bridge: lets the TrustWeb app on this computer read and send through YOUR Geb command-line tool (geb.mjs).
// Node stdlib only. Loopback only. It never starts `geb listen` (one listener per identity: run your own).
// Usage: node scripts/geb-bridge/geb-bridge.mjs --cli /path/to/geb.mjs [--port N] [--app https://app.trustweb.one]
import http from 'node:http'
import { execFile } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const APP_ORIGINS = ['https://app.trustweb.one', 'https://dev.trustweb.one', 'https://pre.trustweb.one']
const LOCAL_DEV = /^http:\/\/localhost:\d{1,5}$/
const CLI_TIMEOUT_MS = 20000
const BODY_MAX = 16 * 1024
const TEXT_MAX = 4000
const TARGET = /^[A-Za-z0-9:._~-]{1,400}$/

// ---- pure parts (unit-tested) -------------------------------------------------------------------------------------

export function originAllowed(origin) {
  return typeof origin === 'string' && (APP_ORIGINS.includes(origin) || LOCAL_DEV.test(origin))
}

function same(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Decides one request from its headers alone. { ok, cors } | { ok, preflight, cors } | { ok:false, status, error }. */
export function checkRequest({ port, token, method, host, origin, authorization }) {
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return { ok: false, status: 403, error: 'bad host' }
  if (origin !== undefined && !originAllowed(origin)) return { ok: false, status: 403, error: 'origin not allowed' }
  if (method === 'OPTIONS') {
    if (origin === undefined) return { ok: false, status: 403, error: 'origin not allowed' }
    return { ok: true, preflight: true, cors: origin }
  }
  if (method !== 'GET' && method !== 'POST') return { ok: false, status: 405, error: 'method' }
  const m = /^Bearer (.+)$/.exec(authorization ?? '')
  if (!m || !same(m[1], token)) return { ok: false, status: 401, error: 'token' }
  return { ok: true, cors: origin }
}

export function pairingLink(appOrigin, port, token) {
  return `${appOrigin}/#geb-bridge=${port}.${token}`
}

/** A DID or petname that cannot be read as an option and cannot hold spaces or shell-ish characters. */
export function validTarget(t) {
  return typeof t === 'string' && !t.startsWith('-') && TARGET.test(t)
}

/** The text argument; a leading dash gets a space so the CLI cannot read it as an option. Null = refuse. */
export function argText(t) {
  if (typeof t !== 'string' || !t.trim() || t.length > TEXT_MAX) return null
  return t.startsWith('-') ? ' ' + t : t
}

const DID = /^did:[a-z0-9]+:\S+$/i
const isDid = (s) => typeof s === 'string' && DID.test(s)
const str = (v) => (typeof v === 'string' ? v : '')

function listIn(raw) {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const arr = Object.values(raw).find(Array.isArray)
    if (arr) return arr
  }
  return null
}

// The exact JSON of `geb ... --json` is NOT verified; these read what is plausible and skip the rest.
export function parseConnections(raw) {
  const entry = (v, key) => {
    if (typeof v === 'string') return isDid(v) ? { did: v, name: '' } : null
    if (!v || typeof v !== 'object') return null
    const did = [key, v.did, v.peer, v.with, v.id].find(isDid)
    return did ? { did, name: str(v.petname) || str(v.name) || str(v.label) } : null
  }
  const list = listIn(raw)
  const out = list ? list.map((v) => entry(v)) : raw && typeof raw === 'object' ? Object.entries(raw).map(([k, v]) => entry(v, k)) : []
  return out.filter(Boolean)
}

function toMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e12 ? Math.round(v * 1000) : v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? 0 : t
  }
  return 0
}

export function parseInbox(raw) {
  const list = listIn(raw) ?? []
  return list
    .filter((l) => l && typeof l === 'object' && typeof l.from === 'string' && l.from !== 'me' && typeof l.text === 'string')
    .map((l) => ({ from: l.from, text: l.text, at: toMs(l.at) }))
}

export function parseHistory(out) {
  return String(out)
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try {
        const j = JSON.parse(l)
        if (j && typeof j === 'object' && typeof j.text === 'string') return { from: str(j.from), text: j.text, at: toMs(j.at) }
      } catch { /* plain text line */ }
      return { from: '', text: l.trim(), at: 0 }
    })
}

export function buildThreads(connections, inbox) {
  const by = new Map(connections.map((c) => [c.did, { did: c.did, title: c.name, lastAt: 0, unread: 0, lastText: '' }]))
  for (const l of inbox) {
    const t = by.get(l.from) ?? { did: l.from, title: '', lastAt: 0, unread: 0, lastText: '' }
    t.unread += 1
    if (l.at >= t.lastAt) { t.lastAt = l.at; t.lastText = l.text }
    by.set(l.from, t)
  }
  return [...by.values()]
    .map((t) => ({ ...t, title: t.title || t.did.slice(0, 12) + '…' + t.did.slice(-6) }))
    .sort((a, b) => b.lastAt - a.lastAt)
}

// ---- the server -----------------------------------------------------------------------------------------------------

function runCli(cli, args, env) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [cli, ...args], { timeout: CLI_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env, shell: false }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).toString().slice(0, 300)))
      else resolve(String(stdout))
    })
  })
}

const jsonOrNull = (s) => { try { return JSON.parse(s) } catch { return null } }

export function startBridge({ cli, port = 0, app = APP_ORIGINS[0], quiet = false } = {}) {
  if (!cli) throw new Error('--cli <path to geb.mjs> (or GEB_CLI) is required')
  if (!APP_ORIGINS.includes(app) && !LOCAL_DEV.test(app)) throw new Error('--app must be a TrustWeb origin')
  const token = randomBytes(24).toString('base64url')
  const env = { ...process.env }
  const geb = (...a) => runCli(cli, a, env)

  const routes = {
    'GET /status': async () => {
      try {
        const id = jsonOrNull(await geb('id', '--json'))
        const did = id && typeof id === 'object' ? [id.did, id.id].find(isDid) ?? null : null
        return { ok: true, did }
      } catch (e) {
        return { ok: false, error: e.message }
      }
    },
    'GET /threads': async () => {
      const conns = parseConnections(jsonOrNull(await geb('connections', '--json')))
      const inbox = parseInbox(jsonOrNull(await geb('inbox', '--json'))) // never --mark-read: reading here must not change Geb's state
      return { threads: buildThreads(conns, inbox) }
    },
    'GET /history': async (url) => {
      const w = url.searchParams.get('with')
      if (!validTarget(w)) return { status: 400, error: 'with' }
      return { lines: parseHistory(await geb('history', w)) }
    },
    'POST /send': async (_url, body) => {
      const b = jsonOrNull(body)
      const text = argText(b?.text)
      if (!b || !validTarget(b.to) || text === null) return { status: 400, error: 'to/text' }
      await geb('send', b.to, text)
      return { ok: true }
    },
  }

  const server = http.createServer((req, res) => {
    const port2 = server.address().port
    const h = req.headers
    const c = checkRequest({ port: port2, token, method: req.method, host: h.host, origin: h.origin, authorization: h.authorization })
    const cors = c.cors ? { 'access-control-allow-origin': c.cors, vary: 'Origin' } : {}
    const reply = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors })
      res.end(obj === undefined ? '' : JSON.stringify(obj))
    }
    if (!c.ok) return reply(c.status, { error: c.error })
    if (c.preflight) {
      res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-private-network': 'true', 'access-control-max-age': '600' })
      return res.end()
    }
    const url = new URL(req.url, 'http://127.0.0.1')
    const route = routes[`${req.method} ${url.pathname}`]
    if (!route) return reply(404, { error: 'not found' })
    let body = ''
    let size = 0
    req.on('data', (d) => {
      size += d.length
      if (size > BODY_MAX) { req.destroy(); return }
      body += d
    })
    req.on('end', () => {
      route(url, body).then(
        (r) => { const { status, ...rest } = r; reply(status ?? 200, rest) },
        (e) => reply(502, { error: String(e.message).slice(0, 300) }),
      )
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address()
      if (addr.address !== '127.0.0.1') { server.close(); return reject(new Error('refusing to run on anything but 127.0.0.1')) }
      const link = pairingLink(app, addr.port, token)
      if (!quiet) {
        console.log(`Geb bridge on 127.0.0.1:${addr.port} (this computer only). Open this link once in the browser where you use TrustWeb:\n\n  ${link}\n`)
        console.log('It lets TrustWeb read and send through your Geb here. It does not start `geb listen`. Ctrl+C stops it; a new start makes a new link.')
      }
      resolve({ port: addr.port, address: addr.address, token, link, close: () => server.close() })
    })
  })
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startBridge({ cli: arg('--cli') ?? process.env.GEB_CLI, port: Number(arg('--port') ?? 0), app: arg('--app') ?? APP_ORIGINS[0] }).catch((e) => {
    console.error(String(e.message))
    process.exit(1)
  })
}
