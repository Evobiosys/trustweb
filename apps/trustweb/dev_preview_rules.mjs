// Plain ESM, imported by vite.config.mjs and re-exported by src/dev_preview_rules.ts: kept out of src/ so that editing app sources never restarts vite.

/** Self-contained (also inlined into the waiting page via toString()): true once the last three answers are 200 and the server started after `since`. */
export function readyToGo(answers, since) {
  const last = answers.slice(-3)
  return last.length === 3 && last.every((a) => a.status === 200 && (a.serverStarted ?? 0) > since)
}

/** The failed jobs' names and the log lines with FAIL/error/Error/✗, 200 lines at most (the panel's "Copy diagnostics"). */
export function ciDiagnostics(jobs, log) {
  const lines = log.split('\n').filter((l) => /FAIL|error|Error|✗/.test(l)).map((l) => l.replace(/^.*?\t.*?\t/, '').trim())
  return [...jobs.map((j) => `job: ${j}`), ...lines].slice(0, 200).join('\n') || 'no failed job or error line found in the latest run'
}

/** The gh binary: TW_GH, else `gh` found on PATH, else the usual Homebrew spots (a dev server started outside a login shell lacks them). */
export function ghBin(env, exists) {
  const onPath = (env.PATH ?? '').split(':').filter(Boolean).map((d) => `${d}/gh`)
  return env.TW_GH || [...onPath, '/opt/homebrew/bin/gh', '/usr/local/bin/gh'].find(exists) || null
}

/** Diagnostics text for PR `pr` via `gh`; throws an Error whose message says why (no gh, gh failed). `run(bin, args)` resolves stdout. */
export async function diagnosticsFor(pr, bin, run) {
  if (!bin) throw new Error('gh not found (looked on PATH, /opt/homebrew/bin, /usr/local/bin); set TW_GH')
  const gh = async (...a) => (await run(bin, [...a, '--repo', 'Evobiosys/trustweb'])).trim()
  try {
    const branch = await gh('pr', 'view', pr, '--json', 'headRefName', '-q', '.headRefName')
    const id = await gh('run', 'list', '--branch', branch, '--limit', '1', '--json', 'databaseId', '-q', '.[0].databaseId')
    const jobs = (await gh('run', 'view', id, '--json', 'jobs', '-q', '.jobs[]|select(.conclusion=="failure")|.name')).split('\n').filter(Boolean)
    return ciDiagnostics(jobs, await gh('run', 'view', id, '--log-failed'))
  } catch (e) { throw new Error(String(e.stderr || e.message).trim().slice(-600) || 'gh failed') }
}

/** Steps after which tw_approve_merge.sh has stopped (its status file stays as the answer). */
export const MERGE_DONE = ['cancelled', 'failed', 'checks-failed', 'released', 'release-pending']

export const mergeStatusFile = (cache, branch) => `${cache}/approvals/${branch.replace(/[^A-Za-z0-9._-]+/g, '-')}.merge.json`

/**
 * POST /__tw/approve-merge starts bin/tw_approve_merge.sh detached (Touch ID, PR, checks, squash merge, release wait);
 * GET answers its status file. One run at a time: a status still running (updated within the hour) answers 409.
 */
export function approveMergeRoute({ loopback, branch, cache, ops, wt, exists, read, spawn, now = Date.now }) {
  const send = (res, code, o) => { res.code = res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)) }
  const status = () => { const f = mergeStatusFile(cache, branch()); return exists(f) ? JSON.parse(read(f)) : { step: 'none' } }
  return (req, res) => {
    if (!loopback(req)) { send(res, 403, {}); return }
    if (req.method === 'GET') { send(res, 200, status()); return }
    if (req.method !== 'POST') { send(res, 405, {}); return }
    const s = status()
    if (s.step !== 'none' && !MERGE_DONE.includes(s.step) && now() - Date.parse(s.updated) < 3600e3) { send(res, 409, { error: 'already running' }); return }
    spawn(`${ops}/bin/tw_approve_merge.sh`, [wt])
    send(res, 202, { started: true })
  }
}

/** Wave 44: the conflicting paths of `git merge-tree --write-tree` output (its stage lines and CONFLICT lines), once each, in order. */
export function conflictFiles(mergeTree) {
  const out = []
  for (const l of mergeTree.split('\n')) {
    const f = /^\d{6} [0-9a-f]{40} [123]\t(.+)$/.exec(l)?.[1] ?? /^CONFLICT \([^)]*\): Merge conflict in (.+)$/.exec(l)?.[1]
    if (f && !out.includes(f)) out.push(f)
  }
  return out
}

/**
 * The brief of the Sonnet session that resolves one row's conflict (SPR: the reader is an agent).
 * Wave 44 (Jakob, pi261116k merged the whole preview INTO a feature branch): the fix happens in the PREVIEW worktree on the preview branch,
 * and the resolution is saved as DEVLOG/<wave>/conflicts/<key>.patch, which `preview apply` replays, so an apply never undoes it.
 * devlog = trustweb-ops/DEVLOG/<wave> (the newest wave folder).
 */
