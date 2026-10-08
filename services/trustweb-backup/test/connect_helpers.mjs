// Shared helpers of the wave 6e test files (aliases.test.mjs, admin.test.mjs): the connect routes and the admin routes. Not a test file.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { call } from './helpers.mjs'

export const APP = 'app.example.test'
export const LONG = `https://${APP}/?connect=did%3Apeer%3A2.Ez6LSdistinctiveDIDmarker&id=p-1#t=Ada-demo`
export const LONG2 = `https://${APP}/?connect=did%3Apeer%3A2.Ez6LSsecondDIDmarker&id=p-2#t=Ada-demo2`
export const JSON_H = { 'Content-Type': 'application/json' }
export const OTHER_SECRET = 'B'.repeat(43)
export const DAY = 86_400_000
export const T0 = 1_800_000_000_000
/** The admin token of the tests: 64 hex characters. */
export const TOKEN = 'ab'.repeat(32)
/** Limits out of the way (most tests post and read a lot from one address). */
export const ROOMY = { connectPerMinute: 10000, connectPerHour: 10000, connectGetPerMinute: 10000, connectGetPerHour: 10000, rateLimit: 100000 }
/** The reserved names of the production unit. */
export const ENV_RESERVED = ['japossert', 'jakob']
export const BASE = { linkHosts: [APP], ...ROOMY, reservedNames: ENV_RESERVED, adminToken: TOKEN }

export const send = (port, url, body, extra = {}) =>
  call(port, { method: 'POST', url, headers: { ...JSON_H, ...extra.headers }, body: typeof body === 'string' ? body : JSON.stringify(body), ip: extra.ip, host: extra.host })
export const connect = (port, body, extra) => send(port, '/connect', body, extra)
export const claim = (port, body, extra) => send(port, '/name', body, extra)
export const who = (port, name, extra = {}) => call(port, { url: `/who/${name}`, ...extra })
export const mint = async (port, url = LONG) => {
  const r = await connect(port, { url })
  assert.equal(r.status, 201)
  return r.json
}
export const readStore = async (backupDir) => JSON.parse(await fs.readFile(path.join(backupDir, 'connect.json'), 'utf8'))

/**
 * A call to the admin routes as the operator makes it: Host 127.0.0.1:<port>, the token header, a JSON body. `Connection: close`, because most answers are
 * sent without reading the request body and a test client must not reuse such a socket (curl, the real caller, opens a new connection each time).
 */
export const admin = (srv, { method = 'POST', url = '/admin/name', body, token = TOKEN, headers = {}, host = `127.0.0.1:${srv.port}` } = {}) => {
  const text = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  return call(srv.port, {
    method,
    url,
    host,
    headers: {
      Connection: 'close',
      ...(text === undefined ? {} : { ...JSON_H, 'Content-Length': String(Buffer.byteLength(text)) }), // a DELETE with a body needs its length stated
      ...(token === null ? {} : { 'X-Admin-Token': token }),
      ...headers,
    },
    body: text,
  })
}
export const grant = (srv, code, name, alias) => admin(srv, { body: { code, name, ...(alias === undefined ? {} : { alias }) } })

export async function inTempDir(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twnames-'))
  try {
    await body(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 }) // a background rewrite may still be finishing
  }
}
