// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Counting with liquid-democracy semantics (reference: LiquidFeedback delegation, Behrens et al., "The Principles of LiquidFeedback", 2014;
 * Ford, "Delegative Democracy", 2002). One person, one unit of weight (or an explicit weight per voter). A voter who voted keeps their own
 * choice; a voter who did not hands their weight along their delegation chain to the CLOSEST delegate who voted (the cycle break rule: the
 * walk stops where it would revisit someone, and the closest voter on the way wins). No voter on the way: the weight is `lost`, never guessed.
 * Pure: no I/O, no clock (pass `now` for time-bounded delegations).
 */
import { resolve, followersOf, type Delegation } from './delegation.ts'

export interface TallyInput {
  book: readonly Delegation[]
  topic: string
  /** Everyone entitled to vote, weight 1 each; or a map id -> weight. */
  voters: readonly string[] | Readonly<Record<string, number>>
  /** voter id -> choice. Entries of non-voters are ignored. */
  votes: Readonly<Record<string, string>>
  now?: number
}
export interface TallyResult {
  /** choice -> total weight. */
  counts: Record<string, number>
  /** voter -> weight that reached nobody. */
  lost: Record<string, number>
  /** voter -> whose vote carried them (themself when they voted). Absent when lost. */
  carriedBy: Record<string, string>
  total: number
}

export function tally({ book, topic, voters, votes, now }: TallyInput): TallyResult {
  const weights: Record<string, number> = Array.isArray(voters) ? Object.fromEntries((voters as string[]).map((v) => [v, 1])) : { ...(voters as Record<string, number>) }
  const counts: Record<string, number> = {}
  const lost: Record<string, number> = {}
  const carriedBy: Record<string, string> = {}
  let total = 0
  for (const [voter, w] of Object.entries(weights)) {
    total += w
    const carrier = resolve(book, voter, topic, Infinity, now).chain.find((p) => p in weights && Object.hasOwn(votes, p))
    if (carrier === undefined) { lost[voter] = w; continue }
    carriedBy[voter] = carrier
    counts[votes[carrier]] = (counts[votes[carrier]] ?? 0) + w
  }
  return { counts, lost, carriedBy, total }
}

/** The book without the delegations to `to` on `topic`; transitive: also those to anyone who followed `to` (their weight no longer reaches `to`). Cycle-safe. */
export function withdraw(book: readonly Delegation[], to: string, topic: string, transitive = false): Delegation[] {
  const gone = new Set<Delegation>()
  const seen = new Set([to])
  const queue = [to]
  while (queue.length) {
    const cur = queue.shift() as string
    for (const f of followersOf(book, cur, topic)) {
      gone.add(f)
      if (transitive && !seen.has(f.from)) { seen.add(f.from); queue.push(f.from) }
    }
  }
  return book.filter((x) => !gone.has(x))
}
