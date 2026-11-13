// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 assistant: the provider chain (Jakob 2026-11-12: Berget, then Infomaniak, then pc24; a heads-up when none answers), the model
 * and slash commands, the identity line. Pure and DOM-free with NO runtime imports: the app's panel and apps/mcp (node) both run it.
 * Berget and Infomaniak keys live in advanced.assistant.providers (the record, like advanced.ai); the person's own endpoint
 * (advanced.ai: the subscription or Custom, e.g. pc24) is the last link of the chain. Never in the repo.
 */
export const PROVIDER_IDS = ['berget', 'infomaniak', 'pc24'] as const
export type ProviderId = (typeof PROVIDER_IDS)[number]
export type Thinking = 'off' | 'low' | 'medium' | 'high'
export const THINKING: readonly Thinking[] = ['off', 'low', 'medium', 'high']

export interface ProviderCfg { baseUrl: string; apiKey: string; model: string }
/** advanced.assistant: the two hosted providers, who goes first, a model override for the first one, the thinking level. */
export interface AssistantCfg { providers?: { berget?: ProviderCfg; infomaniak?: ProviderCfg }; prefer?: ProviderId; model?: string; thinking?: Thinking }
export interface Provider { id: ProviderId; name: string; baseUrl: string; apiKey: string; model: string }

/** Berget has one public address; Infomaniak's depends on the product id, so the person enters it. Models are unverified defaults (wave 42 report). */
export const PRESET = {
  berget: { name: 'Berget', baseUrl: 'https://api.berget.ai/v1', model: 'meta-llama/Llama-3.3-70B-Instruct' },
  infomaniak: { name: 'Infomaniak', baseUrl: '', model: '' },
} as const

export const TURN_BUDGET_MS = 20_000
/** Pi tiers (/o /s /h) mapped to the model they switch to. */
export const TIER_MODEL = { o: 'claude-opus-5-5', s: 'claude-sonnet-5-5', h: 'claude-haiku-5-5' } as const

interface OwnAi { baseUrl: string; model: string; apiKey: string; name?: string }
const trim = (s: string | undefined): string => (s ?? '').trim()

/** The configured links in order, the preferred one first, the model override on the first. Empty when nothing is set up. */
export function chainOf(advanced: { ai?: OwnAi; assistant?: AssistantCfg } | undefined): Provider[] {
  const a = advanced?.assistant
  const out: Provider[] = []
  for (const id of ['berget', 'infomaniak'] as const) {
    const c = a?.providers?.[id]
    if (!c) continue
    const baseUrl = trim(c.baseUrl) || PRESET[id].baseUrl
    const model = trim(c.model) || PRESET[id].model
    if (trim(c.apiKey) && baseUrl && model) out.push({ id, name: PRESET[id].name, baseUrl, apiKey: trim(c.apiKey), model })
  }
  const own = advanced?.ai
  if (own && trim(own.baseUrl) && trim(own.model)) out.push({ id: 'pc24', name: trim(own.name) || 'pc24', baseUrl: trim(own.baseUrl), apiKey: own.apiKey ?? '', model: trim(own.model) })
  const first = a?.prefer ? out.findIndex((p) => p.id === a.prefer) : -1
  if (first > 0) out.unshift(...out.splice(first, 1))
  if (a?.model && out[0]) out[0] = { ...out[0], model: a.model }
  return out
}

/** /model <id> and the picker: a provider id makes it the first link, any other text is the model id of the first link. */
export function applyModel(cfg: AssistantCfg, id: string): AssistantCfg {
  const v = id.trim()
  if (!v) throw new Error('a model id is needed')
  if ((PROVIDER_IDS as readonly string[]).includes(v)) { const { model: _m, ...rest } = cfg; return { ...rest, prefer: v as ProviderId } }
  return { ...cfg, model: v }
}

export type Command = { cmd: 'clear' } | { cmd: 'tier'; tier: 'o' | 's' | 'h' } | { cmd: 'model'; id: string } | { cmd: 'unknown'; name: string }

