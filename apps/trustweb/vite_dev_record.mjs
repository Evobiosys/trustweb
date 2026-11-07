// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Dev only: GET/POST /__tw/dev-record, the record every personal preview shares through ~/.cache/trustweb-dev/dev-record.live.json
// (src/dev_record_live.ts). Loopback Host only, no foreign Origin; the original dev-record.path file is never touched.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const KEEP = 10
const SNAP = /^dev-record\.live\.(\d+)\.json$/

const loopback = (h) => /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(h.host ?? '') && (!h.origin || new URL(h.origin).host === h.host)
const atHeader = (file) => ({ 'X-TW-Live-At': String(Math.floor(statSync(file).mtimeMs)) })

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

/** { code, headers, body } for one request; `body` is the request body of a POST. */
export function liveRecordReply(file, method, headers, body, { gapMs = 60_000 } = {}) {
  if (!loopback(headers)) return { code: 403, headers: {}, body: '' }
  if (method === 'GET') return existsSync(file) ? { code: 200, headers: atHeader(file), body: readFileSync(file, 'utf8') } : { code: 404, headers: {}, body: '' }
  if (method !== 'POST') return { code: 405, headers: {}, body: '' }
  try {
    const r = JSON.parse(body)
    if (r?.v !== 1 || !Array.isArray(r.people)) throw new Error('not a record')
    mkdirSync(path.dirname(file), { recursive: true })
    if (existsSync(file)) snapshot(file, gapMs)
    const tmp = file + '.tmp'
    writeFileSync(tmp, body)
    renameSync(tmp, file)
    return { code: 200, headers: atHeader(file), body: '' }
  } catch { return { code: 400, headers: {}, body: '' } }
}
