// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 (Jakob 2026-10-31): the expanded person card, top to bottom, and its ONE timeline. Pure, no DOM.
 * seen = what they can see of me (the small card's tags and shares); channels = their links; askLinks; passOn; knows = who they know;
 * other = the remaining rows; notes (Add a note above the fields, in the Curator); timeline; curate (last).
 */
import type { AppState, Person } from './model'
import { extraEntries } from './person_days'
import { timelineOf } from './timeline'
import type { TimelineEntry } from './timeline'

export type CardSection = 'seen' | 'channels' | 'askLinks' | 'passOn' | 'knows' | 'invitations' | 'photos' | 'other' | 'notes' | 'timeline' | 'curate'

export function cardSections(f: { connected: boolean; canAskLinks: boolean; /** Wave 40: the Photos module is on. */ photos?: boolean }): CardSection[] {
  return [
    'seen', 'channels',
    ...(f.canAskLinks ? ['askLinks' as const] : []),
    ...(f.connected ? ['passOn' as const] : []),
    'knows', 'invitations', ...(f.photos ? ['photos' as const] : []), 'other', 'notes', 'timeline', 'curate',
  ]
}

export const isSystemEvent = (e: TimelineEntry): boolean => e.system === true

const day = (at: number): string => new Date(at).toDateString()

/** Everything that happened with this person, newest first, each thing once (same channel, words and day = one; a system event wins). */
export function mergedTimeline(s: AppState, p: Person): TimelineEntry[] {
  const seen = new Set<string>()
  return [...timelineOf(s, p), ...extraEntries(s, p)].sort((a, b) => b.at - a.at || Number(b.system === true) - Number(a.system === true)).filter((e) => {
    const k = `${e.channel}|${e.summary}|${day(e.at)}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}
