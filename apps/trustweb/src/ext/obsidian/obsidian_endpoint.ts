// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync, rule changed in wave 42 (Q01; tightened by Jakob 2026-11-12): the one place that decides where vault text may go. ALLOW-LIST:
 * the pc24 preset ONLY (name "pc24" at its own address, an SSH tunnel on localhost:11435). Every other address, loopback included, needs a confirmation
 * per host that names host and model (obsidian_prefs.ts); it is not "own" just because it was typed. Plain http only to loopback. The subscription,
 * OpenAI and Claude presets are refused, and so is any hosted AI service (HOSTED, subdomains included) as a second guard, confirmed or not. With no
 * endpoint set up no request exists at all (makeAsk returns null). The request is the app's own OpenAI-compatible call (llm_endpoint.ts
 * buildRequest), never following a redirect.
 */
import type { AiEndpoint } from '../../model'
import { apiBase } from '../../ai_subscription'
import { AI_TIMEOUT_MS, CUSTOM_PRESETS, buildRequest, configured, customPresetOf, parseReply } from '../../llm_endpoint'
import type { FetchLike } from '../../llm_endpoint'
import { SHORT_LINK_ORIGINS } from '../../short_link'

export const INGEST_MAX_TOKENS = 3000
/** A reply on a 35B model can take a while; the owner can pause or stop at any time. */
export const INGEST_TIMEOUT_MS = Math.max(AI_TIMEOUT_MS, 180_000)

export type Trust = 'allowed' | 'confirm'
export type Target = { ok: true; host: string; model: string; label: string; trust: Trust; loopback: boolean } | { ok: false; why: 'none' | 'cloud' | 'notlocal' | 'insecure' }

/** Hosted AI services (and every subdomain of them): the owner's notes never go there, whatever preset the address is typed under. */
const HOSTED = [
  'api.openai.com', 'openai.azure.com', 'api.anthropic.com', 'openrouter.ai', 'generativelanguage.googleapis.com', 'api.mistral.ai', 'api.groq.com',
  'api.together.xyz', 'api.cohere.ai', 'api.cohere.com', 'api.x.ai', 'api.deepseek.com',
]
const hostOf = (url: string): string => { try { return new URL(url).host } catch { return '' } }
/** The TrustWeb subscription: this app's own server (same origin unless a dev base is set) and the TrustWeb sites. */
export const SUBSCRIPTION_HOSTS: readonly string[] = [...new Set([...SHORT_LINK_ORIGINS.map(hostOf), hostOf(apiBase())].filter(Boolean))]

const bare = (hostname: string): string => hostname.toLowerCase().replace(/\.+$/, '')
const isHosted = (hostname: string): boolean => [...HOSTED, ...SUBSCRIPTION_HOSTS.map((h) => bare(h.split(':')[0]))].some((h) => hostname === h || hostname.endsWith(`.${h}`))
const isLoopback = (hostname: string): boolean => hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname)

export type Rule = { trust: Trust | 'refused'; why?: 'none' | 'cloud' | 'insecure'; host: string; loopback: boolean }
const PC24_HOST = hostOf(CUSTOM_PRESETS.find((p) => p.id === 'pc24')!.baseUrl)

/** Q01 as a pure function of the typed address and its name: the pc24 preset = allowed; hosted AI = refused; plain http off loopback = refused; any other host (loopback too) = confirm (per host). */
export function endpointRule(baseUrl: string, name?: string): Rule {
  let url: URL
  try { url = new URL(baseUrl.trim()) } catch { return { trust: 'refused', why: 'none', host: '', loopback: false } }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { trust: 'refused', why: 'none', host: '', loopback: false }
  const hostname = bare(url.hostname)
  const loopback = isLoopback(hostname)
  if (loopback) return { trust: name === 'pc24' && url.host === PC24_HOST ? 'allowed' : 'confirm', host: url.host, loopback }
  if (isHosted(hostname)) return { trust: 'refused', why: 'cloud', host: url.host, loopback }
  if (url.protocol === 'http:') return { trust: 'refused', why: 'insecure', host: url.host, loopback }
  return { trust: 'confirm', host: url.host, loopback }
}

export function ingestTarget(ai: AiEndpoint | undefined): Target {
  if (!configured(ai)) return { ok: false, why: 'none' }
  if (ai.preset !== 'custom' && ai.preset !== 'ollama') return { ok: false, why: 'cloud' }
  const rule = endpointRule(ai.baseUrl, ai.name)
  if (rule.trust === 'refused' && rule.why !== 'insecure') return { ok: false, why: rule.why! }
  if (ai.preset === 'ollama' && !rule.loopback) return { ok: false, why: 'notlocal' }
  if (rule.trust === 'refused') return { ok: false, why: rule.why! }
  return { ok: true, host: rule.host, model: ai.model.trim(), label: ai.name?.trim() || rule.host, trust: rule.trust, loopback: rule.loopback }
}

/** May the notes go there now? The pc24 preset: yes. Another host: only after the owner confirmed that host. */
export const mayRun = (t: Target, confirmed: (host: string) => boolean): boolean => t.ok && (t.trust === 'allowed' || confirmed(t.host))

export type Ask = (system: string, user: string, signal?: AbortSignal) => Promise<unknown>

/** null when the target is refused. */
export function makeAsk(ai: AiEndpoint | undefined, fetchFn: FetchLike = fetch as unknown as FetchLike, timeoutMs = INGEST_TIMEOUT_MS): Ask | null {
  if (!ingestTarget(ai).ok) return null
  const endpoint = ai as AiEndpoint
  return async (system, user, signal) => {
    signal?.throwIfAborted()
    const { url, init } = buildRequest(endpoint, user, system, INGEST_MAX_TOKENS, [])
    // pc24's qwen3.6 answers fast with thinking off (wave 40 report); other servers get the plain request.
    const body = customPresetOf(endpoint) === 'pc24' ? JSON.stringify({ ...JSON.parse(init.body), reasoning_effort: 'none' }) : init.body
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    const stop = (): void => ctl.abort()
    signal?.addEventListener('abort', stop, { once: true })
    try {
      // No redirect (a 307/308 would forward the notes to a host the owner never saw), no cookies, no referrer.
      const res = await fetchFn(url, { ...init, body, signal: ctl.signal, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error((json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`)
      const parsed = parseReply(json)
      if (parsed === null) throw new Error('not JSON')
      return parsed
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop) }
  }
}
