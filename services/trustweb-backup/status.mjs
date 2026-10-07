// The body of GET /hosted/status, in one place (hosting on: hosted.mjs, hosting off: server.mjs), so the two shapes cannot drift.
//
// Old fields stay as they were (booleans hosted, transcribe, feedback; plan). Wave 2 (P10) adds `provider`, so the app never
// hardcodes who transcribes or where its audio goes:
//   provider: { transcribe: { enabled: bool, provider: "openrouter"|"infomaniak", region: "us"|"ch", dataPolicy: "deny"|"allow"|null } }
// `enabled` equals the old `transcribe` boolean. region = where the INFERENCE runs (not where our server is). dataPolicy = the
// no-data-collection policy we send with every call (OpenRouter only; Infomaniak has no such parameter: null).

import { TranscribeProvider } from './config.mjs'

const REGION = Object.freeze({ [TranscribeProvider.OpenRouter]: 'us', [TranscribeProvider.Infomaniak]: 'ch' })

/** What the app may say about transcription. `enabled` false whenever hosting (which transcription needs) is off. */
export function transcribeInfo(cfg, hostingOn) {
  const openrouter = cfg.transcribeProvider === TranscribeProvider.OpenRouter
  return {
    enabled: hostingOn && cfg.transcribeConfigured,
    provider: cfg.transcribeProvider,
    region: REGION[cfg.transcribeProvider] ?? null,
    dataPolicy: openrouter ? cfg.transcribeDataCollection : null,
  }
}

/** planBody = the usage body of an empty account (the limits), or null when hosting is off. */
export function statusBody(cfg, planBody) {
  const hostingOn = planBody !== null
  const transcribe = transcribeInfo(cfg, hostingOn)
  return { hosted: hostingOn, transcribe: transcribe.enabled, feedback: cfg.feedbackConfigured, plan: planBody, provider: { transcribe } }
}
