// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 28 card-small (Jakob 2026-10-31): the pure rules of the small card and the extended card under it. Pure, no DOM.
 * Duplicate fields (shown elsewhere on the card), the last three timeline events, who may be chatted with, messenger glyphs,
 * ring and tag edits, and the met date kept out of the context words.
 */
import { chatServices } from './chat_row'
import type { ChatService } from './chat_row'
import type { ColourTag } from './colour_tags'
import { FAMILY_FIELD, isFamily } from './rings_layout'
import type { Person, Ring } from './model'
import type { TimelineEntry } from './timeline'

/** The Curator fields (first name, last name, ring, context) the card already shows: name heading, ring chip, the "Met" timeline entry. Tags join them (see the Curator's field list). */
export const DUPLICATE_FIELD_KEYS: readonly string[] = ['tw-first', 'kb0JInYEW2lD', 'tw-ring', 'tw-context', FAMILY_FIELD]

export const TIMELINE_SMALL = 3

/** The newest `TIMELINE_SMALL` events (input newest first) and whether older ones exist. */
export function smallTimeline(entries: readonly TimelineEntry[]): { shown: TimelineEntry[]; more: boolean } {
  return { shown: entries.slice(0, TIMELINE_SMALL), more: entries.length > TIMELINE_SMALL }
}

/** The Chat button exists only for a person connected on TrustWeb (Jakob 2026-10-31). */
export const chatShown = (p: Pick<Person, 'peerId'>): boolean => Boolean(p.peerId)

export interface MessengerGlyph { id: string; service: ChatService; connected: boolean }

/** One glyph per messenger link with this person: solid (connected) for TrustWeb, dashed for the others. */
export const messengerGlyphs = (p: Parameters<typeof chatServices>[0]): MessengerGlyph[] =>
  chatServices(p).map((service) => ({ id: service.id, service, connected: service.kind === 'trustweb' }))

/** Puts the person on `ring` (the owner's own choice, so a suggestion mark goes). */
export function setRing(p: Pick<Person, 'ring' | 'ringSuggested'>, ring: Ring): void {
  p.ring = ring
  delete p.ringSuggested
}

type Tagged = Pick<Person, 'ring' | 'fields'>

/** The defined colour tags this person does not have yet. */
export const tagsAddable = (p: Tagged, tags: readonly ColourTag[]): ColourTag[] =>
  tags.filter((t) => (t.id === FAMILY_FIELD ? !isFamily(p) : String(p.fields?.[t.id]) !== 'true'))

/** Gives the person a tag (a boolean field, as setFlag/setFamily store it). */
export function addTagTo(p: Pick<Person, 'fields'>, id: string): void {
  p.fields = { ...p.fields, [id]: true as unknown as string }
}

export const setMetAt = (p: Pick<Person, 'metAt'>, at: number): void => { p.metAt = at }

const MONTHS = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec'
const DATES: readonly RegExp[] = [
  new RegExp(`(?:\\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\\w*,?\\s*)?\\b(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4}\\b`, 'gi'),
  /\b\d{4}[-/.]\d{1,2}(?:[-/.]\d{1,2})?\b/g,
  /\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g,
  new RegExp(`\\b\\d{1,2}\\s?(?:${MONTHS})[a-z]*\\.?\\s?\\d{2,4}\\b`, 'gi'),
  /\b(?:19|20)\d{2}\b/g,
]

/** "Fair 2024-05-03" -> "Fair": the date belongs on the timeline entry, not in "Met in which context". */
export function contextWithoutDate(context: string): string {
  let out = context
  for (const re of DATES) out = out.replace(re, ' ')
  return out.replace(/\s+/g, ' ').replace(/^[\s·,;:\-–]+|[\s·,;:\-–]+$/g, '')
}
