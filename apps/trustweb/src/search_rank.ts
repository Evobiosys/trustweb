// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (sovereign-switch): the social search ranking. Pure, DOM-free, deterministic: the clock comes in as `ctx.now`.
 *
 *   score = w_zone * zone/6 + w_tag * jaccard(ctx.tags, person tags) + w_recency * exp(-days/recencyDays)
 *         + w_recip * min(out,in)/max(out,in) + w_text * fuzzy text match
 *
 * Explainable: `terms` are the RAW parts, each in 0..1 (before the weights); `score` is their weighted sum, so a UI can show
 * "closeness 0.83, tags 0.5, ..." and the weights (RANK) tell how much each counted. Sorting is stable: score desc, then the
 * original index, so equal scores keep the order the caller had.
 */
import { tokenize } from '../../demo/src/match/normalize'
import { ChatDirection } from './chat'
import type { ChatThread } from './chat'
import { scoreTokens } from './fuzzy'
import { Ring, ringSlot } from './model'
import type { Person } from './model'

/** All tuning in one place. The five weights sum to 1, so a score is in 0..1. */
export const RANK = {
  w_zone: 0.35, w_tag: 0.25, w_recency: 0.2, w_recip: 0.1, w_text: 0.1,
  recencyDays: 90,
} as const

const DAY_MS = 86_400_000
const ZONE_TOP = 6

/**
 * GUESS (owner to confirm): trust ladder 0..6, closest > close friends and allies > friends and community members > acquaintances > public.
 * The app has no "public" ring; Intending (someone met only on the way in) takes the 2 slot, None and Unsorted sit at 0.
 * Family counts as the ring of its closeness (ringSlot).
 */
const ZONE_RANK: Partial<Record<Ring, number>> = {
  [Ring.Closest]: 6, [Ring.Close]: 5, [Ring.Friend]: 4, [Ring.Acquaintance]: 3, [Ring.Intending]: 2,
}

/** What the ranker reads of a person (or peer): all but `ring` optional, absent = no signal. */
export interface RankCandidate {
  ring: Ring
  fields?: Record<string, string>
  /** ms of the newest contact (chat, timeline, meeting...). Absent: unknown, recency 0. */
  lastContactAt?: number
  /** Messages I sent / they sent. Absent or both 0: reciprocity 0. */
  outCount?: number
  inCount?: number
  /** The words the query is matched against (name, context ...). */
  text?: string
}

export interface RankContext {
  now: number
  /** The typed query; empty or absent: the text term is 0 for everybody. */
  query?: string
  /** The tags (field ids with value 'true') the search is about, e.g. a chosen colour tag. */
  tags?: readonly string[]
}

export interface RankTerms { zone: number; tag: number; recency: number; recip: number; text: number }
export interface Ranked<T> { person: T; score: number; terms: RankTerms }

const unit = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0)

/** 0..6 by trust zone. */
export function zoneRank(p: Pick<Person, 'ring' | 'fields'>): number {
  return ZONE_RANK[ringSlot(p)] ?? 0
}

/** A person's tags: the field ids whose value is 'true' (the Tana checkbox fields; colour_tags.ts reads the same). */
export function tagsOfFields(fields: Record<string, string> | undefined): string[] {
  return Object.keys(fields ?? {}).filter((k) => String(fields?.[k]) === 'true')
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  const A = new Set(a), B = new Set(b)
  let both = 0
  for (const x of A) if (B.has(x)) both++
  const all = A.size + B.size - both
  return all === 0 ? 0 : both / all
}

/** Last contact, and messages out / in, of one chat thread (the signals the ranker needs from AppState.chats). */
export function threadStats(t: Pick<ChatThread, 'messages'> | undefined): Pick<RankCandidate, 'lastContactAt' | 'outCount' | 'inCount'> {
  const m = t?.messages ?? []
  return {
    lastContactAt: m.reduce((a, x) => Math.max(a, x.at), 0) || undefined,
    outCount: m.filter((x) => x.dir === ChatDirection.Out).length,
    inCount: m.filter((x) => x.dir === ChatDirection.In).length,
  }
}

function textMatch(query: string | undefined, text: string | undefined): number {
  const q = [...new Set(tokenize(query ?? ''))]
  if (!q.length || !text) return 0
  return unit(scoreTokens(q, tokenize(text)) / q.length)
}

function termsOf(p: RankCandidate, ctx: RankContext): RankTerms {
  const days = typeof p.lastContactAt === 'number' ? Math.max(0, (ctx.now - p.lastContactAt) / DAY_MS) : Infinity
  const hi = Math.max(p.outCount ?? 0, p.inCount ?? 0), lo = Math.min(p.outCount ?? 0, p.inCount ?? 0)
  return {
    zone: unit(zoneRank(p) / ZONE_TOP),
    tag: unit(jaccard(ctx.tags ?? [], tagsOfFields(p.fields))),
    recency: unit(Math.exp(-days / RANK.recencyDays)),
    recip: hi > 0 ? unit(lo / hi) : 0,
    text: textMatch(ctx.query, p.text),
  }
}

/** Ranks candidates best first; stable; every candidate is kept. */
export function rank<T extends RankCandidate>(candidates: readonly T[], ctx: RankContext): Ranked<T>[] {
  return candidates
    .map((person, i) => {
      const terms = termsOf(person, ctx)
      const score = unit(RANK.w_zone * terms.zone + RANK.w_tag * terms.tag + RANK.w_recency * terms.recency + RANK.w_recip * terms.recip + RANK.w_text * terms.text)
      return { person, score, terms, i }
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map(({ person, score, terms }) => ({ person, score, terms }))
}