/** A message that starts with /word is a command (never sent to the AI); null for everything else, paths included. */
export function parseCommand(text: string): Command | null {
  const m = /^\/([a-z]+)(?:\s+(.*))?$/i.exec(text.trim())
  if (!m) return null
  const name = m[1].toLowerCase()
  if (name === 'clear') return { cmd: 'clear' }
  if (name === 'o' || name === 's' || name === 'h') return { cmd: 'tier', tier: name }
  if (name === 'model') return { cmd: 'model', id: (m[2] ?? '').trim() }
  return { cmd: 'unknown', name }
}

/** Part of the system prompt: the real provider and model, so "which model are you?" has a true answer. */
export const identityLine = (p: Provider): string =>
  `You run on the provider "${p.name}" with the model "${p.model}". When asked who or what you are, or which model or provider you run, say exactly that, as the TrustWeb assistant.`

/** Every provider failed (or none is set up): which were tried and why each failed. */
export class ChainError extends Error {
  readonly tried: string[]
  readonly reason: string
  constructor(tried: string[], reason: string) {
    super(tried.length ? `No AI provider answered (${tried.join(', ')} ${tried.length === 1 ? 'failed' : 'all failed'}): ${reason}` : 'No AI provider is set up')
    this.name = 'ChainError'
    this.tried = tried
    this.reason = reason
  }
}

export interface CallOpts { signal: AbortSignal; firstMs: number }
export interface ChainOpts { signal?: AbortSignal; log?: (line: string) => void; now?: () => number; budgetMs?: number }

/** Tries the links in order, each with its share of the budget for a first answer; the first non-empty answer wins. Logs who answered (I6). */
export async function runChain(chain: readonly Provider[], call: (p: Provider, o: CallOpts) => Promise<string>, o: ChainOpts = {}): Promise<{ text: string; provider: Provider }> {
  const now = o.now ?? Date.now
  const started = now()
  const budget = o.budgetMs ?? TURN_BUDGET_MS
  const signal = o.signal ?? new AbortController().signal
  const reasons: string[] = []
  for (const [i, p] of chain.entries()) {
    const firstMs = Math.max(1, Math.floor((budget - (now() - started)) / (chain.length - i)))
    try {
      const text = await call(p, { signal, firstMs })
      if (!text.trim()) throw new Error('empty answer')
      o.log?.(`${p.name} answered (model ${p.model})`)
      return { text, provider: p }
    } catch (e) {
      if (signal.aborted || (e as Error).name === 'AbortError') throw e
      const why = (e as Error).message || 'failed'
      reasons.push(`${p.name}: ${why}`)
      o.log?.(`${p.name} failed: ${why}`)
    }
  }
  throw new ChainError(chain.map((p) => p.name), reasons.join('; '))
}

/** One whole (non-streamed) answer from an OpenAI-compatible endpoint; throws "HTTP <status>" or the endpoint's own message. apps/mcp uses it. */
export async function completeOnce(p: Provider, messages: readonly { role: string; content: string }[], o: CallOpts, fetchFn: typeof fetch = fetch, thinking?: Thinking): Promise<string> {
  const ctl = new AbortController()
  const stop = (): void => ctl.abort()
  o.signal.addEventListener('abort', stop)
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, o.firstMs)
  try {
    const res = await fetchFn(`${p.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}) },
      body: JSON.stringify({ model: p.model, stream: false, messages, ...(thinking ? { reasoning_effort: thinking === 'off' ? 'none' : thinking } : {}) }),
    })
    const body = await res.json().catch(() => null) as { error?: { message?: string }; choices?: { message?: { content?: unknown } }[] } | null
    if (!res.ok) throw new Error(body?.error?.message ? `HTTP ${res.status}: ${body.error.message}` : `HTTP ${res.status}`)
    const text = body?.choices?.[0]?.message?.content
    if (typeof text !== 'string') throw new Error('not a chat reply')
    return text
  } catch (e) {
    if (timedOut) throw new Error(`no answer within ${Math.round(o.firstMs / 1000)} s`)
    throw e
  } finally { clearTimeout(timer); o.signal.removeEventListener('abort', stop) }
}
