// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (D2): an agent may assign a share up to AGENT_SHARE_CEILING (Close). Anything above it becomes a proposal that needs
 * the owner's tap and writes no tuple until then. Every agent decision is logged as one readable line (I6). Pure.
 */
import type { Store } from './tuples'
import { Zone, rank } from './zones'

export const AGENT_SHARE_CEILING = Zone.Close
const YEAR_MS = 365 * 86_400_000

export interface Clamp { allowed: boolean; needsTap: boolean }

export function clampAgentShare(zone: Zone): Clamp {
  const within = rank(zone) <= rank(AGENT_SHARE_CEILING)
  return { allowed: within, needsTap: !within }
}

export interface AgentInput {
  agentId: string
  personId: string
  itemId: string
  zone: Zone
  reason: string
  credence: number
  now: Date
  /** The device that writes the tuple. */
  by: string
}

export interface AgentDecision {
  by: string
  reason: string
  credence: number
  outcome: 'assigned' | 'proposed'
  /** One line, for the owner's log. */
  text: string
}

export interface AgentResult { store: Store; needsTap: boolean; log: AgentDecision }

export function assignByAgent(store: Store, a: AgentInput): AgentResult {
  const { needsTap } = clampAgentShare(a.zone)
  const by = `agent:${a.agentId}`
  const outcome = needsTap ? 'proposed' : 'assigned'
  const reason = a.reason.replace(/\s+/g, ' ').trim()
  const text = `${a.now.toISOString()} ${by} ${outcome} zone:${a.zone} for ${a.personId} on ${a.itemId}: ${reason} (credence ${a.credence.toFixed(2)})`
  const log: AgentDecision = { by, reason, credence: a.credence, outcome, text }
  if (needsTap) return { store, needsTap, log }
  const since = a.now.toISOString()
  const grant = { subject: `zone:${a.zone}`, relation: 'may_read' as const, object: a.itemId, since, until: new Date(+a.now + YEAR_MS).toISOString(), by: a.by }
  return { store: [...store, grant], needsTap, log }
}
