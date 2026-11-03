// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Join offers (owner 2026-11-03): a note that names only a first name creates nobody; the converter (scripts/notes_persons_to_record.mjs)
 * offers it as a join to a person with the same first name, the bridge serves the open ones (GET /offers), the owner picks in Settings.
 * Pure parts: the candidates recomputed against the live, effective people (the converter's are only defaults, listed first) and the
 * join as a notes_client Change, so it lands through applyChanges (vault- ids, local provenance, the note's date).
 */
import type { Change } from './notes_client'

export interface Candidate { id: string; name: string }
export interface JoinOffer { key: string; name: string; path: string; date: string; context: string; facts: string[]; candidates: Candidate[] }
export enum Decision {
  Join = 'join',
  Dismiss = 'dismiss',
}

/** The first name as dedup sees it (same rule as the converter's firstNameKey): first word, lowercased, diacritics folded, ß -> ss. */
export function firstNameKey(name: string): string {
  const w = name.trim().split(/\s+/)[0] ?? ''
  return w.toLowerCase().replace(/ß/g, 'ss').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '')
}

/** Everyone now in the record with the offer's first name: the converter's candidates first (in its order), then the rest by name. */
export function offerCandidates(offer: JoinOffer, people: readonly { id: string; name: string }[]): Candidate[] {
  const k = firstNameKey(offer.name)
  if (!k) return []
  const same = people.filter((p) => firstNameKey(p.name) === k).map((p) => ({ id: p.id, name: p.name }))
  const rank = new Map(offer.candidates.map((c, i) => [c.id, i]))
  const at = (c: Candidate): number => rank.get(c.id) ?? Infinity
  return same.sort((a, b) => at(a) - at(b) || a.name.localeCompare(b.name))
}

/** The join as the Change applyChanges takes: the mention's facts (its context when it has none), dated by the note. */
export function joinChanges(offer: JoinOffer, intoId: string): Change {
  const texts = offer.facts.length ? offer.facts : offer.context.trim() ? [offer.context] : []
  return { id: intoId, path: offer.path, newLines: texts.map((text) => ({ text, date: offer.date })) }
}
