/**
 * "Ask only my direct contacts" (wave 3, Settings > Advanced; Jakob 2026-10-07:
 * "per default ... in advanced settings one should be able to specify just
 * asking one's direct contacts"). The default stays one hop plus whatever the
 * front doors allow; with the setting on, every ask carries `direct: true`
 * (apps/demo/src/types.ts QueryEnvelope.direct) and these rules decide what a
 * device that receives it may do. DOM-free: the unit tests and the peer
 * service (services/trustweb-peer) can import the exact rules.
 */
import type { QueryEnvelope } from '../../demo/src/types'

/** The flag an outgoing ask carries: `{ direct: true }` with the setting on, nothing otherwise (older builds ignore it). */
export function directFlag(directOnly: boolean): Pick<QueryEnvelope, 'direct'> {
  return directOnly ? { direct: true } : {}
}

/**
 * May a device that received this ask pass it on to anyone else (a second
 * hop, or a front door forwarding it to another person)? Never for an ask
 * that was already passed on once (`relayed`, the one-hop cap) and never for
 * one whose asker wanted their direct contacts only.
 */
export function mayPassOn(q: Pick<QueryEnvelope, 'relayed' | 'direct'>): boolean {
  return q.relayed !== true && q.direct !== true
}

/**
 * Is this ask put in front of the person at all? An ask that arrives passed on
 * (`relayed`) although its asker wanted direct contacts only was forwarded
 * against the asker's wish: it is answered like no match (the same sealed
 * "nothing", at the same moment), never shown.
 */
export function surfacesHere(q: Pick<QueryEnvelope, 'relayed' | 'direct'>): boolean {
  return !(q.relayed === true && q.direct === true)
}
