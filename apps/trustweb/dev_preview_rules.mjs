// Plain ESM, imported by vite.config.mjs and re-exported by src/dev_preview_rules.ts: kept out of src/ so that editing app sources never restarts vite.

/** Self-contained (also inlined into the waiting page via toString()): true once the last three answers are 200 and the server started after `since`. */
export function readyToGo(answers, since) {
  const last = answers.slice(-3)
  return last.length === 3 && last.every((a) => a.status === 200 && (a.serverStarted ?? 0) > since)
}
