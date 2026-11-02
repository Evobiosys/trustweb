// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// CI restore drill (docs/ops/dlp.md): fixture -> backup -> restore -> diff, negative control, alerts, workflow wiring.
// Synthetic data only: seeded pseudo-random bytes and example.test hosts, no person's data.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFixture, runCiDrill, formatAlerts, summaryMarkdown } from '../drill_ci.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, '..', 'drill_ci.mjs')
const WORKFLOW = path.join(HERE, '..', '..', '..', '.github', 'workflows', 'dlp-drill.yml')

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'twci-'))
const cleanup = (d) => fs.rm(d, { recursive: true, force: true })
const NOW = () => new Date('2026-11-01T05:00:00Z')

async function tree(dir) {
  const out = {}
  const walk = async (rel) => {
    for (const e of await fs.readdir(path.join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(r)
      else out[r] = (await fs.readFile(path.join(dir, r))).toString('hex')
    }
  }
  await walk('')
  return out
}

test('fixture is deterministic per seed, differs across seeds, and includes a tmp/ file the drill must skip', async () => {
  const [a, b, c] = [await tmp(), await tmp(), await tmp()]
  try {
    await buildFixture(a, 'seed-one')
    await buildFixture(b, 'seed-one')
    await buildFixture(c, 'seed-two')
    const ta = await tree(a)
    assert.deepEqual(ta, await tree(b))
    assert.notDeepEqual(ta, await tree(c))
    assert.ok(Object.keys(ta).some((k) => k.startsWith('blobs/') && k.endsWith('.bin')))
    assert.ok(Object.keys(ta).includes('connect.json'))
    assert.ok(Object.keys(ta).some((k) => k.startsWith('tmp/')))
  } finally {
    await Promise.all([a, b, c].map(cleanup))
  }
})

test('drill passes: restored tree equals the fixture byte for byte, tmp/ is not restored, negative control fires', async () => {
  const work = await tmp()
  try {
    const r = await runCiDrill({ work, now: NOW })
    assert.deepEqual(r.problems, [])
    assert.equal(r.ok, true)
    assert.ok(r.filesCompared >= 4)
    assert.equal(r.negativeControl.detected, true)
    assert.equal(typeof r.restoreMs, 'number')
    const restored = await tree(path.join(work, 'restored'))
    assert.ok(!Object.keys(restored).some((k) => k.startsWith('tmp/')))
    // the negative control works on a copy: the real snapshot still verifies
    const snap = await tree(path.join(work, 'snapshot'))
    assert.ok(Object.keys(snap).includes('MANIFEST.json'))
  } finally {
    await cleanup(work)
  }
})

test('drill fails and says why when the backup is corrupted after it was taken', async () => {
  const work = await tmp()
  try {
    const afterSnapshot = async (snap) => {
      const blob = (await fs.readdir(path.join(snap, 'blobs')))[0]
      await fs.appendFile(path.join(snap, 'blobs', blob), 'rot')
    }
    const r = await runCiDrill({ work, now: NOW, hooks: { afterSnapshot } })
    assert.equal(r.ok, false)
    assert.ok(r.problems.some((p) => /restore failed/.test(p) && /hash mismatch/.test(p)), r.problems.join('|'))
  } finally {
    await cleanup(work)
  }
})

test('drill fails when the restore exceeds the RTO (fake clock, no sleeping)', async () => {
  const work = await tmp()
  try {
    let t = 0
    const clock = () => (t += 5 * 60 * 1000)
    const r = await runCiDrill({ work, now: NOW, clock, rtoMs: 60 * 1000 })
    assert.equal(r.ok, false)
    assert.ok(r.problems.some((p) => /RTO/.test(p)), r.problems.join('|'))
    assert.equal(r.restoreMs, 5 * 60 * 1000)
  } finally {
    await cleanup(work)
  }
})

test('drill fails when verification is blind: a negative control that does not fire is a failed drill', async () => {
  const work = await tmp()
  try {
    const r = await runCiDrill({ work, now: NOW, verify: async () => ({ ok: true, problems: [], files: 0 }) })
    assert.equal(r.ok, false)
    assert.equal(r.negativeControl.detected, false)
    assert.ok(r.problems.some((p) => /negative control/.test(p)))
  } finally {
    await cleanup(work)
  }
})

test('drill refuses a non-empty work dir (never overwrites)', async () => {
  const work = await tmp()
  try {
    await fs.writeFile(path.join(work, 'keep'), 'x')
    await assert.rejects(runCiDrill({ work, now: NOW }), /not empty/)
    assert.equal(await fs.readFile(path.join(work, 'keep'), 'utf8'), 'x')
  } finally {
    await cleanup(work)
  }
})

test('alerts: GitHub annotations, escaped, one per problem; a notice when green', () => {
  const bad = formatAlerts({ ok: false, problems: ['a: 100%\nsecond line', 'b'], restoreMs: 1 })
  assert.equal(bad.length, 2)
  assert.ok(bad.every((l) => l.startsWith('::error title=DLP restore drill failed::')))
  assert.ok(bad[0].includes('100%25%0Asecond line'))
  assert.ok(!bad[0].includes('\n'))
  const good = formatAlerts({ ok: true, problems: [], restoreMs: 12, filesCompared: 5 })
  assert.equal(good.length, 1)
  assert.ok(good[0].startsWith('::notice title=DLP restore drill passed::'))
})

test('summary has the drill-log row from docs/ops/dlp.md and the verdict', () => {
  const md = summaryMarkdown({ ok: true, problems: [], restoreMs: 12, filesCompared: 5, rtoMs: 4 * 3600e3, createdAt: '2026-11-01T05:00:00.000Z', seed: 's' })
  assert.match(md, /\| 2026-11-01 \| 0 \(CI fixture\) \|/)
  assert.match(md, /pass/)
  const bad = summaryMarkdown({ ok: false, problems: ['x'], restoreMs: 1, filesCompared: 0, rtoMs: 1, createdAt: '2026-11-01T05:00:00.000Z', seed: 's' })
  assert.match(bad, /fail/)
  assert.match(bad, /- x/)
})

test('CLI: exit 0 with annotations, a JSON line and a step summary; exit 1 when the RTO cannot be met', async () => {
  const work = await tmp()
  const out = await tmp()
  try {
    const summary = path.join(out, 'summary.md')
    const env = { ...process.env, GITHUB_STEP_SUMMARY: summary }
    const ok = spawnSync(process.execPath, [SCRIPT, '--work', path.join(work, 'a'), '--report', path.join(out, 'r.json')], { env, encoding: 'utf8' })
    assert.equal(ok.status, 0, ok.stderr)
    assert.match(ok.stdout, /::notice title=DLP restore drill passed::/)
    assert.equal(JSON.parse(await fs.readFile(path.join(out, 'r.json'), 'utf8')).ok, true)
    assert.match(await fs.readFile(summary, 'utf8'), /pass/)
    const bad = spawnSync(process.execPath, [SCRIPT, '--work', path.join(work, 'b'), '--rto-ms', '-1'], { env, encoding: 'utf8' })
    assert.equal(bad.status, 1)
    assert.match(bad.stdout, /::error title=DLP restore drill failed::/)
  } finally {
    await Promise.all([cleanup(work), cleanup(out)])
  }
})

test('workflow: monthly schedule, manual trigger, push on drill code, least privilege, alert issue on scheduled failure', async () => {
  const y = await fs.readFile(WORKFLOW, 'utf8')
  const cron = y.match(/^\s*-\s*cron:\s*'([^']+)'/m)?.[1]
  assert.ok(cron, 'a cron line')
  const f = cron.split(/\s+/)
  assert.equal(f.length, 5)
  assert.match(f[2], /^\d+$/, 'fixed day of month = monthly')
  assert.equal(f[3], '*')
  assert.equal(f[4], '*')
  assert.match(y, /workflow_dispatch:/)
  assert.match(y, /push:[\s\S]*paths:[\s\S]*drill_ci\.mjs/)
  assert.doesNotMatch(y, /pull_request_target/)
  assert.match(y, /permissions:\s*\n\s+contents: read/)
  assert.match(y, /node services\/trustweb-backup\/drill_ci\.mjs/)
  assert.match(y, /node --test services\/trustweb-backup\/test\/dlp_ci_drill\.test\.mjs/)
  assert.match(y, /github\.event_name == 'schedule'/)
  assert.match(y, /gh issue/)
  assert.match(y, /issues: write/)
  for (const u of y.matchAll(/uses:\s*(\S+)/g)) assert.match(u[1], /@v\d+$/, `pinned major: ${u[1]}`)
})
