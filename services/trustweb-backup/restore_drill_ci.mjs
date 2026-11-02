// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Level 0 restore drill for CI (docs/ops/dlp.md, "Restore drills"): the real server, a synthetic fixture, the real drill. node stdlib only.
//
//   node restore_drill_ci.mjs [--work <dir>] [--report <file>] [--summary <file>] [--keep]
//
// Five checks, in order:
//   fixture  start the server on <work>/live, PUT one blob of 4096 random bytes as a phone would, mint one connect code (POST /connect)
//            and one short link (POST /link) so connect.json and links.json exist, close the server
//   drill    runDrill (restore_drill.mjs): snapshot + verify + restore into <work>/drill/restored
//   diff     independent of the manifest: same relative file list (tmp/ skipped) and the same sha256 per file
//   serve    a fresh server on the restored copy: GET /backup/<id> 200 and byte-identical, PUT with the ORIGINAL token 204 (same body, so
//            the restored tree stays equal to live), GET /c/<code> and GET /l/<id> 302
//   control  negative control: a copy of the snapshot with one byte appended must fail verifySnapshot (hash mismatch) and restoreSnapshot
// Then: JSON report (default <work>/report.json), Markdown to $GITHUB_STEP_SUMMARY and/or --summary (appended), ok/problems/report to
// $GITHUB_OUTPUT, ::notice / ::error and one "  ok   " / "  FAIL " line per check on stdout. Exit 0 pass, 1 any problem, 2 usage error.
// Without --work a temp dir is used and removed at the end (unless --keep); the report then also goes to stdout as "report: <json>".
// Test hook: TW_DRILL_FAULT=bitrot (append a byte to the restored blob) or =missing (remove a restored JSON store), after drill, before diff.
//
// Never: deletes or overwrites anything outside the work dir (a non-empty --work and an existing --report are refused with exit 2), prints
// or stores the id, the token, the code, the link id or any file content (counts only; a 64-hex blob name is redacted to <id>), touches
// production data (I1: the fixture is random bytes on app.example.test).

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { runDrill, verifySnapshot, restoreSnapshot } from './restore_drill.mjs'
import { startServer } from './server.mjs'

export const CHECKS = ['fixture', 'drill', 'diff', 'serve', 'control']
export const LEVEL = '0 automated (CI fixture)'
const HOST = 'app.example.test'
const RTO_MS = 4 * 3_600_000 // docs/ops/dlp.md targets: RTO 4 h for connect codes and blobs
const BLOB_BYTES = 4096
const STORES = ['connect.json', 'links.json', 'organizers.json']

/** Blob names are 64-hex ids: never let one reach a log. */
export const redact = (s) => String(s).replace(/[0-9a-f]{64}/gi, '<id>')

// Every path option set, so no env var of the runner (HOSTED_DIR, LINKS_FILE, ...) moves a file outside the work dir.
const serverOpts = (dir) => ({
  dir, port: 0, host: '127.0.0.1', allowedHosts: [HOST], linkHosts: [HOST], hostedDir: '', linksFile: '', connectFile: '', feedbackFile: '',
  subscriberUrl: '', log: () => {}, hostedMinFreeBytes: 0,
})

function request(port, { method = 'GET', url, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: { Host: HOST, Connection: 'close', ...headers } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end(body)
  })
}
const postJson = async (port, url, obj) => {
  const r = await request(port, { method: 'POST', url, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })
  let json = null
  try { json = JSON.parse(r.body.toString('utf8')) } catch { /* not JSON */ }
  return { status: r.status, json }
}

