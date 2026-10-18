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
