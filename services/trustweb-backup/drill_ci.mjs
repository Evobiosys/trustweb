// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// CI restore drill (plan: docs/ops/dlp.md, level 0). node stdlib only; reuses restore_drill.mjs.
//
//   node drill_ci.mjs [--work <empty-dir>] [--seed <text>] [--rto-ms <n>] [--report <file.json>]
//
// 1. build a deterministic synthetic fixture (a BACKUP_DIR look-alike, seeded bytes, example.test hosts)
// 2. snapshot it, restore the snapshot into an empty dir
// 3. diff the restored tree against the fixture byte for byte (independent of the manifest hashes)
// 4. negative control: corrupt a COPY of the snapshot and require verification to notice
// 5. alerting output: GitHub annotations on stdout, a markdown step summary, an optional JSON report; exit 1 on any problem
// Nothing here deletes or overwrites: the work dir must be empty. No file content is printed.

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { snapshotDir, verifySnapshot, restoreSnapshot } from './restore_drill.mjs'

const MAGIC = Buffer.from('TWB1')
const DEFAULT_SEED = 'dlp-ci-fixture-v1'
const DEFAULT_RTO_MS = 4 * 60 * 60 * 1000 // blobs and connect codes: RTO 4 h (docs/ops/dlp.md)
const sha = (s) => crypto.createHash('sha256').update(s).digest()

/** Deterministic pseudo-random bytes from a seed label (sha256 counter stream). */
function bytes(label, n) {
  const parts = []
  for (let i = 0; parts.length * 32 < n; i++) parts.push(sha(`${label}:${i}`))
  return Buffer.concat(parts).subarray(0, n)
}

/** A BACKUP_DIR look-alike. Two blobs, the three JSON stores, and a tmp/ file that a backup must skip. */
export async function buildFixture(dir, seed = DEFAULT_SEED) {
  await fs.mkdir(path.join(dir, 'blobs'), { recursive: true })
  await fs.mkdir(path.join(dir, 'tmp'), { recursive: true })
  for (const i of [1, 2]) {
    const id = sha(`${seed}:blob:${i}`).toString('hex')
    const body = Buffer.concat([MAGIC, sha(`${seed}:token:${i}`), bytes(`${seed}:body:${i}`, 1024 * i)])
    await fs.writeFile(path.join(dir, 'blobs', `${id}.bin`), body)
  }
  const code = sha(`${seed}:code`).toString('hex').slice(0, 12)
  await fs.writeFile(path.join(dir, 'connect.json'), JSON.stringify({ v: 1, codes: { [`canary-${code}`]: { to: 'https://app.example.test/c/canary' } } }))
  await fs.writeFile(path.join(dir, 'links.json'), JSON.stringify({ v: 1, links: { [`canary-${code}`]: { url: 'https://app.example.test/l/canary' } } }))
  await fs.writeFile(path.join(dir, 'organizers.json'), JSON.stringify({ v: 1, organizers: {} }))
  await fs.writeFile(path.join(dir, 'tmp', 'half-written'), 'torn upload')
}

async function files(dir) {
  const out = {}
  const walk = async (rel) => {
    for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(r)
      else out[r] = await fs.readFile(path.join(dir, r))
    }
  }
  await walk('')
  return out
}

/** What a restore must contain: the fixture minus tmp/. Compares bytes, not hashes. */
function diffTrees(fixture, restored) {
  const problems = []
  const want = Object.keys(fixture).filter((k) => !k.startsWith('tmp/'))
  for (const k of want) {
    if (!(k in restored)) problems.push(`diff: missing in restore: ${k}`)
    else if (!fixture[k].equals(restored[k])) problems.push(`diff: bytes differ: ${k}`)
  }
  for (const k of Object.keys(restored)) if (!want.includes(k)) problems.push(`diff: unexpected in restore: ${k}`)
  return { problems, compared: want.length }
}

