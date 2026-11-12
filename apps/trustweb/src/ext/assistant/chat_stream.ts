// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 40 ai-edit-chat: one streamed chat call to the person's own AI (Settings > AI), OpenAI-compatible, the same address, key
 * and headers as llm_endpoint.ts. A reply that is not a stream (some servers ignore "stream") is read whole. The person's own
 * addresses are scrubbed from what they type, as everywhere else (channel_readers.ts).
 */
import { type OwnChannel, scrubFor } from '../../channel_readers'
import { buildRequest } from '../../llm_endpoint'
import type { AiEndpoint } from '../../model'
import { createSseReader } from './protocol'

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export const STREAM_TIMEOUT_MS = 120_000

/** Streams the answer; onText gets the whole text so far after every piece. Resolves with the full text; throws with the endpoint's message. */
export async function streamChat(ai: AiEndpoint, messages: readonly ChatMessage[], onText: (full: string) => void, signal: AbortSignal, own: readonly OwnChannel[] = [], maxTokens = 1500): Promise<string> {
  const { url, init } = buildRequest(ai, '', undefined, maxTokens)
  const body = { ...(JSON.parse(init.body) as Record<string, unknown>), stream: true, messages: messages.map((m) => (m.role === 'user' ? { ...m, content: scrubFor(m.content, own, ai.preset) } : m)) }
  const ctl = new AbortController()
  const stop = (): void => ctl.abort()
  signal.addEventListener('abort', stop)
  const timer = setTimeout(stop, STREAM_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, body: JSON.stringify(body), signal: ctl.signal })
    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: { message?: string } } | null
      throw new Error(err?.error?.message ?? `HTTP ${res.status}`)
    }
    if (!res.body || !(res.headers.get('content-type') ?? '').includes('event-stream')) {
      const whole = await res.json().catch(() => null) as { choices?: { message?: { content?: unknown } }[] } | null
      const text = whole?.choices?.[0]?.message?.content
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
      const pieces = sse.push(dec.decode(value, { stream: true }))
      if (pieces.length) { full += pieces.join(''); onText(full) }
      if (sse.done()) { void reader.cancel().catch(() => undefined); break }
    }
    return full
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', stop)
  }
}
