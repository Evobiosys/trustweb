// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: one streamed chat call to an OpenAI-compatible endpoint, the same address, key and headers as llm_endpoint.ts.
 * A reply that is not a stream (some servers ignore "stream") is read whole. The person's own addresses are scrubbed from what they
 * type, as everywhere else (channel_readers.ts).
 * Wave 42: a provider that says nothing within `firstMs` (then `idleMs` between pieces) ends with a "no answer" error, never silence;
 * streamChain walks the provider chain (providers.ts) with the identity of each provider in its own system prompt.
 */
import { type OwnChannel, scrubFor } from '../../channel_readers'
import { buildRequest } from '../../llm_endpoint'
import type { AiEndpoint } from '../../model'
import { createSseReader } from './protocol'
import { runChain, type ChainOpts, type Provider, type Thinking } from './providers'

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export const STREAM_TIMEOUT_MS = 120_000
/** Longest silence between two pieces of a stream that already started. */
export const IDLE_MS = 20_000

export interface StreamOpts { fetchFn?: typeof fetch; firstMs?: number; idleMs?: number; thinking?: Thinking }

/** Streams the answer; onText gets the whole text so far after every piece. Resolves with the full text; throws with the endpoint's message. */
export async function streamChat(ai: AiEndpoint, messages: readonly ChatMessage[], onText: (full: string) => void, signal: AbortSignal, own: readonly OwnChannel[] = [], maxTokens = 1500, opts: StreamOpts = {}): Promise<string> {
  const { url, init } = buildRequest(ai, '', undefined, maxTokens)
  const body = {
    ...(JSON.parse(init.body) as Record<string, unknown>), stream: true,
    ...(opts.thinking ? { reasoning_effort: opts.thinking === 'off' ? 'none' : opts.thinking } : {}),
    messages: messages.map((m) => (m.role === 'user' ? { ...m, content: scrubFor(m.content, own, ai.preset) } : m)),
  }
  const ctl = new AbortController()
  const stop = (): void => ctl.abort()
  signal.addEventListener('abort', stop)
  let silent = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (ms: number): void => { clearTimeout(timer); silent = ms; timer = setTimeout(() => { silent = -ms; ctl.abort() }, ms) }
  const whole = setTimeout(stop, STREAM_TIMEOUT_MS)
  arm(opts.firstMs ?? IDLE_MS)
  try {
    const res = await (opts.fetchFn ?? fetch)(url, { ...init, body: JSON.stringify(body), signal: ctl.signal })
    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: { message?: string } } | null
      throw new Error(err?.error?.message ? `HTTP ${res.status}: ${err.error.message}` : `HTTP ${res.status}`)
    }
    if (!res.body || !(res.headers.get('content-type') ?? '').includes('event-stream')) {
      const all = await res.json().catch(() => null) as { choices?: { message?: { content?: unknown } }[] } | null
      const text = all?.choices?.[0]?.message?.content
      if (typeof text !== 'string') throw new Error('not a chat reply')
      onText(text)
      return text
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    const sse = createSseReader()
    let full = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      arm(opts.idleMs ?? IDLE_MS)
      const pieces = sse.push(dec.decode(value, { stream: true }))
      if (pieces.length) { full += pieces.join(''); onText(full) }
      if (sse.done()) { void reader.cancel().catch(() => undefined); break }
    }
    return full
  } catch (e) {
    if (silent < 0 && !signal.aborted) throw new Error(`no answer within ${Math.round(-silent / 1000)} s`)
    throw e
  } finally {
    clearTimeout(timer)
    clearTimeout(whole)
    signal.removeEventListener('abort', stop)
  }
}

/** One turn over the chain: each provider gets its own messages (build) and the person's thinking level; resolves with who answered. */
export function streamChain(chain: readonly Provider[], build: (p: Provider) => ChatMessage[], onText: (full: string) => void, signal: AbortSignal, own: readonly OwnChannel[] = [], o: ChainOpts & { fetchFn?: typeof fetch; thinking?: Thinking; maxTokens?: number } = {}): ReturnType<typeof runChain> {
  return runChain(chain, (p, c) => {
    const ai: AiEndpoint = { preset: 'custom', baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model }
    onText('')
    return streamChat(ai, build(p), onText, c.signal, own, o.maxTokens ?? 1500, { fetchFn: o.fetchFn, firstMs: c.firstMs, thinking: o.thinking })
  }, { signal, ...(o.log ? { log: o.log } : {}), ...(o.now ? { now: o.now } : {}), ...(o.budgetMs ? { budgetMs: o.budgetMs } : {}) })
}
