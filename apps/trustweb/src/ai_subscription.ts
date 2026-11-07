// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 ai-subscription: the TrustInTheWeb.com AI subscription on the device. Pure, fetch injected, no DOM.
 * Contract: trustweb-ops DEVLOG/wave36b/ai-subscription/contract-ai-subscription.txt (plans table = the server's).
 */
import type { AiEndpoint, AiSubscription } from './model'

export const PLANS = {
  ai: { euro: 18, quota: 1500 },
  light: { euro: 5, quota: 300 },
} as const

export type PlanId = keyof typeof PLANS

/** Dev/test only (VITE_TW_API_BASE); '' = same origin (app.trustweb.one/api/...). */
export const apiBase = (): string => import.meta.env?.VITE_TW_API_BASE ?? ''

/** 32 random bytes as 43 base64url chars; the device keeps it and proves with it that a sign-up is its own. */
export function makeClaim(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(32))): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The server's rule: trimmed, at most 254 chars, one @, a dot in the domain, no white space, control character, <, >, comma or quote. */
// eslint-disable-next-line no-control-regex
export const validEmail = (email: string): boolean => /^[^\s@<>,"\x00-\x1f\x7f]+@[^\s@<>,"\x00-\x1f\x7f]+\.[^\s@<>,"\x00-\x1f\x7f]+$/.test(email.trim()) && email.trim().length <= 254

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export interface SignUpReply { ref: string; plan: PlanId; amount_eur: number; state: 'pending'; mail: 'sent' | 'not-sent' }
export interface PollReply { state: 'pending' | 'active' | 'revoked'; plan?: PlanId; quota?: number; used?: number; month?: string; token?: string }

/** One call; throws with the server's own message (error string or error.message). */
async function call<T>(fetchFn: Fetch, url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<T> {
  const res = await fetchFn(url, init)
  const body = await res.json().catch(() => null) as { error?: string | { message?: string } } | null
  if (!res.ok) {
    const e = body?.error
    throw new Error((typeof e === 'string' ? e : e?.message) ?? `HTTP ${res.status}`)
  }
  return body as T
}

export const signUp = (fetchFn: Fetch, base: string, o: { plan: PlanId; email: string; claim: string }): Promise<SignUpReply> =>
  call(fetchFn, `${base}/api/subscribe`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: o.plan, email: o.email.trim(), claim: o.claim }) })

export const poll = (fetchFn: Fetch, base: string, ref: string, claim: string): Promise<PollReply> =>
  call(fetchFn, `${base}/api/subscribe/${encodeURIComponent(ref)}`, { method: 'GET', headers: { 'X-TW-Claim': claim } })

/** The endpoint an active subscription fills in: askEndpoint appends /chat/completions; the server picks the model. */
export const activeEndpoint = (base: string, token: string): AiEndpoint => ({ preset: 'tw-subscription', baseUrl: `${base}/api/ai`, apiKey: token, model: 'trustweb' })

/** A legacy 'pc24' record becomes a custom endpoint named pc24, otherwise unchanged. */
export function migrateAi(ai: AiEndpoint | undefined): AiEndpoint | undefined {
  return ai?.preset === 'pc24' ? { ...ai, preset: 'custom', name: 'pc24' } : ai
}

/** Jakob's dev record only (main.ts); the stock build never seeds it. */
export const devPc24Seed = (): AiEndpoint => ({ preset: 'custom', name: 'pc24', baseUrl: 'http://localhost:11435/v1', apiKey: '', model: 'qwen3.6:35b' })

export const presetLabel = (ai: AiEndpoint): string => (ai.preset === 'custom' && ai.name ? `Custom: ${ai.name}` : 'Custom')

/** Where a sign-up stands after a poll: the endpoint (the subscription's once a token arrives) and the quota line. */
/** Opening Your AI re-checks a pending or active sign-up (usage, approval, a revoke); a revoked one stays as it is. */
export const pollsOnOpen = (sub: Pick<AiSubscription, 'state'> | undefined): boolean => sub?.state === 'pending' || sub?.state === 'active'

export interface Checked { ai: AiEndpoint; used?: number; quota?: number }

/** One poll of a pending or active sign-up; throws with the server's message. A delivered token switches the endpoint to the subscription. */
export async function checkSubscription(fetchFn: Fetch, base: string, ai: AiEndpoint): Promise<Checked> {
  const sub = ai.sub
  if (!sub) return { ai }
  const r = await poll(fetchFn, base, sub.ref, sub.claim)
  const next: AiSubscription = { ...sub, state: r.state, ...(r.token ? { token: r.token } : {}) }
  const out = r.token ? { ...activeEndpoint(base, r.token), sub: next } : { ...ai, sub: next }
  return { ai: out, used: r.used, quota: r.quota }
}
