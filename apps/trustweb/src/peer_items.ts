// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 31 card-inventory (Jakob 2026-11-04): what we KNOW of a person's resources (not only what we shared with them), kept as
 * record lines on this phone, and the "recent" mark my own list shares with theirs. Pure, no DOM.
 */
import type { AppState } from './model'

/** One thing we know a person has. `source`: "self" (I saw it) or "told by <name>". */
export interface PeerItem { kind: 'peer_item'; personId: string; title: string; category: string; source: string; at: number; /** Wave 31: guessed from a chat, never verified. */ inferred?: true }

export const RECENT_DAYS = 30

/** An item is "recent" while it is younger than RECENT_DAYS; a date in the future counts as recent. */
export const recentMark = (at: number | undefined, now: number): boolean => at !== undefined && now - at < RECENT_DAYS * 86_400_000

/** The lines about one person, newest first. */
export const peerItems = (rec: Pick<AppState, 'peerItems'>, personId: string): PeerItem[] =>
  (rec.peerItems ?? []).filter((i) => i.personId === personId).sort((a, b) => b.at - a.at)

/** Adds a line about a person; an empty title adds nothing (null). */
export function addPeerItem(rec: Pick<AppState, 'peerItems'>, personId: string, title: string, category: string, source: string, now: number, inferred = false): PeerItem | null {
  const t = title.trim()
  if (!t) return null
  const item: PeerItem = { kind: 'peer_item', personId, title: t, category: category.trim(), source, at: now, ...(inferred ? { inferred: true as const } : {}) }
  rec.peerItems = [...(rec.peerItems ?? []), item]
  return item
}
