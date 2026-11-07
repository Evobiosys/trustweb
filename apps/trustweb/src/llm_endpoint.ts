// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Drafting through the person's OWN model endpoint (Settings > Advanced > Your AI). OpenAI-compatible chat completions only, no vendor
 * SDK. The key goes to the configured endpoint and nowhere else; it is never logged.
 */
import type { AiEndpoint } from './model'
import { type OwnChannel, scrubFor } from './channel_readers'
import { TOGETHER_DRAFT_SHAPE } from './together_request'

export const AI_TIMEOUT_MS = 30_000

export const PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: '' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: '' },
  pc24: { baseUrl: 'http://localhost:11435/v1', model: 'qwen3.6:35b' },
  custom: { baseUrl: '', model: '' },
} as const

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** Drafting is on only with a base URL and a model. */
export const configured = (ai: AiEndpoint | undefined): ai is AiEndpoint => Boolean(ai?.baseUrl.trim() && ai.model.trim())

export function buildRequest(ai: AiEndpoint, text: string, system: string = TOGETHER_DRAFT_SHAPE, maxTokens = 300, own: readonly OwnChannel[] = []): { url: string; init: { method: string; headers: Record<string, string>; body: string } } {
  return {
    url: `${ai.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}) },
      body: JSON.stringify({
        model: ai.model, temperature: 0, stream: false, max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: scrubFor(text, own, ai.preset) }],
      }),
    },
  }
}

/** choices[0].message.content as JSON (code fences stripped); null when absent or not JSON. */
export function parseReply(body: unknown): unknown {
  const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return null
  try { return JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { return null }
}

/** One call; throws with the endpoint's own message on an error, a timeout or a reply that is not JSON. */
export async function askEndpoint(ai: AiEndpoint, text: string, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = AI_TIMEOUT_MS, own: readonly OwnChannel[] = []): Promise<unknown> {
  const { url, init } = buildRequest(ai, text, undefined, undefined, own)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`)
    const parsed = parseReply(body)
    if (parsed === null) throw new Error('not JSON')
    return parsed
  } finally { clearTimeout(timer) }
}

/** One plain-text answer (the Ask your web summary); throws with the endpoint's own message on an error or a timeout. */
export async function askEndpointText(ai: AiEndpoint, system: string, text: string, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = AI_TIMEOUT_MS, own: readonly OwnChannel[] = []): Promise<string> {
  const { url, init } = buildRequest(ai, text, system, 400, own)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`)
    const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) throw new Error('empty')
    return content.trim()
  } finally { clearTimeout(timer) }
}
