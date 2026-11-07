// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 36 llm-button: the "Your AI" button in the Web header shows only with an endpoint saved AND the pi agent answering on this device.
 * Pure, no DOM. The /health contract a pi extension must serve: GET <baseUrl>/health -> 200 {"agent":"pi"} (loopback only).
 */
import type { AgentLink } from './model'

export const AGENT_DEFAULT_URL = 'http://127.0.0.1:7391'
/** A check holds for 10 minutes. */
export const AGENT_TTL_MS = 10 * 60_000
export const AGENT_TIMEOUT_MS = 2_000

export const aiButtonVisible = (on: { configured: boolean; piConnected: boolean }): boolean => on.configured && on.piConnected

export function piConnected(agent: AgentLink | undefined, nowMs: number): boolean {
  const at = agent?.connectedAt ? Date.parse(agent.connectedAt) : NaN
  return Number.isFinite(at) && at <= nowMs && nowMs - at < AGENT_TTL_MS
}

/** http only, and only this device. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)
  } catch { return false }
}

type AgentFetch = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** True when <baseUrl>/health answers 200 with {agent:"pi"} within the timeout; false on anything else, never throws. */
export async function checkAgent(baseUrl: string, fetchFn: AgentFetch = fetch as unknown as AgentFetch, timeoutMs = AGENT_TIMEOUT_MS): Promise<boolean> {
  if (!isLoopbackUrl(baseUrl)) return false
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetchFn(`${baseUrl.trim().replace(/\/+$/, '')}/health`, { signal: ctl.signal })
    return res.status === 200 && ((await res.json()) as { agent?: unknown } | null)?.agent === 'pi'
  } catch { return false } finally { clearTimeout(timer) }
}
