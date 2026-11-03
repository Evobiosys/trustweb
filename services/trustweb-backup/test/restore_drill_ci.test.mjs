// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// The CI wrapper of the restore drill (docs/ops/dlp.md level 0). Synthetic data only: random bytes, example.test hosts, no person's data.
// No fixed port: the tool listens on port 0. The CLI runs as a child with a clean env (no GITHUB_* of the runner leaks in or out).
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffDirs, renderSummary, redact, CHECKS } from '../restore_drill_ci.mjs'

const TOOL = fileURLToPath(new URL('../restore_drill_ci.mjs', import.meta.url))
const HEX64 = /[0-9a-f]{64}/i

async function inTemp(body) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'twdrillci-'))
  try {
    await body(dir)
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 30 })
  }
}

/** Runs the CLI; env holds ONLY PATH plus `extra`. Resolves {code, stdout, stderr}. */
function runTool(args, extra = {}, cwd) {
  const env = { PATH: process.env.PATH, ...extra }
  return new Promise((resolve) => {
    execFile(process.execPath, [TOOL, ...args], { env, cwd, timeout: 60_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout, stderr })
    })
  })
}

const write = async (file, data) => {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, data)
}

test('diffDirs: equal trees pass, tmp/ is skipped; missing, extra and differing files are problems', async () => {
  await inTemp(async (root) => {
    const a = path.join(root, 'a')
    const b = path.join(root, 'b')
    for (const d of [a, b]) {
      await write(path.join(d, 'blobs', 'one.bin'), 'x1')
      await write(path.join(d, 'connect.json'), '{}')
    }
    await write(path.join(a, 'tmp', 'half'), 'torn')
    let r = await diffDirs(a, b)
    assert.deepEqual(r, { ok: true, files: 2, problems: [] })

    await write(path.join(a, 'links.json'), '{}')
    await write(path.join(b, 'extra.json'), '{}')
    await fs.appendFile(path.join(b, 'blobs', 'one.bin'), 'y')
    r = await diffDirs(a, b)
    assert.equal(r.ok, false)
    assert.ok(r.problems.some((p) => p.includes('missing') && p.includes('links.json')))
    assert.ok(r.problems.some((p) => p.includes('extra') && p.includes('extra.json')))
    assert.ok(r.problems.some((p) => p.includes('differs') && p.includes('blobs/one.bin')))
  })
})

test('diffDirs never names a 64-hex id (blob names are redacted)', async () => {
  await inTemp(async (root) => {
    const id = 'e'.repeat(64)
    await write(path.join(root, 'a', 'blobs', `${id}.bin`), 'x')
    await fs.mkdir(path.join(root, 'b'))
    const r = await diffDirs(path.join(root, 'a'), path.join(root, 'b'))
    assert.equal(r.ok, false)
    assert.ok(!HEX64.test(r.problems.join('\n')))
    assert.equal(redact(`blobs/${id}.bin`), 'blobs/<id>.bin')
  })
})

const fakeReport = (ok) => ({
  v: 1, ok, startedAt: '2026-11-02T04:23:00.000Z', restoreMs: 12, files: 3,
  checks: CHECKS.map((name) => ({ name, ok: ok || name !== 'diff', detail: 'x' })),
  problems: ok ? [] : ['diff: restored copy differs: blobs/<id>.bin'],
})

