// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Drafting through the person's OWN model endpoint (Settings > Advanced > Your AI). OpenAI-compatible chat completions only, no vendor
 * SDK. The key goes to the configured endpoint and nowhere else; it is never logged.
 */
import type { AiEndpoint } from './model'
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

export function buildRequest(ai: AiEndpoint, text: string, system: string = TOGETHER_DRAFT_SHAPE, maxTokens = 300): { url: string; init: { method: string; headers: Record<string, string>; body: string } } {
  return {
    url: `${ai.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}) },
      body: JSON.stringify({
        model: ai.model, temperature: 0, stream: false, max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
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
export async function askEndpoint(ai: AiEndpoint, text: string, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = AI_TIMEOUT_MS): Promise<unknown> {
  const { url, init } = buildRequest(ai, text)
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
export async function askEndpointText(ai: AiEndpoint, system: string, text: string, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = AI_TIMEOUT_MS): Promise<string> {
  const { url, init } = buildRequest(ai, text, system, 400)
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

export type TestOutcome =
  | { ok: true; ms: number; reply: string }
  | { ok: false; message: string; status?: number; raw?: string; timedOut?: boolean }
export interface ResultLine { kind: 'status' | 'message' | 'raw' | 'hint'; text: string; ok?: boolean }

const CUT = 200
const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? '')

/** The Test button's one call: never throws; keeps the status, the endpoint's own message and the raw text for the result block. */
export async function testEndpoint(ai: AiEndpoint, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = AI_TIMEOUT_MS): Promise<TestOutcome> {
  const { url, init } = buildRequest(ai, 'I want to play padel')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal })
    const body = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, status: res.status, message: (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`, raw: body === null ? undefined : asText(body) }
    const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content
    if (parseReply(body) === null) return { ok: false, message: 'not JSON', raw: typeof content === 'string' ? content : body === null ? undefined : asText(body) }
    return { ok: true, ms: Date.now() - t0, reply: asText(content) }
  } catch (e) {
    return { ok: false, message: (e as Error).message, timedOut: ctl.signal.aborted }
  } finally { clearTimeout(timer) }
}

/** The result block under the Test button: status, the endpoint's message, the first 200 characters of the reply or body, and a hint for the common causes. Never one line. */
export function testResultLines(o: TestOutcome): ResultLine[] {
  if (o.ok) return [{ kind: 'status', ok: true, text: `Answered in ${(o.ms / 1000).toFixed(1)} s` }, { kind: 'raw', text: o.reply.slice(0, CUT) }]
  const hint = o.timedOut ? 'No answer in 30 s' : o.status === 401 ? 'Key rejected' : o.message === 'not JSON' ? 'The endpoint answered, but not with JSON: check the model name' : ''
  return [
    { kind: 'status', ok: false, text: 'Failed' },
    { kind: 'message', text: o.message },
    ...(o.raw ? [{ kind: 'raw' as const, text: o.raw.slice(0, CUT) }] : []),
    ...(hint ? [{ kind: 'hint' as const, text: hint }] : []),
  ]
}
