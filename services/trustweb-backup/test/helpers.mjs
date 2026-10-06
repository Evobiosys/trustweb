// Shared test helpers (not a test file). Fixed ports 8971-8979 only: one per test file, tests in a file run in sequence.
import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startServer } from '../server.mjs'

export const A = 'a'.repeat(64)
export const A2 = 'a1'.repeat(32)
export const T = 'b'.repeat(64)
export const T2 = 'c'.repeat(64)
export const RC = 'd'.repeat(64) // a read capability
export const R1 = '1'.repeat(32)
export const R2 = '2'.repeat(32)
export const R3 = '3'.repeat(32)
export const HOST = 'app.example.test'

/** Starts the server on a fixed port with temp dirs; always cleans up. */
export async function withServer(port, options, body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twsvc-'))
  const lines = []
  const extra = typeof options === 'function' ? options(dir) : options
  const cfg = {
    dir: path.join(dir, 'backup'),
    hostedDir: path.join(dir, 'hosted'),
    allowedHosts: [HOST, '127.0.0.1'],
    port,
    log: (line) => lines.push(line),
    hostedMinFreeBytes: 0, // the host disk is whatever it is; the floor has its own test
    ...extra,
  }
  const srv = await startServer(cfg)
  try {
    await body({ srv, dir, cfg, lines, hostedDir: cfg.hostedDir, backupDir: cfg.dir })
  } finally {
    await srv.close()
    await fs.rm(dir, { recursive: true, force: true })
  }
}

/**
 * Raw request with Host set to the app host. `body` may be a string/Buffer, or an array of chunks (chunked upload).
 * Resolves {status, headers, body (Buffer), text, json}.
 */
export function call(port, { method = 'GET', url = '/', headers = {}, body, host = HOST, ip } = {}) {
  return new Promise((resolve, reject) => {
    const h = { Host: host, ...(ip ? { 'X-Forwarded-For': ip } : {}), ...headers }
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: h }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        const text = buf.toString('utf8')
        let json
        try {
          json = JSON.parse(text)
        } catch {
          json = undefined
        }
        resolve({ status: res.statusCode, headers: res.headers, body: buf, text, json })
      })
    })
    req.on('error', reject)
    if (Array.isArray(body)) {
      for (const c of body) req.write(c)
      req.end()
    } else {
      req.end(body)
    }
  })
}

export const hosted = (account, rid) => `/hosted/${account}/rec/${rid}`
export const put = (port, account, rid, token, seconds, body, extra = {}) =>
  call(port, { method: 'PUT', url: hosted(account, rid), headers: { 'X-Write-Token': token, 'X-Seconds': String(seconds), ...extra }, body })
export const getRec = (port, account, rid, headers) => call(port, { url: hosted(account, rid), headers })
export const usage = (port, account, token = T) => call(port, { url: `/hosted/${account}/usage`, headers: { 'X-Write-Token': token } })

/** The upload tmp dir empties shortly after the answer (the handler removes the spool in its finally): wait for it, up to 2 s. */
export async function tmpEmpty(hostedDir) {
  let entries = []
  for (let i = 0; i < 40; i += 1) {
    entries = await fs.readdir(path.join(hostedDir, 'tmp'))
    if (entries.length === 0) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`tmp not empty: ${entries.length} file(s) left`)
}
