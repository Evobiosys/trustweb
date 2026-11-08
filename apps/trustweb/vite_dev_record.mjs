// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Dev only: GET/POST /__tw/dev-record, the record every personal preview shares through ~/.cache/trustweb-dev/dev-record.live.json
// (src/dev_record_live.ts). Loopback Host only, no foreign Origin; the original dev-record.path file is never touched.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { diffRecords } from './src/record_diff.ts'

const KEEP = 10
const EDITS_MAX = 5_000_000
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

const editsName = (file) => path.join(path.dirname(file), 'dev-edits.jsonl')
const rotated = (editsFile) => {
  const dir = path.dirname(editsFile)
  return readdirSync(dir).filter((n) => /^dev-edits\.\d{4}-\d{2}-\d{2}.*\.jsonl$/.test(n)).map((n) => path.join(dir, n)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs) // review: by age (a name sort puts -2 before the day's first file)
}

/** Edit stream (src/record_diff.ts): appends one line per edit between the stored record and the posted one. Past maxBytes the file moves, whole, to dev-edits.<date>[-n].jsonl first; lines are never rewritten. A failure never blocks the record write. */
function appendEdits(editsFile, prevText, nextRec, previewId, maxBytes) {
  try {
    const edits = diffRecords(JSON.parse(prevText), nextRec, { at: new Date().toISOString(), previewId })
    if (!edits.length) return
    mkdirSync(path.dirname(editsFile), { recursive: true })
    if (existsSync(editsFile) && statSync(editsFile).size > maxBytes) {
      const day = new Date().toISOString().slice(0, 10)
      let to = path.join(path.dirname(editsFile), `dev-edits.${day}.jsonl`)
      for (let n = 2; existsSync(to); n++) to = path.join(path.dirname(editsFile), `dev-edits.${day}-${n}.jsonl`)
      renameSync(editsFile, to)
    }
    appendFileSync(editsFile, edits.map((e) => JSON.stringify(e) + '\n').join(''))
  } catch (e) { console.warn('dev edits: could not be appended:', e?.message) }
}

/** { count, since }: edits kept in the stream and its rotated files, and the time of the oldest one (null when none). */
export function editStreamInfo(editsFile) {
  const files = [...(existsSync(path.dirname(editsFile)) ? rotated(editsFile) : []), editsFile].filter(existsSync)
  let count = 0
  let since = null
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean)
    count += lines.length
    if (since === null && lines.length) since = JSON.parse(lines[0]).at ?? null
  }
  return { count, since }
}

/** GET /__tw/dev-edits: { count, since } of the edit stream beside `file`. Same loopback guards as the record. */
export function editStreamReply(file, method, headers, { remote = '127.0.0.1', editsFile = editsName(file) } = {}) {
  if (!localClient(remote) || !loopback(headers)) return { code: 403, body: '' }
  if (method !== 'GET') return { code: 405, body: '' }
  return { code: 200, body: JSON.stringify(editStreamInfo(editsFile)) }
}

/**
 * { code, headers, body } for one request; `body` is the request body of a POST, `remote` the socket's address. A POST carrying
 * X-TW-Live-Base (the file time that tab last saw) older than the file is a stale tab: 409, the newer record stays.
 */
export function liveRecordReply(file, method, headers, body, { gapMs = 60_000, remote = '127.0.0.1', editsFile = editsName(file), maxBytes = EDITS_MAX } = {}) {
  if (!localClient(remote) || !loopback(headers)) return { code: 403, headers: {}, body: '' }
  if (method === 'GET') return existsSync(file) ? { code: 200, headers: atHeader(file), body: readFileSync(file, 'utf8') } : { code: 404, headers: {}, body: '' }
  if (method !== 'POST') return { code: 405, headers: {}, body: '' }
  try {
    const r = JSON.parse(body)
    if (r?.v !== 1 || !Array.isArray(r.people)) throw new Error('not a record')
    const base = headers['x-tw-live-base']
    if (base !== undefined && existsSync(file) && !(Number(base) >= mtimeOf(file))) return { code: 409, headers: atHeader(file), body: '' }
    mkdirSync(path.dirname(file), { recursive: true })
    if (existsSync(file)) {
      appendEdits(editsFile, readFileSync(file, 'utf8'), r, headers.host, maxBytes)
      snapshot(file, gapMs)
    }
    const tmp = file + '.tmp'
    writeFileSync(tmp, body)
    renameSync(tmp, file)
    return { code: 200, headers: atHeader(file), body: '' }
  } catch { return { code: 400, headers: {}, body: '' } }
}
