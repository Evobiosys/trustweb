// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 mcp-local: the optional HTTP mode (POST one JSON-RPC message, get the answer). Local only: the caller must be this machine,
 * the Host header must name the loopback (DNS rebinding), any Origin header is refused (a web page is never the client; an MCP
 * client program sends none), and a bearer token is required. Checks run in that order, so a foreign page learns nothing about the token.
 */
import { timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'

export interface Req { method?: string; host?: string; origin?: string; remote?: string; authorization?: string }

const LOOPBACK_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/
const LOOPBACK_REMOTE = /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/
const MIN_TOKEN = 16
const MAX_BODY = 1_000_000

/** null = let it through, else the status to send. */
export function checkRequest(r: Req, token: string): { code: number } | null {
  if (!LOOPBACK_REMOTE.test(r.remote ?? '')) return { code: 403 }
  if (!LOOPBACK_HOST.test(r.host ?? '')) return { code: 403 }
  if (r.origin !== undefined) return { code: 403 }
  if (r.method !== 'POST') return { code: 405 }
  const given = Buffer.from((r.authorization ?? '').replace(/^Bearer /, ''))
  const want = Buffer.from(token)
  if (!(r.authorization ?? '').startsWith('Bearer ') || given.length !== want.length || !timingSafeEqual(given, want)) return { code: 401 }
  return null
}

/** The server is not listening yet: the caller binds it to 127.0.0.1. */
export function createHttpServer(handle: (line: string) => Promise<string | undefined>, token: string): Server {
  if (token.length < MIN_TOKEN) throw new Error(`HTTP mode needs a token of at least ${MIN_TOKEN} characters (TW_MCP_TOKEN)`)
  return createServer((req, res) => {
    const denied = checkRequest({ method: req.method, host: req.headers.host, origin: req.headers.origin, remote: req.socket.remoteAddress, authorization: req.headers.authorization }, token)
    if (denied) { res.writeHead(denied.code).end(); return }
    // Review wave 40: chunks are kept as bytes and decoded once (a character split across two chunks stays whole); the cap counts bytes.
    const chunks: Buffer[] = []
    let size = 0
    let tooBig = false
    req.on('data', (c: Buffer) => {
      if (tooBig) return
      size += c.length
      chunks.push(c)
      if (size > MAX_BODY) { tooBig = true; res.writeHead(413, { connection: 'close' }).end(); req.destroy() }
    })
    req.on('end', () => {
      if (tooBig) return
      void handle(Buffer.concat(chunks).toString('utf8')).then((out) => {
        if (out === undefined) res.writeHead(202).end()
        else res.writeHead(200, { 'content-type': 'application/json' }).end(out)
      })
    })
  })
}
