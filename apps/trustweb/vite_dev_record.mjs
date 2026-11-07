// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Dev only: GET/POST /__tw/dev-record, the record every personal preview shares through ~/.cache/trustweb-dev/dev-record.live.json
// (src/dev_record_live.ts). Loopback Host only, no foreign Origin; the original dev-record.path file is never touched.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const KEEP = 10
const SNAP = /^dev-record\.live\.(\d+)\.json$/

const sameOrigin = (h) => { try { return new URL(h.origin).host === h.host } catch { return false } }
const loopback = (h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h.host ?? '') && (!h.origin || sameOrigin(h))
/** The client itself must be this machine: with tw_dev.sh --lan the Host header alone is the client's word. */
const localClient = (remote) => /^(127\.\d+\.\d+\.\d+|::1|::ffff:127\.\d+\.\d+\.\d+)$/.test(remote ?? '')
const mtimeOf = (file) => Math.floor(statSync(file).mtimeMs)
const atHeader = (file) => ({ 'X-TW-Live-At': String(mtimeOf(file)) })

/** Copies the current live file to dev-record.live.<ts>.json (at most one per gapMs) and moves versions beyond the newest KEEP to dev-record.live.archive/. */
function snapshot(file, gapMs) {
  const dir = path.dirname(file)
  const snaps = () => readdirSync(dir).filter((n) => SNAP.test(n)).sort((a, b) => Number(a.match(SNAP)[1]) - Number(b.match(SNAP)[1]))
  const last = snaps().pop()
  const now = Date.now()
  if (gapMs > 0 && last && now - Number(last.match(SNAP)[1]) < gapMs) return
  let ts = now
  while (existsSync(path.join(dir, `dev-record.live.${ts}.json`))) ts++
  copyFileSync(file, path.join(dir, `dev-record.live.${ts}.json`))
  const old = snaps().slice(0, -KEEP)
  if (!old.length) return
  const archive = path.join(dir, 'dev-record.live.archive')
  mkdirSync(archive, { recursive: true })
  for (const n of old) renameSync(path.join(dir, n), path.join(archive, n))
}

/**
 * { code, headers, body } for one request; `body` is the request body of a POST, `remote` the socket's address. A POST carrying
 * X-TW-Live-Base (the file time that tab last saw) older than the file is a stale tab: 409, the newer record stays.
 */
export function liveRecordReply(file, method, headers, body, { gapMs = 60_000, remote = '127.0.0.1' } = {}) {
  if (!localClient(remote) || !loopback(headers)) return { code: 403, headers: {}, body: '' }
  if (method === 'GET') return existsSync(file) ? { code: 200, headers: atHeader(file), body: readFileSync(file, 'utf8') } : { code: 404, headers: {}, body: '' }
  if (method !== 'POST') return { code: 405, headers: {}, body: '' }
  try {
    const r = JSON.parse(body)
    if (r?.v !== 1 || !Array.isArray(r.people)) throw new Error('not a record')
    const base = headers['x-tw-live-base']
    if (base !== undefined && existsSync(file) && !(Number(base) >= mtimeOf(file))) return { code: 409, headers: atHeader(file), body: '' }
    mkdirSync(path.dirname(file), { recursive: true })
    if (existsSync(file)) snapshot(file, gapMs)
    const tmp = file + '.tmp'
    writeFileSync(tmp, body)
    renameSync(tmp, file)
    return { code: 200, headers: atHeader(file), body: '' }
  } catch { return { code: 400, headers: {}, body: '' } }
}
