// Plain ESM, imported by vite.config.mjs and re-exported by src/dev_preview_rules.ts: kept out of src/ so that editing app sources never restarts vite.

/** Self-contained (also inlined into the waiting page via toString()): true once the last three answers are 200 and the server started after `since`. */
export function readyToGo(answers, since) {
  const last = answers.slice(-3)
  return last.length === 3 && last.every((a) => a.status === 200 && (a.serverStarted ?? 0) > since)
}

/** The failed jobs' names and the log lines with FAIL/error/Error/✗, 200 lines at most (the panel's "Copy diagnostics"). */
export function ciDiagnostics(jobs, log) {
  const lines = log.split('\n').filter((l) => /FAIL|error|Error|✗/.test(l)).map((l) => l.replace(/^.*?\t.*?\t/, '').trim())
  return [...jobs.map((j) => `job: ${j}`), ...lines].slice(0, 200).join('\n')
}