export async function runCiDrill({ work, seed = DEFAULT_SEED, rtoMs = DEFAULT_RTO_MS, now = () => new Date(), clock = () => Date.now(), hooks = {}, verify = verifySnapshot }) {
  await fs.mkdir(work, { recursive: true, mode: 0o700 })
  if ((await fs.readdir(work)).length > 0) throw new Error(`${work} is not empty`)
  const live = path.join(work, 'live')
  const snap = path.join(work, 'snapshot')
  const restored = path.join(work, 'restored')
  const negctl = path.join(work, 'negctl')
  const problems = []

  await buildFixture(live, seed)
  const manifest = await snapshotDir(live, snap, { now })
  if (hooks.afterSnapshot) await hooks.afterSnapshot(snap)

  const t0 = clock()
  let restoreOk = true
  try {
    await restoreSnapshot(snap, restored)
  } catch (err) {
    restoreOk = false
    problems.push(`restore failed: ${err.message}`)
  }
  const restoreMs = clock() - t0
  if (restoreMs > rtoMs) problems.push(`restore took ${restoreMs} ms, over the RTO of ${rtoMs} ms`)

  let filesCompared = 0
  if (restoreOk) {
    const d = diffTrees(await files(live), await files(restored))
    problems.push(...d.problems)
    filesCompared = d.compared
  }

  // Negative control: a drill that cannot fail proves nothing. Corrupt a copy and require detection.
  await fs.cp(snap, negctl, { recursive: true })
  const victim = Object.keys(manifest.files).find((k) => k.startsWith('blobs/'))
  let detected = false
  if (victim) {
    await fs.appendFile(path.join(negctl, victim), 'x')
    detected = (await verify(negctl)).ok === false
  }
  if (!detected) problems.push('negative control did not fire: verification did not notice a corrupted copy')

  return { ok: problems.length === 0, problems, filesCompared, restoreMs, rtoMs, createdAt: manifest.createdAt, seed, negativeControl: { detected } }
}

const esc = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')

/** GitHub Actions workflow commands: one error annotation per problem, one notice when green. */
export function formatAlerts(r) {
  if (r.ok) return [`::notice title=DLP restore drill passed::${esc(`${r.filesCompared} files restored and diffed clean in ${r.restoreMs} ms`)}`]
  return r.problems.map((p) => `::error title=DLP restore drill failed::${esc(p)}`)
}

/** Markdown for $GITHUB_STEP_SUMMARY, ending in the drill-log row template from docs/ops/dlp.md. */
export function summaryMarkdown(r) {
  const verdict = r.ok ? 'pass' : 'fail'
  const date = String(r.createdAt).slice(0, 10)
  const lines = [`## DLP restore drill: ${verdict}`, '', `Files diffed: ${r.filesCompared}. Restore: ${r.restoreMs} ms (RTO ${r.rtoMs} ms). Fixture seed: \`${r.seed}\` (synthetic).`, '']
  if (!r.ok) lines.push('Problems:', ...r.problems.map((p) => `- ${p}`), '')
  lines.push(
    '| Date | Level | Snapshot ids restored | Elapsed vs RTO | Newest canary age vs RPO | Checksums | Result | Findings and fixes | Operator |',
    '|---|---|---|---|---|---|---|---|---|',
    `| ${date} | 0 (CI fixture) | fixture | ${r.restoreMs} ms / ${r.rtoMs} ms | n/a (fixture) | ${r.ok ? 'match' : 'mismatch'} | ${verdict} | ${r.ok ? '' : r.problems.length + ' problem(s), see log'} | CI |`,
    '',
  )
  return lines.join('\n')
}

function parseArgs(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]
    if (!['--work', '--seed', '--rto-ms', '--report'].includes(k) || argv[i + 1] === undefined) throw new Error(`usage: drill_ci.mjs [--work dir] [--seed s] [--rto-ms n] [--report file]`)
    o[k.slice(2)] = argv[i + 1]
  }
  return o
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const a = parseArgs(process.argv.slice(2))
    const work = a.work ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'twci-drill-')))
    const r = await runCiDrill({ work, seed: a.seed, rtoMs: a['rto-ms'] === undefined ? undefined : Number(a['rto-ms']) })
    for (const l of formatAlerts(r)) console.log(l)
    if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(r) + '\n')
    if (a.report) await fs.writeFile(a.report, JSON.stringify(r, null, 2), { mode: 0o600 })
    console.log(JSON.stringify(r))
    process.exit(r.ok ? 0 : 1)
  } catch (err) {
    console.log(`::error title=DLP restore drill failed::${esc(err.message)}`)
    process.exit(1)
  }
}
