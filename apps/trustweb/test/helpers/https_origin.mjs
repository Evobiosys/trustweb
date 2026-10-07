/**
 * Makes the loopback app look like a real app origin for an e2e: https://<host>/ in the browser (default
 * app.trustintheweb.org), served by a TLS front on 127.0.0.1 that sends /link and /l/<id> to the short-link service
 * and /backup (services/trustweb-backup, or any http target) and everything else, websockets included, to the Vite dev server.
 *
 * The browser reaches it with Chromium's own resolver rule (no hosts file, no system change):
 *   launch(origin.browserArgs)  +  browser.newContext({ ignoreHTTPSErrors: true })
 * The certificate is a throwaway self-signed one made with the openssl on the PATH into a temp directory, removed on stop().
 * Loopback only; nothing here is reachable from outside this machine.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

/** What goes to the service: the short-link routes, and /backup (a meeting's pack for the Meet code) where a test wants it. */
const SERVICE_PREFIXES = ['/link', '/l/', '/backup']

/**
 * @param {object} o
 * @param {number} o.port        where the TLS front listens (loopback)
 * @param {number} o.appPort     the Vite dev server
 * @param {number} [o.servicePort] the short-link service; without it /link and /l/ answer 404 (a test stubs them in the browser)
 * @param {string} [o.host]
 */
export async function startHttpsOrigin({ port, appPort, servicePort, host = 'app.trustintheweb.org' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'tw-https-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host}`,
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' })
  const key = readFileSync(path.join(dir, 'k.pem'))
  const cert = readFileSync(path.join(dir, 'c.pem'))

  const isShort = (url) => SERVICE_PREFIXES.some((p) => url === p || url.startsWith(p))
  const forward = (req, res) => {
    const toService = isShort(req.url ?? '')
    if (toService && !servicePort) { res.writeHead(404); res.end(); return }
    const targetPort = toService ? servicePort : appPort
    // the service sees the real Host (it checks it); Vite gets its own, or its host check answers 403
    const headers = { ...req.headers, host: toService ? host : `127.0.0.1:${appPort}` }
    const up = http.request({ host: '127.0.0.1', port: targetPort, method: req.method, path: req.url, headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(res)
    })
    up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end() })
    req.pipe(up)
  }
  const server = https.createServer({ key, cert }, forward)
  const sockets = new Set()
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(appPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries({ ...req.headers, host: `127.0.0.1:${appPort}` }).map(([k, v]) => `${k}: ${v}`), '', '']
      up.write(lines.join('\r\n'))
      if (head?.length) up.write(head)
      socket.pipe(up).pipe(socket)
    })
    sockets.add(socket); sockets.add(up)
    const drop = () => { socket.destroy(); up.destroy() }
    up.on('error', drop); socket.on('error', drop)
  })
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve))
  return {
    origin: `https://${host}`,
    browserArgs: [`--host-resolver-rules=MAP ${host} 127.0.0.1:${port}`],
    async stop() {
      for (const s of sockets) s.destroy()
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
      rmSync(dir, { recursive: true, force: true })
    },
  }
}