export function conflictBrief({ id, key, branch, previewBranch, baseSha, worktree, mergeTree, devlog }) {
  const ops = devlog.replace(/\/DEVLOG\/[^/]+$/, '')
  const files = conflictFiles(mergeTree)
  return [
    `conflict-fix brief (wave44 format): row ${key} (branch ${branch}) conflicts when merged into preview ${id}.`,
    `preview: ${id}   worktree: ${worktree}   preview branch: ${previewBranch}   base: ${baseSha}`,
    'conflicting files:',
    ...(files.length ? files.map((f) => `- ${f}`) : ['- (none named by merge-tree: run the merge and read git status)']),
    `git merge-tree --write-tree HEAD ${branch} (in the worktree):`,
    mergeTree.trim() || '(no output)',
    '',
    `DO (all in ${worktree}, on ${previewBranch}):`,
    `1. cd ${worktree}; git status --short must be empty (else stop, report). git merge --no-ff ${branch}`,
    '2. resolve every conflict keeping BOTH sides: every `/* wave44 <slug> */` section (any slug, both sides) and every import and call stay; nothing dropped.',
    '3. gates (from the worktree root, verbatim; fix, never skip):',
    '   export PATH=/opt/homebrew/opt/node@22/bin:$PATH',
    '   cd apps/trustweb && ../demo/node_modules/.bin/tsc --noEmit -p tsconfig.json',
    '   cd apps/demo && node_modules/.bin/vitest run --config ../trustweb/test/unit/vitest.config.mjs --root ../trustweb',
    `4. git add -A && git commit --no-edit -m "preview ${id}: merge ${key} (conflicts resolved)"`,
    `5. save the resolution: ${ops}/bin/preview ${id} save-resolution ${key}   -> ${devlog}/conflicts/${key}.patch (every later \`preview apply\` replays it while ${branch} stays at this tip)`,
    `6. ${ops}/bin/preview ${id} apply   (re-assembles with the saved patch; the panel's conflict line clears)`,
    `7. panel status line (the panel shows it): node ${ops}/bin/preview_lib.mjs patch ${id} '{"fixStatus":{"key":"${key}","text":"resolved: <sha7>, patch saved","at":"<ISO time>"}}'`,
    '   not resolved / escalated: the same command with text "not resolved: <one-line reason>".',
    `8. report: ${devlog}/conflict-${key}_result-report.txt (sha, files, gate last lines, what each side kept).`,
    `NEVER: merge the preview branch (or main) into ${branch} or any feature branch; commit on a row branch; push; touch main; force; reset --hard; delete (trash <abs path> or a dated archive).`,
    `ALWAYS: work on ${previewBranch} in ${worktree} only; keep both sides; run the gates; save the patch before apply.`,
    'model: Sonnet (claude-sonnet-5-5). Hard conflict or unsure: escalate per the fallback ladder (Sonnet -> Opus; Fable only after asking Jakob) and say so in the report and the status line.',
    '',
  ].join('\n')
}

/**
 * POST /__tw/preview/fix-conflict {id, key}: writes DEVLOG/<wave>/conflict-<key>.txt and starts a background Sonnet session on it.
 * preview() = the registry, devlog() = the newest wave folder, mergeTree(worktree, ours, branch) = git's output (ours = HEAD: the preview branch), write(file, text), launch(file, task) -> {window}.
 */
export function fixConflictRoute({ loopback, preview, devlog, readBody, mergeTree, write, launch }) {
  const send = (res, code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)) }
  return async (req, res) => {
    if (!loopback(req)) { send(res, 403, {}); return }
    if (req.method !== 'POST') { send(res, 405, {}); return }
    const b = await readBody(req)
    const p = preview()
    const f = p.features.find((x) => x.key === b?.key)
    if (!f || b?.id !== p.id) { send(res, 400, { error: 'bad request' }); return }
    try {
      const dir = devlog()
      const file = `${dir}/conflict-${f.key}.txt`
      write(file, conflictBrief({ id: p.id, key: f.key, branch: f.branch, previewBranch: p.branch, baseSha: p.baseSha, worktree: p.worktree, devlog: dir, mergeTree: await mergeTree(p.worktree, 'HEAD', f.branch) }))
      send(res, 202, { started: true, brief: file, ...(await launch(file, `fix the conflict of ${f.key}`)) })
    } catch (e) { send(res, e?.busy ? 409 : 500, { error: String(e.message ?? e).slice(-600) }) }
  }
}

/**
 * Review wave 42: the launcher's failure as an Error. pi_new_session.sh exits 3 when another session of the project is ACTIVE or WAITING:
 * that is a refusal (`busy`, the route answers 409) with one sentence naming the session; any other failure keeps its last output line.
 */
export function launchError(e) {
  const out = String(e?.stdout || e?.stderr || e?.message || e).trim()
  if (e?.code === 3) {
    const sid = /\b(pi\d{6}[a-z0-9]*)\b/.exec(out)?.[1]
    return Object.assign(new Error(`Another pi session of this project is active${sid ? ` (${sid})` : ''}. Finish or close it, then press again.`), { busy: true })
  }
  return new Error(out.split('\n').pop())
}

/**
 * Review wave 42: where conflict briefs go = trustweb-ops/DEVLOG (its newest wave folder), found by walking up from the app folder; TW_DEVLOG wins.
 * The stale web-of-trust/DEVLOG (newest wave20) never qualifies. null when no ops folder is found.
 */
export function opsDevlogRoot(start, exists, override) {
  if (override) return override
  for (let dir = start; ; ) {
    const cand = `${dir}/trustweb-ops/DEVLOG`
    if (exists(cand)) return cand
    const up = dir.replace(/\/[^/]+$/, '')
    if (!up || up === dir) return null
    dir = up
  }
}

/**
 * One CLI call at a time (wave 33). A request identical to one still queued or running (same args) shares that run
 * instead of piling up behind it: a panel that timed out and asked again adds no second job.
 */
export function jobQueue(exec) {
  let tail = Promise.resolve()
  const open = new Map()
  return {
    size: () => open.size,
    run(args) {
      const key = JSON.stringify(args)
      const same = open.get(key)
      if (same) return same
      const job = tail.then(() => exec(args)).finally(() => { open.delete(key) })
      open.set(key, job)
      tail = job.catch(() => {})
      return job
    },
  }
}