test('renderSummary: heading, five checks, restore line, one 9-cell drill-log row', () => {
  assert.deepEqual(CHECKS, ['fixture', 'drill', 'diff', 'serve', 'control'])
  for (const ok of [true, false]) {
    const md = renderSummary(fakeReport(ok))
    assert.match(md, /^## DLP restore drill \(level 0, CI fixture\)$/m)
    for (const name of CHECKS) assert.match(md, new RegExp(`^\\| ${name} \\| (✅|❌) \\|`, 'm'))
    assert.match(md, /^restore 12 ms \(target 4 h\)$/m)
    assert.match(md, /^\| Date \| Level \| Snapshot ids restored \| Elapsed vs RTO \| Newest canary age vs RPO \| Checksums \| Result \| Findings and fixes \| Operator \|$/m)
    const row = md.split('\n').find((l) => l.startsWith('| 2026-11-02 |'))
    assert.ok(row, 'drill-log row')
    const cells = row.slice(1, -1).split('|').map((c) => c.trim())
    assert.equal(cells.length, 9)
    assert.equal(cells[2], 'ci-fixture')
    assert.equal(cells[5], ok ? 'match' : 'mismatch')
    assert.equal(cells[6], ok ? 'pass' : 'fail')
    assert.equal(cells[8], 'github-actions')
    assert.ok(!md.includes(String.fromCharCode(0x2014)), 'no em dash')
  }
})

function assertSchema(r) {
  for (const k of ['v', 'ok', 'startedAt', 'finishedAt', 'durationMs', 'restoreMs', 'files', 'level', 'fixture', 'checks', 'problems', 'rto', 'run', 'runner']) {
    assert.ok(k in r, `report.${k}`)
  }
  assert.equal(r.v, 1)
  assert.equal(r.level, '0 automated (CI fixture)')
  assert.deepEqual(r.checks.map((c) => c.name), CHECKS)
  for (const c of r.checks) assert.deepEqual(Object.keys(c).sort(), ['detail', 'name', 'ok'])
  assert.equal(r.fixture.blobBytes, 4096)
  assert.equal(r.rto.targetMs, 14_400_000)
  assert.deepEqual(Object.keys(r.run).sort(), ['eventName', 'ref', 'repository', 'runId', 'sha'])
  assert.equal(r.runner.node, process.version)
  assert.equal(typeof r.durationMs, 'number')
}

test('CLI happy path: exit 0, ::notice, report, step summary, outputs, nothing secret printed, restored tree still equals live', async () => {
  await inTemp(async (root) => {
    const work = path.join(root, 'work')
    const summary = path.join(root, 'summary.md')
    const stepSummary = path.join(root, 'step-summary.md')
    const ghOutput = path.join(root, 'gh-output')
    await fs.writeFile(stepSummary, 'before\n')
    await fs.writeFile(ghOutput, 'earlier=1\n')
    const env = {
      GITHUB_STEP_SUMMARY: stepSummary, GITHUB_OUTPUT: ghOutput, GITHUB_REPOSITORY: 'example/trustweb',
      GITHUB_RUN_ID: '42', GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567', GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'workflow_dispatch',
    }
    const r = await runTool(['--work', work, '--summary', summary], env)
    assert.equal(r.code, 0, r.stdout + r.stderr)
    assert.match(r.stdout, /^::notice title=DLP restore drill passed::files=\d+ restoreMs=\d+$/m)
    for (const name of CHECKS) assert.match(r.stdout, new RegExp(`^  ok   ${name}: `, 'm'))
    assert.match(r.stdout, /^  ok   fixture: 1 record, 4096 bytes/m)
    assert.ok(!r.stdout.includes('report: '), 'the work dir is kept, so no report line')

    const report = JSON.parse(await fs.readFile(path.join(work, 'report.json'), 'utf8'))
    assertSchema(report)
    assert.equal(report.ok, true)
    assert.deepEqual(report.problems, [])
    assert.ok(report.checks.every((c) => c.ok))
    assert.equal(report.checks.find((c) => c.name === 'control').ok, true)
    assert.ok(report.files >= 3)
    // connect.json and links.json from the canary code and link; organizers.json is created by the server when its store opens
    assert.deepEqual([...report.fixture.stores].sort(), ['connect.json', 'links.json', 'organizers.json'])
    assert.equal(report.rto.withinTarget, true)
    assert.deepEqual(report.run, { repository: 'example/trustweb', runId: '42', sha: env.GITHUB_SHA, ref: 'refs/heads/main', eventName: 'workflow_dispatch' })

    const sum = await fs.readFile(summary, 'utf8')
    const step = await fs.readFile(stepSummary, 'utf8')
    assert.ok(step.startsWith('before\n'), 'step summary is appended to')
    assert.equal(step.slice('before\n'.length), sum)
    assert.match(sum, /\| pass \| /)
    assert.equal(await fs.readFile(ghOutput, 'utf8'), `earlier=1\nok=true\nproblems=0\nreport=${path.join(work, 'report.json')}\n`)

    const reportText = await fs.readFile(path.join(work, 'report.json'), 'utf8')
    for (const text of [r.stdout, r.stderr, reportText, sum]) assert.ok(!HEX64.test(text), 'no 64-hex string')
    // the serve step must leave the restored copy as it was (the workflow diffs it with GNU diff -r afterwards)
    assert.deepEqual((await diffDirs(path.join(work, 'live'), path.join(work, 'drill', 'restored'))).problems, [])
  })
})

for (const fault of ['bitrot', 'missing']) {
  test(`CLI fault ${fault}: exit 1, ::error, diff fails${fault === 'bitrot' ? ', serve fails' : ''}, outputs say so`, async () => {
    await inTemp(async (root) => {
      const work = path.join(root, 'work')
      const ghOutput = path.join(root, 'gh-output')
      const stepSummary = path.join(root, 'step-summary.md')
      const r = await runTool(['--work', work], { TW_DRILL_FAULT: fault, GITHUB_OUTPUT: ghOutput, GITHUB_STEP_SUMMARY: stepSummary })
      assert.equal(r.code, 1, r.stdout + r.stderr)
      assert.match(r.stdout, /^::error title=DLP restore drill failed::\d+ problem\(s\): .+$/m)
      assert.match(r.stdout, /^  FAIL diff: /m)
      const report = JSON.parse(await fs.readFile(path.join(work, 'report.json'), 'utf8'))
      assertSchema(report)
      assert.equal(report.ok, false)
      assert.ok(report.problems.length >= 1)
      const check = (n) => report.checks.find((c) => c.name === n).ok
      assert.equal(check('diff'), false)
      if (fault === 'bitrot') assert.equal(check('serve'), false)
      assert.equal(check('control'), true, 'the negative control does not depend on the fault')
      assert.equal(report.run.repository, null)
      const out = await fs.readFile(ghOutput, 'utf8')
      assert.match(out, /^ok=false$/m)
      assert.match(out, new RegExp(`^problems=${report.problems.length}$`, 'm'))
      const sum = await fs.readFile(stepSummary, 'utf8')
      assert.match(sum, /\| mismatch \| fail \| /)
      assert.match(sum, /^\| diff \| ❌ \|/m)
      for (const text of [r.stdout, r.stderr, JSON.stringify(report), sum]) assert.ok(!HEX64.test(text), 'no 64-hex string')
    })
  })
}

test('CLI refuses a non-empty --work (exit 2) and leaves it untouched; unknown flags are usage errors', async () => {
  await inTemp(async (root) => {
    const work = path.join(root, 'work')
    await write(path.join(work, 'keep'), 'x')
    const r = await runTool(['--work', work])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /not empty/)
    assert.deepEqual(await fs.readdir(work), ['keep'])
    assert.equal(await fs.readFile(path.join(work, 'keep'), 'utf8'), 'x')
    assert.equal((await runTool(['--bogus'])).code, 2)
    assert.equal((await runTool(['--work'])).code, 2)
    // an existing --report file is never overwritten
    const rep = path.join(root, 'r.json')
    await fs.writeFile(rep, 'old')
    assert.equal((await runTool(['--work', path.join(root, 'w2'), '--report', rep])).code, 2)
    assert.equal(await fs.readFile(rep, 'utf8'), 'old')
  })
})

test('CLI without --work: temp work dir is removed, the report is printed as the last line', async () => {
  await inTemp(async (root) => {
    const tmp = path.join(root, 'tmp')
    await fs.mkdir(tmp)
    const r = await runTool([], { TMPDIR: tmp })
    assert.equal(r.code, 0, r.stdout + r.stderr)
    const last = r.stdout.trimEnd().split('\n').at(-1)
    assert.ok(last.startsWith('report: '))
    const report = JSON.parse(last.slice('report: '.length))
    assertSchema(report)
    assert.equal(report.ok, true)
    assert.deepEqual(await fs.readdir(tmp), [], 'temp work dir removed')
    assert.ok(!HEX64.test(r.stdout))
  })
})
