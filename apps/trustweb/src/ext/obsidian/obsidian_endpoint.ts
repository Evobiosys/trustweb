// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: the one place that decides where vault text may go. Only the owner's own Custom endpoint (the pc24 preset, or any
 * address they typed under Custom) or a local Ollama; the subscription, OpenAI and Claude presets are refused, and with no endpoint set up no
 * request exists at all (makeAsk returns null). The request is the app's own OpenAI-compatible call (llm_endpoint.ts buildRequest).
 */
import type { AiEndpoint } from '../../model'
import { AI_TIMEOUT_MS, buildRequest, configured, customPresetOf, parseReply } from '../../llm_endpoint'
import type { FetchLike } from '../../llm_endpoint'

export const INGEST_MAX_TOKENS = 3000
/** A reply on a 35B model can take a while; the owner can pause or stop at any time. */
export const INGEST_TIMEOUT_MS = Math.max(AI_TIMEOUT_MS, 180_000)

export type Target = { ok: true; host: string; model: string; label: string } | { ok: false; why: 'none' | 'cloud' }

export function ingestTarget(ai: AiEndpoint | undefined): Target {
  if (!configured(ai)) return { ok: false, why: 'none' }
  if (ai.preset !== 'custom' && ai.preset !== 'ollama') return { ok: false, why: 'cloud' }
  let host = ai.baseUrl
  try { host = new URL(ai.baseUrl.trim()).host } catch { return { ok: false, why: 'none' } }
  return { ok: true, host, model: ai.model.trim(), label: ai.name?.trim() || host }
}

export type Ask = (system: string, user: string) => Promise<unknown>

/** null when the target is refused. */
export function makeAsk(ai: AiEndpoint | undefined, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = INGEST_TIMEOUT_MS): Ask | null {
  if (!ingestTarget(ai).ok) return null
  const endpoint = ai as AiEndpoint
  return async (system, user) => {
    const { url, init } = buildRequest(endpoint, user, system, INGEST_MAX_TOKENS, [])
    // pc24's qwen3.6 answers fast with thinking off (wave 40 report); other servers get the plain request.
    const body = customPresetOf(endpoint) === 'pc24' ? JSON.stringify({ ...JSON.parse(init.body), reasoning_effort: 'none' }) : init.body
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const res = await fetchFn(url, { ...init, body, signal: ctl.signal })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`)
      const parsed = parseReply(json)
      if (parsed === null) throw new Error('not JSON')
      return parsed
    } finally { clearTimeout(timer) }
  }
}
