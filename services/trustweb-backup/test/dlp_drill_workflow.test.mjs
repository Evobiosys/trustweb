// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Contract for .github/workflows/dlp-drill.yml (docs/ops/dlp.md, level 0 CI drill). No YAML parser without an install,
// so this reads the file line by line: top-level keys at column 0, jobs at two spaces. Fix the workflow, not the test.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const WF = path.join(ROOT, '.github/workflows/dlp-drill.yml')
const CI = path.join(ROOT, '.github/workflows/ci.yml')
const TOOL = 'services/trustweb-backup/restore_drill_ci.mjs'
const SPDX = '# SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later'

const text = fs.existsSync(WF) ? fs.readFileSync(WF, 'utf8') : ''
const lines = text.split('\n')
const indent = (l) => l.length - l.trimStart().length
const code = (l) => l.replace(/\s+#.*$/, '') // drop trailing comments (no '#' inside our values)

// Lines of a block that starts at a line matching `re`, up to the next line at the same or lower indent.
function block(re, from = lines) {
  const i = from.findIndex((l) => re.test(l))
  if (i < 0) return []
  const base = indent(from[i])
  const out = [from[i]]
  for (const l of from.slice(i + 1)) {
    if (l.trim() !== '' && !l.trimStart().startsWith('#') && indent(l) <= base) break
    out.push(l)
  }
  return out
}
const jobsBlock = () => block(/^jobs:\s*$/)
function jobs() {
  const out = {}
  let name = null
  for (const l of jobsBlock().slice(1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(l)
    if (m) { name = m[1]; out[name] = [] } else if (name) out[name].push(l)
  }
  return out
}
// Steps of a job: split on lines "      - ".
function steps(jobLines) {
  const out = []
  for (const l of jobLines) {
    if (/^ {6}- /.test(l)) out.push([l])
    else if (out.length && (l.trim() === '' || indent(l) > 6)) out[out.length - 1].push(l)
  }
  return out.map((s) => s.join('\n'))
}

test('the workflow file exists', () => {
  assert.ok(fs.existsSync(WF), `${WF} is missing`)
})

test('first line is the SPDX comment', () => {
  assert.equal(lines[0], SPDX)
})

test('schedule: monthly cron on a fixed day 1..28, any month, off the hour', () => {
  const sched = block(/^ {2}schedule:\s*$/).join('\n')
  const m = /cron:\s*['"]([^'"]+)['"]/.exec(sched)
  assert.ok(m, 'no quoted cron under on.schedule')
  const f = m[1].trim().split(/\s+/)
  assert.equal(f.length, 5, `cron must have 5 fields: ${m[1]}`)
  const [min, , dom, month, dow] = f
  assert.match(min, /^\d+$/)
  assert.notEqual(Number(min), 0, 'minute 0 is the busy slot; run off the hour')
  assert.match(dom, /^\d+$/)
  assert.ok(Number(dom) >= 1 && Number(dom) <= 28, `day-of-month ${dom} must be 1..28 (exists every month)`)
  assert.equal(month, '*')
  assert.equal(dow, '*')
})

test('the header says GitHub pauses schedules after 60 days without activity', () => {
  const header = lines.slice(0, lines.findIndex((l) => /^name:/.test(l))).join('\n')
  assert.match(header, /60 days/)
})

test('concurrency: one drill per ref, never cancelled mid-run', () => {
  const c = block(/^concurrency:\s*$/).map(code).join('\n')
  assert.match(c, /group:\s*dlp-drill-\$\{\{ github\.ref \}\}/)
  assert.match(c, /cancel-in-progress:\s*false/)
})

test('workflow_dispatch is present', () => {
  assert.ok(lines.some((l) => /^ {2}workflow_dispatch:/.test(l)))
})

test('a push paths filter names the CI wrapper', () => {
  const push = block(/^ {2}push:\s*$/).join('\n')
  assert.match(push, /paths:/)
  assert.ok(push.includes(TOOL), 'push.paths must list restore_drill_ci.mjs')
})

test('top-level permissions are contents: read and nothing writes', () => {
  const perms = block(/^permissions:/)
  assert.ok(perms.length > 0, 'no top-level permissions')
  const body = perms.map(code).join('\n')
  assert.match(body, /contents:\s*read/)
  assert.doesNotMatch(body, /write/)
})

test('issues: write appears exactly once, inside the alert job', () => {
  const all = lines.filter((l) => /issues:\s*write/.test(code(l)))
  assert.equal(all.length, 1)
  const j = jobs()
  assert.ok(j.alert, 'no alert job')
  assert.ok(j.alert.some((l) => /issues:\s*write/.test(code(l))))
})

test('the drill step runs restore_drill_ci.mjs, and that file exists', () => {
  const drill = jobs().drill ?? []
  const s = steps(drill).find((x) => x.includes(TOOL))
  assert.ok(s, 'no drill step runs the CI wrapper')
  assert.match(s, /id:\s*drill/)
  assert.match(s, /run:\s*node services\/trustweb-backup\/restore_drill_ci\.mjs/)
  assert.ok(fs.existsSync(path.join(ROOT, TOOL)), `${TOOL} is missing`)
})

test('an independent diff -r step', () => {
  assert.ok(steps(jobs().drill ?? []).some((s) => /run:\s*diff -r /.test(s)))
})

test('an upload-artifact step with retention-days', () => {
  const s = steps(jobs().drill ?? []).find((x) => x.includes('actions/upload-artifact@'))
  assert.ok(s, 'no upload-artifact step')
  assert.match(s, /retention-days:\s*\d+/)
})

test('every job has timeout-minutes', () => {
  const j = jobs()
  assert.ok(Object.keys(j).length >= 2, 'expected the drill and alert jobs')
  for (const [name, body] of Object.entries(j)) {
    assert.ok(body.some((l) => /^ {4}timeout-minutes:\s*\d+/.test(l)), `job ${name} has no timeout-minutes`)
  }
})

test('the drill job installs nothing (node stdlib only)', () => {
  const drill = (jobs().drill ?? []).map(code).join('\n')
  assert.ok(drill.length > 0)
  assert.doesNotMatch(drill, /pnpm install|npm (ci|install)|pnpm\/action-setup/)
})

test("the alert job's if contains failure()", () => {
  const ifLine = (jobs().alert ?? []).find((l) => /^ {4}if:/.test(l)) ?? ''
  assert.match(ifLine, /failure\(\)/)
})

test('every if: with ! is wrapped in ${{ }} (a bare ! starts a YAML tag)', () => {
  for (const l of lines.filter((x) => /^\s*if:/.test(x) && x.includes('!'))) {
    assert.match(l.trim(), /^if: \$\{\{.*\}\}\s*$/, l)
  }
})

test('the heartbeat never echoes the URL', () => {
  const s = steps(jobs().drill ?? []).find((x) => /heartbeat/i.test(x))
  assert.ok(s, 'no heartbeat step')
  assert.match(s, /secrets\.DLP_DRILL_HEARTBEAT_URL/)
  for (const l of s.split('\n').filter((x) => /\b(echo|printf)\b/.test(x))) {
    for (const part of l.split(/&&|\|\||;/).filter((p) => /\b(echo|printf)\b/.test(p))) {
      assert.doesNotMatch(part, /\$\{?URL\b/, `prints the URL: ${l.trim()}`)
    }
  }
  assert.doesNotMatch(s, /set -x/)
})

test('no e-mail, 64-hex or IPv4 in the file', () => {
  assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/)
  assert.doesNotMatch(text, /\b[0-9a-f]{64}\b/)
  assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/)
})

test('regular hyphen only, no em dash', () => {
  assert.ok(!text.includes('\u2014'))
})

test('ci.yml runs the three node:test files', () => {
  const ci = fs.readFileSync(CI, 'utf8')
  for (const f of ['restore_drill.test.mjs', 'restore_drill_ci.test.mjs', 'dlp_drill_workflow.test.mjs']) {
    assert.ok(ci.includes(`node --test`) && ci.includes(`services/trustweb-backup/test/${f}`), `ci.yml does not run ${f}`)
  }
})
