// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-support: asks the MCP server wrote into the record (it has no network) are sent when the app starts: a `queued` ask
 * goes to each person it names, a `cancelled` one is withdrawn from the people it went to. Pure planning; main.ts does the sending.
 * Review wave 42 (I9, Jakob 2026-11-12): an ask an agent prepared (`agent`) is NOT sent at start; the app shows it as a card and sends it on a tap.
 */
import type { SupportAsk } from './support_ask'
import { isOpen } from './support_ask'

export interface FlushPlan { send: SupportAsk[]; withdraw: SupportAsk[]; keep: SupportAsk[] }

/** A queued ask that already ended is dropped unsent; a cancelled one is withdrawn, then dropped. */
export function planFlush(asks: readonly SupportAsk[] | undefined, now: number): FlushPlan {
  const list = asks ?? []
  const withdraw = list.filter((a) => a.cancelled && !a.queued)
  const send = list.filter((a) => a.queued && !a.agent && !a.cancelled && isOpen(a, now))
  const keep = list.filter((a) => !a.cancelled && !(a.queued && !isOpen(a, now))).map((a) => { const { queued: _q, ...rest } = a; return a.queued && !a.agent ? rest : a })
  return { send, withdraw, keep }
}

/** The asks an agent prepared that still wait for a tap and are open. */
export const agentAsks = (asks: readonly SupportAsk[] | undefined, now: number): SupportAsk[] => (asks ?? []).filter((a) => a.agent && a.queued && !a.cancelled && isOpen(a, now))

/** Send tapped: the ask loses its marks (it is an ordinary sent ask now) and comes back to be sent; null when no such waiting ask exists. */
export function approveAgentAsk(asks: readonly SupportAsk[] | undefined, id: string): { asks: SupportAsk[]; ask: SupportAsk | null } {
  const list = asks ?? []
  const found = list.find((a) => a.id === id && a.agent && a.queued)
  if (!found) return { asks: [...list], ask: null }
  const { queued: _q, agent: _a, ...ask } = found
  return { asks: list.map((a) => (a === found ? ask : a)), ask }
}

/** Discard tapped: the waiting ask is gone, unsent. */
export const discardAgentAsk = (asks: readonly SupportAsk[] | undefined, id: string): SupportAsk[] => (asks ?? []).filter((a) => !(a.id === id && a.agent && a.queued))
