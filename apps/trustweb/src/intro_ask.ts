// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 33: "Ask for intros" (Jakob 2026-11-07): who in my web is associated with a person, an organisation or a topic, so I can ask them
 * for an introduction. Pure and DOM-free; reads only what this phone already holds.
 *
 * A connected person is associated with the target by each of these (one point each, the count ranks):
 *   knows   - the target lists them or they list the target among who they know (Network edges)
 *   place   - the same "where we met" context (a place or an organisation)
 *   event   - every event both carry
 *   mention - their notes (lines, shared note titles, context, place name) name the target
 * A target that is no person in my web (an organisation, a topic) is matched by the "mention" and "place" rules on its text.
 * Trust hop: Closest/Close 1, Friend 2, Acquaintance 3 (family by its closeness); "How far?" caps it. Order: hop, then count, then name.
 * The ask goes to ONE candidate as a normal ask carrying kind 'intro' and the target (QueryEnvelope.kind / .target, optional).
 */
import { CLOSENESS_KEY, Ring } from './model'
import type { Person } from './model'
import { isBlocked } from './non_responsive'

/** Longest target an intro ask carries (characters). */
export const INTRO_TARGET_MAX = 80

export type IntroReason = 'knows' | 'place' | 'event' | 'mention'

type Candidate = Pick<Person, 'id' | 'name' | 'ring' | 'fields' | 'peerId' | 'context' | 'events' | 'knows' | 'lines' | 'sharedNotes' | 'place' | 'blocked'>

export interface IntroCandidate<T extends Candidate = Candidate> {
  person: T
  hop: number
  count: number
  reasons: IntroReason[]
}

/** "How far?" steps -> the widest trust hop shown: contacts reach up to Friends, each further step one tier more. */
export const introMaxHop = (steps: number): number => steps + 1

export function introTrustHop(p: Pick<Person, 'ring' | 'fields'>): number {
  const ring = p.ring === Ring.Family ? (p.fields?.[CLOSENESS_KEY] as Ring | undefined) ?? Ring.Close : p.ring
  if (ring === Ring.Closest || ring === Ring.Close) return 1
  if (ring === Ring.Friend) return 2
  return 3
}

/** The target as it travels: trimmed, bounded; anything that is not a non-empty string is none. */
export function parseIntroTarget(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim().slice(0, INTRO_TARGET_MAX).trim()
  return t || undefined
}

export const introAskText = (target: string): string => `Could you introduce me to ${target}?`

const norm = (s: string | undefined): string => (s ?? '').trim().toLowerCase()

function mentions(p: Candidate, needle: string): boolean {
  const hay = [p.context, p.place?.name, ...(p.lines ?? []).map((l) => l.text), ...(p.sharedNotes ?? []).map((n) => n.title)]
  return hay.some((h) => norm(h).includes(needle))
}

export function introCandidates<T extends Candidate>(people: readonly T[], targetText: string, maxHop: number): IntroCandidate<T>[] {
  const needle = norm(targetText)
  if (!needle) return []
  const target = people.find((p) => norm(p.name) === needle)
  const out: IntroCandidate<T>[] = []
  for (const p of people) {
    if (p === target || !p.peerId || isBlocked(p) || p.ring === Ring.None || p.ring === Ring.Intending) continue
    const hop = introTrustHop(p)
    if (hop > maxHop) continue
    const reasons: IntroReason[] = []
    if (target) {
      if (target.knows?.includes(p.id) || p.knows?.includes(target.id)) reasons.push('knows')
      if (norm(target.context) && norm(target.context) === norm(p.context)) reasons.push('place')
      for (const e of p.events ?? []) if (target.events?.includes(e)) reasons.push('event')
      if (mentions(p, needle) || mentions(target, norm(p.name)) && norm(p.name)) reasons.push('mention')
    } else {
      if (norm(p.context).includes(needle) || norm(p.place?.name).includes(needle)) reasons.push('place')
      if ((p.lines ?? []).some((l) => norm(l.text).includes(needle)) || (p.sharedNotes ?? []).some((n) => norm(n.title).includes(needle))) reasons.push('mention')
    }
    if (reasons.length) out.push({ person: p, hop, count: reasons.length, reasons })
  }
  return out.sort((a, b) => a.hop - b.hop || b.count - a.count || a.person.name.localeCompare(b.person.name))
}
