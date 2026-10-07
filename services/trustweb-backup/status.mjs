// The body of GET /hosted/status, in one place (hosting on: hosted.mjs, hosting off: server.mjs), so the two shapes cannot drift.
//
// Old fields stay as they were (booleans hosted, transcribe, feedback; plan). Wave 2 (P10) added `provider`, so the app never
// hardcodes who transcribes or where its audio goes; wave 3 adds Berget (region "se") and `fallback`:
//   provider: { transcribe: { enabled: bool, provider: "berget"|"openrouter"|"infomaniak", region: "se"|"us"|"ch", dataPolicy: "deny"|"allow"|null,
//                             fallback: null | { provider, region, dataPolicy } } }
// `enabled` equals the old `transcribe` boolean. provider = the ACTIVE provider: the one that serves a job first. region = where the
// INFERENCE runs (not where our server is). dataPolicy = the no-data-collection policy we send with every call (OpenRouter only; Berget
// states zero retention but has no per-request parameter, Infomaniak neither: null). fallback = the provider that takes over when the
// active one has an outage (5xx or timeout), null when there is none: the consent text must name its region too, because audio can go
// there instead.

import { TranscribeProvider } from './config.mjs'

const REGION = Object.freeze({ [TranscribeProvider.Berget]: 'se', [TranscribeProvider.OpenRouter]: 'us', [TranscribeProvider.Infomaniak]: 'ch' })

/** Where a provider runs and under which data policy: the part of the status block a provider and its fallback share. */
function providerInfo(cfg, provider) {
  return {
    provider,
    region: REGION[provider] ?? null,
    dataPolicy: provider === TranscribeProvider.OpenRouter ? cfg.transcribeDataCollection : null,
  }
}

/** What the app may say about transcription. `enabled` false whenever hosting (which transcription needs) is off. */
export function transcribeInfo(cfg, hostingOn) {
  const { provider, region, dataPolicy } = providerInfo(cfg, cfg.transcribeProvider)
  return {
    enabled: hostingOn && cfg.transcribeConfigured,
    provider,
    region,
    dataPolicy,
    fallback: cfg.transcribeFallback === null ? null : providerInfo(cfg, cfg.transcribeFallback),
  }
}

/** planBody = the usage body of an empty account (the limits), or null when hosting is off. */
export function statusBody(cfg, planBody) {
  const hostingOn = planBody !== null
  const transcribe = transcribeInfo(cfg, hostingOn)
  return { hosted: hostingOn, transcribe: transcribe.enabled, feedback: cfg.feedbackConfigured, plan: planBody, provider: { transcribe } }
}
