// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Drafting through the person's OWN model endpoint (Settings > AI). OpenAI-compatible chat completions only, no vendor
 * SDK. The key goes to the configured endpoint and nowhere else; it is never logged.
 */
import type { AiEndpoint } from './model'
import { type OwnChannel, scrubFor } from './channel_readers'
import { TOGETHER_DRAFT_SHAPE } from './together_request'
import { S } from './strings'
import { waitForAi, type WaitOpts } from './ai_subscription'

export const AI_TIMEOUT_MS = 30_000

export const PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: '' },
  // Anthropic's OpenAI-compatible chat/completions route; unverified without a key (wave 36 report).
  claude: { baseUrl: 'https://api.anthropic.com/v1', model: '' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: '' },
  custom: { baseUrl: '', model: '' },
} as const

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text?: () => Promise<string> }>

/** Drafting is on only with a base URL and a model. */
export const configured = (ai: AiEndpoint | undefined): ai is AiEndpoint => Boolean(ai?.baseUrl.trim() && ai.model.trim())

/** Wave 39: what Custom offers to fill in. pc24 is a preset here, not a provider of its own; OpenAI is not offered. */
export const CUSTOM_PRESETS = [
  { id: 'ollama', name: 'Ollama (this device)', baseUrl: PRESETS.ollama.baseUrl, model: '' },
  { id: 'pc24', name: 'pc24', baseUrl: 'http://localhost:11435/v1', model: 'qwen3.6:35b' },
  { id: 'other', name: '', baseUrl: '', model: '' },
] as const
export type CustomPresetId = (typeof CUSTOM_PRESETS)[number]['id']

/** A Custom endpoint filled from a preset: its name, address and model, an empty key (a key never follows to another address), the sign-up stays. */
export function customPreset(ai: AiEndpoint, id: CustomPresetId): AiEndpoint {
  const { name: _name, ...rest } = ai
  const p = CUSTOM_PRESETS.find((x) => x.id === id)!
  return { ...rest, preset: 'custom', ...(p.name ? { name: p.name } : {}), baseUrl: p.baseUrl, model: p.model, apiKey: '' }
}

/** Which Custom preset an endpoint shows as: the old own-key presets (ollama, openai, claude) read as a Custom endpoint now. */
export function customPresetOf(ai: AiEndpoint): CustomPresetId {
  if (ai.preset === 'ollama' || ai.baseUrl.trim().replace(/\/+$/, '') === PRESETS.ollama.baseUrl) return 'ollama'
  return ai.name === 'pc24' ? 'pc24' : 'other'
}

/** Another provider: its base URL and model, an empty key (a key, or the subscription token, never follows to a different provider), no custom name; the sign-up stays. */
export function switchPreset(ai: AiEndpoint, p: keyof typeof PRESETS): AiEndpoint {
  if (ai.preset === p) return ai
  const { name: _name, ...rest } = ai
  return { ...rest, preset: p, ...PRESETS[p], apiKey: '' }
}

/** Browser calls to Anthropic are refused without this header. */
const isAnthropic = (baseUrl: string): boolean => { try { return new URL(baseUrl.trim()).hostname === 'api.anthropic.com' } catch { return false } }

export function buildRequest(ai: AiEndpoint, text: string, system: string = TOGETHER_DRAFT_SHAPE, maxTokens = 300, own: readonly OwnChannel[] = []): { url: string; init: { method: string; headers: Record<string, string>; body: string } } {
  return {
    url: `${ai.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(ai.apiKey ? { Authorization: `Bearer ${ai.apiKey}` } : {}), ...(isAnthropic(ai.baseUrl) ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {}) },
      body: JSON.stringify({
        model: ai.model, temperature: 0, stream: false, max_tokens: maxTokens,
        messages: [{ role: 'system', content: system }, { role: 'user', content: scrubFor(text, own, ai.preset) }],
      }),
    },
  }
}


/** What the person sees while the server's computer wakes (the loading window listens). */
export type WakeEvent = { phase: 'waiting'; waited: number } | { phase: 'ready' } | { phase: 'failed' }
let wakeListener: ((e: WakeEvent) => void) | undefined
export const onWake = (f: ((e: WakeEvent) => void) | undefined): void => { wakeListener = f }

type Reply = Awaited<ReturnType<FetchLike>>
const isWaking = (res: Reply, body: unknown): boolean => res.status === 503 && (body as { error?: { code?: string } } | null)?.error?.code === 'waking'

/**
 * One chat call. The subscription's server sleeps its AI computer when idle: a "waking" 503 shows the wait, polls /status until up,
 * then retries ONCE (a second "waking" is an error, never a loop). Own-key endpoints never wait.
 */
async function post(ai: AiEndpoint, url: string, init: { method: string; headers: Record<string, string>; body: string }, fetchFn: FetchLike, timeoutMs: number, wake: WaitOpts): Promise<{ res: Reply; body: unknown }> {
  // The retry gets a longer budget: the model loads into the GPU on the first ask after a boot.
  const once = async (limit = timeoutMs): Promise<{ res: Reply; body: unknown }> => {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), limit)
    try {
      const res = await fetchFn(url, { ...init, signal: ctl.signal })
      return { res, body: await res.json().catch(() => null) }
    } finally { clearTimeout(timer) }
  }
  const first = await once()
  if (ai.preset !== 'tw-subscription' || !isWaking(first.res, first.body)) return first
  wakeListener?.({ phase: 'waiting', waited: 0 })
  const up = await waitForAi(fetchFn as unknown as Parameters<typeof waitForAi>[0], `${ai.baseUrl.trim().replace(/\/+$/, '')}/status`, { ...wake, onTick: (s) => wakeListener?.({ phase: 'waiting', waited: s }) })
  wakeListener?.({ phase: up ? 'ready' : 'failed' })
  return up ? once(Math.max(timeoutMs, 90_000)) : first
}

/** choices[0].message.content as JSON (<think> blocks and code fences stripped, JSON found inside surrounding prose); null when absent or not JSON. */
export function parseReply(body: unknown): unknown {
  const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content
  if (typeof content !== 'string') return null
  const text = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const whole = jsonOrNull(text)
  if (whole !== null) return whole
  const a = text.indexOf('{'), b = text.lastIndexOf('}')
  return a >= 0 && b > a ? jsonOrNull(text.slice(a, b + 1)) : null
}

/** One call; throws with the endpoint's own message on an error, a timeout or a reply that is not JSON. */
export async function askEndpoint(ai: AiEndpoint, text: string, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = AI_TIMEOUT_MS, own: readonly OwnChannel[] = [], wake: WaitOpts = {}): Promise<unknown> {
  const { url, init } = buildRequest(ai, text, undefined, undefined, own)
  const { res, body } = await post(ai, url, init, fetchFn, timeoutMs, wake)
  if (!res.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`)
  const parsed = parseReply(body)
  if (parsed === null) throw new Error('not JSON')
  return parsed
}

