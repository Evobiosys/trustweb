// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Zone proposals and the owner's curation write (wave 27, F6 and F8). Pure: no DOM, no network, no storage.
 * A proposal never reaches Close or Closest: inference caps at Friend (decision D2). Every proposal names its
 * evidence and its three terms (I6) and says it is not verified (I7). Nothing is written until the owner chooses (I9).
 */
import { Ring } from './model'
import { INFER, score, type Interaction, type Terms } from './zone_infer'

export type Tier = 'friend' | 'community' | 'acquaintance'
export type Flag = 'one-way' | 'possible-duplicate'

export const PROPOSAL_LABEL = 'inferred, not verified'
const YEAR_MS = 365 * 86_400_000

/**
 * GUESS (open point): the spec names a Community tier but the Ring enum has no slot for it. Community maps to the
 * Friend ring, the ladder's "friends and community members" tier; the owner can change it per row.
 */
export const RING_OF_TIER: Record<Tier, Ring> = {
  friend: Ring.Friend,
  community: Ring.Friend,
  acquaintance: Ring.Acquaintance,
}

export interface Candidate extends Interaction {
  personKey: string
  /** Evidence row ids the counts came from. */
  ids: string[]
  /** The name-only duplicate check flagged this person. */
  dupe?: boolean
}

export interface Proposal {
  personKey: string
  tier: Tier
  ring: Ring
  score: number
  terms: Terms
  n365: number
  evidenceIds: string[]
  flags: Flag[]
  label: typeof PROPOSAL_LABEL
}

/** Friend needs reciprocity: a one-way flow tops out at Community (a GUESS, see the test "500 out and 0 in"). */
function tierOf(s: number, c: Candidate): Tier {
  if (c.n365 === 0 && c.lastTs === undefined) return 'acquaintance'
  if (s >= INFER.friendAt && c.out > 0 && c.in > 0) return 'friend'
  if (s >= INFER.communityAt) return 'community'
  return 'acquaintance'
}

export function propose(list: readonly Candidate[], now: number): Proposal[] {
  return list
    .map((c): Proposal => {
      const { score: s, terms } = score(c, now)
      const tier = tierOf(s, c)
      const flags: Flag[] = []
      if (c.n365 > 0 && (c.out === 0 || c.in === 0)) flags.push('one-way')
      if (c.dupe) flags.push('possible-duplicate')
      return {
        personKey: c.personKey,
        tier,
        ring: RING_OF_TIER[tier],
        score: s,
        terms,
        n365: c.n365,
        evidenceIds: s > 0 ? [...c.ids] : [],
        flags,
        label: PROPOSAL_LABEL,
      }
    })
    .sort((a, b) => b.score - a.score || a.personKey.localeCompare(b.personKey))
}

/** Bulk accept is offered only for rows with no flags (F8). */
export const bulkAcceptable = (p: Proposal): boolean => p.flags.length === 0

export type Choice = { do: 'accept' } | { do: 'change'; ring: Ring } | { do: 'leave' }

export interface ZoneWrite {
  ring: Ring
  /** The in_zone tuple: valid from now, expiring after a year (I9). */
  inZone: { ring: Ring; since: number; until: number }
}

/** What to write for one owner choice; null for Leave (nothing is written). */
export function writeFor(p: Proposal, choice: Choice, now: number): ZoneWrite | null {
  if (choice.do === 'leave') return null
  const ring = choice.do === 'accept' ? p.ring : choice.ring
  return { ring, inZone: { ring, since: now, until: now + YEAR_MS } }
}
