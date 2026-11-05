// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 (matching service D3): who needs what I can offer. Pure, no DOM. Lines come from the pc24 service (record key `matches`, dev endpoint /__tw/matches). */
import type { Match, MatchFeedback, Offer } from './model'

export const matchKey = (m: Match): string => `${m.personId ?? m.communityId ?? ''}|${m.offerId}`

export interface MatchGroup { offerId: string; title: string; items: Match[] }

/** One group per offer (catalogue order, offers not in it last), strongest match first; dismissed ones stay out of sight. */
export function groupMatches(matches: readonly Match[], offers: readonly Offer[]): MatchGroup[] {
  const groups = new Map<string, MatchGroup>()
  for (const o of offers) groups.set(o.id, { offerId: o.id, title: o.title, items: [] })
  for (const m of matches) {
    if (m.status === 'dismissed') continue
    const g = groups.get(m.offerId) ?? { offerId: m.offerId, title: m.offerId, items: [] }
    g.items.push(m)
    groups.set(m.offerId, g)
  }
  return [...groups.values()].filter((g) => g.items.length).map((g) => ({ ...g, items: [...g.items].sort((a, b) => b.confidence - a.confidence) }))
}

/** Lays polled lines over what is known: same person/community + offer replaces the content but keeps the answered state. `items` is the same array when nothing changed. */
export function mergeIncoming(known: readonly Match[], incoming: readonly Match[]): { items: Match[]; changed: boolean } {
  const items = [...known]
  let changed = false
  for (const m of incoming) {
    const i = items.findIndex((x) => matchKey(x) === matchKey(m))
    if (i < 0) { items.push(m); changed = true; continue }
    const next = { ...m, status: items[i].status }
    if (JSON.stringify(next) === JSON.stringify(items[i])) continue
    items[i] = next
    changed = true
  }
  return { items: changed ? items : (known as Match[]), changed }
}

const isMatch = (x: unknown): x is Match => {
  const m = x as Match
  return !!m && typeof m === 'object' && typeof m.offerId === 'string' && (typeof m.personId === 'string' || typeof m.communityId === 'string')
    && typeof m.need === 'string' && typeof m.confidence === 'number' && m.confidence >= 0 && m.confidence <= 1
}

/** JSONL lines to matches; broken or incomplete lines are skipped. */
export function parseLines(lines: readonly string[]): Match[] {
  const out: Match[] = []
  for (const l of lines) {
    try { const x: unknown = JSON.parse(l); if (isMatch(x)) out.push(x) } catch { /* a half-written line */ }
  }
  return out
}

/** "Not relevant": hides the match and returns the feedback line the service learns from. */
export function dismissMatch(m: Match, at: number): MatchFeedback {
  m.status = 'dismissed'
  return { key: matchKey(m), verdict: 'not_relevant', at }
}