/** One plain-text answer (the Ask your web summary); throws with the endpoint's own message on an error or a timeout. */
export async function askEndpointText(ai: AiEndpoint, system: string, text: string, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = AI_TIMEOUT_MS, own: readonly OwnChannel[] = [], wake: WaitOpts = {}): Promise<string> {
  const { url, init } = buildRequest(ai, text, system, 400, own)
  const { res, body } = await post(ai, url, init, fetchFn, timeoutMs, wake)
  if (!res.ok) throw new Error((body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`)
  const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('empty')
  return content.trim()
}

export type TestOutcome =
  | { ok: true; ms: number; reply: string; /** Wave 39: answered, but not in the JSON shape drafting reads. */ note?: 'not JSON' }
  | { ok: false; message: string; status?: number; raw?: string; timedOut?: boolean }
export interface ResultLine { kind: 'status' | 'message' | 'raw' | 'hint'; text: string; ok?: boolean }

const CUT = 200
function jsonOrNull(t: string): unknown { try { return JSON.parse(t) as unknown } catch { return null } }
const asText = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v) ?? '')

/** The Test button's one call: never throws; keeps the status, the endpoint's own message and the raw text for the result block. */
export async function testEndpoint(ai: AiEndpoint, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = AI_TIMEOUT_MS): Promise<TestOutcome> {
  const { url, init } = buildRequest(ai, 'I want to play padel')
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetchFn(url, { ...init, signal: ctl.signal })
    // The raw text first, so a body that is not JSON at all (an HTML error page) still shows.
    const text = res.text ? await res.text().catch(() => '') : undefined
    const body = text === undefined ? await res.json().catch(() => null) : jsonOrNull(text)
    const raw = body === null ? text || undefined : asText(body)
    if (!res.ok) return { ok: false, status: res.status, message: (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`, raw }
    const content = (body as { choices?: { message?: { content?: unknown } }[] } | null)?.choices?.[0]?.message?.content
    // A reply that is no chat completion at all (a web page, a login form) is a wrong address: that fails. A chat reply in plain words works.
    if (typeof content !== 'string') return { ok: false, message: 'not JSON', raw }
    return { ok: true, ms: Date.now() - t0, reply: content, ...(parseReply(body) === null ? { note: 'not JSON' as const } : {}) }
  } catch (e) {
    return { ok: false, message: (e as Error).message, timedOut: ctl.signal.aborted }
  } finally { clearTimeout(timer) }
}

/** The result block under the Test button: status, the endpoint's message, the first 200 characters of the reply or body, and a hint for the common causes. Never one line. */
export function testResultLines(o: TestOutcome): ResultLine[] {
  if (o.ok) return [{ kind: 'status', ok: true, text: S.aiTestOk(o.ms) }, { kind: 'raw', text: o.reply.slice(0, CUT) }, ...(o.note ? [{ kind: 'hint' as const, text: S.aiTestHintJson }] : [])]
  const hint = o.timedOut ? S.aiTestHintTimeout : o.status === 401 ? S.aiTestHintKey : o.message === 'not JSON' ? S.aiTestHintPage : ''
  return [
    { kind: 'status', ok: false, text: S.aiTestFailed },
    { kind: 'message', text: o.message },
    ...(o.raw ? [{ kind: 'raw' as const, text: o.raw.slice(0, CUT) }] : []),
    ...(hint ? [{ kind: 'hint' as const, text: hint }] : []),
  ]
}
