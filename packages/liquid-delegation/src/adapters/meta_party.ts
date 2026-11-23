// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Meta-party adapter (meta-democracy.org): ports for electorate and votes, no personal data and no storage in this module. */
import { tally, type TallyResult } from '../tally.ts'
import type { Delegation } from '../delegation.ts'

export interface MetaPartyPorts {
  /** Who may vote on the proposal: ids, or id -> weight. */
  voters(proposal: string): readonly string[] | Readonly<Record<string, number>>
  votes(proposal: string): Readonly<Record<string, string>>
  now(): number
  /** The delegation topic of a proposal (e.g. its policy area); default: the proposal id itself. */
  topicOf?(proposal: string): string
}

export function countProposal(ports: MetaPartyPorts, book: readonly Delegation[], proposal: string): TallyResult {
  return tally({ book, topic: ports.topicOf?.(proposal) ?? proposal, voters: ports.voters(proposal), votes: ports.votes(proposal), now: ports.now() })
}
