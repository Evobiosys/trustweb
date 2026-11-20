// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Liquid delegation, pure (wave 45 settings-suggest): who follows whom per topic. A delegation says "`from` follows `to` on `topic`";
 * each (from, topic) has at most one delegate, so the book is a forest per topic and a chain A->B->C is the walk from A.
 * The app resolves chains to depth MAX_DEPTH (1: the person I follow, not whom they follow); `resolve` already walks any depth and stops
 * on a cycle, so a later session can raise the depth to full liquid democracy without a new data shape.
 * Ids are opaque strings (the app uses person ids and 'me'); topics too (the app uses settings groups). No I/O, no clock, inputs never mutated.
 */
export interface Delegation {
  from: string
  to: string
  topic: string
  /** The follower takes the delegate's choice without asking (the app: auto-apply). */
  auto: boolean
  /** ms since epoch, when the delegation was made. */
  since: number
}

/** How far a chain is followed today: only the direct delegate. */
export const MAX_DEPTH = 1

const same = (x: Delegation, from: string, topic: string): boolean => x.from === from && x.topic === topic

/** The book with `d` in it, replacing what `d.from` delegated on `d.topic` before. Throws on a delegation to oneself. */
export function delegate(book: readonly Delegation[], d: Delegation): Delegation[] {
  if (d.from === d.to) throw new Error('a delegation to oneself is no delegation')
  return [...book.filter((x) => !same(x, d.from, d.topic)), { ...d }]
}

/** The book without what `from` delegated on `topic`. */
export const revoke = (book: readonly Delegation[], from: string, topic: string): Delegation[] => book.filter((x) => !same(x, from, topic))

/** The book with that delegation's auto flag set; unchanged when there is none. */
export const setAuto = (book: readonly Delegation[], from: string, topic: string, auto: boolean): Delegation[] =>
  book.map((x) => (same(x, from, topic) ? { ...x, auto } : x))

export const delegateOf = (book: readonly Delegation[], from: string, topic: string): Delegation | undefined => book.find((x) => same(x, from, topic))

/** Who follows `to` on `topic` (direct followers only), in book order. */
export const followersOf = (book: readonly Delegation[], to: string, topic: string): Delegation[] => book.filter((x) => x.to === to && x.topic === topic)

export interface Resolution {
  /** `from` first, then each delegate followed. */
  chain: string[]
  /** Whose choice counts for `from`: the last in the chain, or null when `from` follows nobody. */
  final: string | null
  /** The walk came back to someone already in the chain. */
  cycle: boolean
  /** The depth limit stopped the walk while the chain went on. */
  truncated: boolean
}

/** Walks the delegations of `from` on `topic`, at most `maxDepth` steps. */
export function resolve(book: readonly Delegation[], from: string, topic: string, maxDepth: number = MAX_DEPTH): Resolution {
  const chain = [from]
  let cur = from
  for (;;) {
    const next = delegateOf(book, cur, topic)
    if (!next) return { chain, final: chain.length > 1 ? cur : null, cycle: false, truncated: false }
    if (chain.includes(next.to)) return { chain, final: chain.length > 1 ? cur : null, cycle: true, truncated: false }
    if (chain.length > maxDepth) return { chain, final: cur, cycle: false, truncated: true }
    chain.push(next.to)
    cur = next.to
  }
}

/** A stored book read back: well-formed rows only, never one to oneself, the last row per (from, topic). */
export function cleanDelegations(raw: unknown): Delegation[] {
  if (!Array.isArray(raw)) return []
  let book: Delegation[] = []
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue
    const { from, to, topic, auto, since } = r
    if (typeof from !== 'string' || !from || typeof to !== 'string' || !to || typeof topic !== 'string' || !topic || from === to) continue
    book = delegate(book, { from, to, topic, auto: auto === true, since: typeof since === 'number' && Number.isFinite(since) ? since : 0 })
  }
  return book
}