/** Sorted relative posix paths of every file under `dir`, top-level tmp/ skipped. A missing dir is an empty list. */
async function walk(dir, rel = '') {
  let entries
  try {
    entries = await fs.readdir(path.join(dir, rel), { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const out = []
  for (const e of entries) {
    const r = rel === '' ? e.name : `${rel}/${e.name}`
    if (r === 'tmp') continue
    if (e.isDirectory()) out.push(...(await walk(dir, r)))
    else out.push(r)
  }
  return out.sort()
}
const sha = async (file) => crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex')

/** Independent tree compare: missing / extra files and differing sha256 are problems. {ok, files (in live), problems}. */
export async function diffDirs(liveDir, restoredDir) {
  const [a, b] = [await walk(liveDir), await walk(restoredDir)]
  const inB = new Set(b)
  const problems = []
  for (const rel of a) {
    if (!inB.has(rel)) problems.push(`missing in restored: ${redact(rel)}`)
    else if ((await sha(path.join(liveDir, rel))) !== (await sha(path.join(restoredDir, rel)))) problems.push(`restored file differs: ${redact(rel)}`)
  }
  const inA = new Set(a)
  for (const rel of b) if (!inA.has(rel)) problems.push(`extra in restored: ${redact(rel)}`)
  return { ok: problems.length === 0, files: a.length, problems }
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** The Markdown step summary: heading, the checks table, the restore time, one drill-log row (columns of docs/ops/dlp.md "Drill log"). */
export function renderSummary(report) {
  const ok = (name) => report.checks.find((c) => c.name === name)?.ok === true
  const ms = report.restoreMs ?? 'n/a'
  const findings = report.problems.length === 0 ? 'none' : report.problems.join('; ')
  return [
    '## DLP restore drill (level 0, CI fixture)',
    '',
    '| Check | Result | Detail |',
    '|---|---|---|',
    ...report.checks.map((c) => `| ${c.name} | ${c.ok ? '✅' : '❌'} | ${cell(c.detail)} |`),
    '',
    `restore ${ms} ms (target 4 h)`,
    '',
    'Drill log row (docs/ops/dlp.md):',
    '',
    '| Date | Level | Snapshot ids restored | Elapsed vs RTO | Newest canary age vs RPO | Checksums | Result | Findings and fixes | Operator |',
    '|---|---|---|---|---|---|---|---|---|',
    `| ${report.startedAt.slice(0, 10)} | ${LEVEL} | ci-fixture | ${ms} ms / 4 h | n/a (fixture, RPO not measured) | ${ok('diff') ? 'match' : 'mismatch'} | ${report.ok ? 'pass' : 'fail'} | ${cell(findings)} | github-actions |`,
    '',
  ].join('\n')
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

/** Runs the five checks in <work> (which must be empty). Returns the report; never throws for a failed check. */
export async function runCiDrill({ work, fault = '', env = process.env, now = () => new Date() }) {
  const t0 = now()
  const live = path.join(work, 'live')
  const drillDir = path.join(work, 'drill')
  const restored = path.join(drillDir, 'restored')
  const checks = []
  const problems = []
  const record = (name, found, okDetail) => {
    const p = found.map(redact)
    checks.push({ name, ok: p.length === 0, detail: p.length === 0 ? okDetail : p.join('; ') })
    for (const x of p) problems.push(`${name}: ${x}`)
  }
  const attempt = async (name, fn) => {
    try {
      const { found, detail } = await fn()
      record(name, found, detail)
    } catch (err) {
      record(name, [err.message || String(err)], '')
    }
  }

  const id = crypto.randomBytes(32).toString('hex')
  const token = crypto.randomBytes(32).toString('hex')
  const body = crypto.randomBytes(BLOB_BYTES)
  let code = null
  let linkId = null
  let stores = []
  let restoreMs = null
  let files = 0

  await attempt('fixture', async () => {
    const found = []
    await fs.mkdir(live, { recursive: true, mode: 0o700 })
    const srv = await startServer(serverOpts(live))
    try {
      const put = await request(srv.port, { method: 'PUT', url: `/backup/${id}`, headers: { 'X-Write-Token': token }, body })
      if (put.status !== 204) found.push(`PUT /backup answered ${put.status}, expected 204`)
      const longUrl = `https://${HOST}/?connect=did%3Apeer%3A2.${crypto.randomBytes(16).toString('base64url')}&id=ci-fixture`
      const c = await postJson(srv.port, '/connect', { url: longUrl })
      if (c.status === 201 && typeof c.json?.code === 'string') code = c.json.code
      else found.push(`POST /connect answered ${c.status}, expected 201`)
      const l = await postJson(srv.port, '/link', { url: longUrl })
      if ((l.status === 201 || l.status === 200) && typeof l.json?.id === 'string') linkId = l.json.id
      else found.push(`POST /link answered ${l.status}, expected 201`)
    } finally {
      await srv.close()
    }
    for (const s of STORES) if (await exists(path.join(live, s))) stores.push(s)
    return { found, detail: `1 record, ${BLOB_BYTES} bytes, stores ${stores.join(', ') || 'none'}` }
  })
  const fixtureOk = checks[0].ok

  await attempt('drill', async () => {
    if (!fixtureOk) return { found: ['skipped: no fixture'] }
    const r = await runDrill({ live, work: drillDir, now })
    restoreMs = r.restoreMs
    files = r.files
    return { found: r.problems, detail: `${r.files} files snapshotted, verified and restored in ${r.restoreMs} ms` }
  })

  if (fault === 'bitrot') await fs.appendFile(path.join(restored, 'blobs', `${id}.bin`), Buffer.from([0x21])).catch(() => {})
  if (fault === 'missing') {
    const victim = (await exists(path.join(restored, 'connect.json'))) ? 'connect.json' : (await exists(path.join(restored, 'links.json'))) ? 'links.json' : `blobs/${id}.bin`
    await fs.rm(path.join(restored, victim), { force: true })
  }

  await attempt('diff', async () => {
    const d = await diffDirs(live, restored)
    return { found: d.problems, detail: `${d.files} files, same list, sha256 match` }
  })

  await attempt('serve', async () => {
    if (!fixtureOk) return { found: ['skipped: no fixture'] }
    const found = []
    const srv = await startServer(serverOpts(restored))
    try {
      const got = await request(srv.port, { url: `/backup/${id}` })
      if (got.status !== 200) found.push(`GET /backup answered ${got.status}, expected 200`)
      else if (!got.body.equals(body)) found.push('GET /backup bytes differ from the fixture')
      const put = await request(srv.port, { method: 'PUT', url: `/backup/${id}`, headers: { 'X-Write-Token': token }, body })
      if (put.status !== 204) found.push(`PUT /backup with the original token answered ${put.status}, expected 204`)
      if (code !== null) {
        const c = await request(srv.port, { url: `/c/${code}` })
        if (c.status !== 302) found.push(`GET /c/<code> answered ${c.status}, expected 302`)
      }
      if (linkId !== null) {
        const l = await request(srv.port, { url: `/l/${linkId}` })
        if (l.status !== 302) found.push(`GET /l/<id> answered ${l.status}, expected 302`)
      }
    } finally {
      await srv.close()
    }
    const what = ['GET 200 byte-identical', 'PUT original token 204', ...(code !== null ? ['GET /c 302'] : []), ...(linkId !== null ? ['GET /l 302'] : [])]
    return { found, detail: what.join(', ') }
  })

  await attempt('control', async () => {
    const snap = path.join(drillDir, 'snapshot')
    const copy = path.join(drillDir, 'control')
    await fs.cp(snap, copy, { recursive: true, errorOnExist: true, force: false })
    const manifest = JSON.parse(await fs.readFile(path.join(copy, 'MANIFEST.json'), 'utf8'))
    const first = Object.keys(manifest.files ?? {})[0]
    if (first === undefined) return { found: ['negative control: the snapshot holds no file to tamper with'] }
    await fs.appendFile(path.join(copy, first), Buffer.from([0x21]))
    const v = await verifySnapshot(copy)
    if (v.ok || !v.problems.some((p) => p.includes('hash mismatch'))) return { found: ['negative control: tampering was not detected'] }
    const rejected = await restoreSnapshot(copy, path.join(drillDir, 'control-restored')).then(() => false, () => true)
    if (!rejected) return { found: ['negative control: a tampered snapshot was restored'] }
    return { found: [], detail: 'one byte appended to a snapshot copy: hash mismatch noticed, restore refused' }
  })

  const t1 = now()
  const g = (k) => env[k] || null
  return {
    v: 1,
    ok: problems.length === 0,
    startedAt: t0.toISOString(),
    finishedAt: t1.toISOString(),
    durationMs: t1 - t0,
    restoreMs,
    files,
    level: LEVEL,
    fixture: { blobBytes: BLOB_BYTES, stores },
    checks,
    problems,
    rto: { targetMs: RTO_MS, withinTarget: restoreMs !== null && restoreMs <= RTO_MS },
    run: { repository: g('GITHUB_REPOSITORY'), runId: g('GITHUB_RUN_ID'), sha: g('GITHUB_SHA'), ref: g('GITHUB_REF'), eventName: g('GITHUB_EVENT_NAME') },
    runner: { node: process.version, platform: process.platform },
  }
}

async function main(argv, env) {
  const usage = (msg) => {
    console.error(`${msg}\nusage: restore_drill_ci.mjs [--work <dir>] [--report <file>] [--summary <file>] [--keep]`)
    return 2
  }
  let values
  try {
    ;({ values } = parseArgs({ args: argv, options: { work: { type: 'string' }, report: { type: 'string' }, summary: { type: 'string' }, keep: { type: 'boolean' } } }))
  } catch (err) {
    return usage(err.message)
  }
  const fault = env.TW_DRILL_FAULT ?? ''
  if (!['', 'bitrot', 'missing'].includes(fault)) return usage(`TW_DRILL_FAULT must be bitrot or missing, not ${fault}`)
  if (values.work !== undefined) {
    const names = await fs.readdir(values.work).catch((err) => (err.code === 'ENOENT' ? [] : Promise.reject(err)))
    if (names.length > 0) return usage(`${values.work} is not empty (refused; nothing was changed)`)
  }
  if (values.report !== undefined && (await exists(values.report))) return usage(`${values.report} exists (refused; a report is never overwritten)`)

  const temp = values.work === undefined
  const work = path.resolve(temp ? await fs.mkdtemp(path.join(os.tmpdir(), 'dlp-drill-')) : values.work)
  await fs.mkdir(work, { recursive: true, mode: 0o700 })
  const reportPath = path.resolve(values.report ?? path.join(work, 'report.json'))

  const report = await runCiDrill({ work, fault, env })
  const json = JSON.stringify(report, null, 2)
  await fs.writeFile(reportPath, `${json}\n`, { flag: 'wx', mode: 0o600 })
  const md = renderSummary(report)
  for (const file of [env.GITHUB_STEP_SUMMARY, values.summary]) if (file) await fs.appendFile(file, md)
  if (env.GITHUB_OUTPUT) await fs.appendFile(env.GITHUB_OUTPUT, `ok=${report.ok}\nproblems=${report.problems.length}\nreport=${reportPath}\n`)

  if (fault) console.log(`TW_DRILL_FAULT=${fault} (test hook): the restored copy was damaged on purpose after the drill step`)
  for (const c of report.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}: ${c.detail}`)
  if (report.ok) console.log(`::notice title=DLP restore drill passed::files=${report.files} restoreMs=${report.restoreMs}`)
  else console.log(`::error title=DLP restore drill failed::${report.problems.length} problem(s): ${report.problems.join('; ').replace(/%/g, '%25')}`)
  if (temp && !values.keep) {
    await fs.rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 })
    if (reportPath.startsWith(work + path.sep)) console.log(`report: ${JSON.stringify(report)}`)
  } else if (temp) console.log(`work dir kept: ${work}`)
  return report.ok ? 0 : 1
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env).then(
    (code) => process.exit(code),
    (err) => {
      console.error(redact(err.message))
      process.exit(1)
    },
  )
}
