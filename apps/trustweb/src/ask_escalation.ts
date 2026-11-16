// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-ask-escalation: the pure rules of "who was asked" (a recipient the asker placed as Closest few or Close sees the names) and of the
 * second round "Do you know someone who has this?" (kind 'know': sent to the chosen zone, answered with a free-text tip private to the asker).
 */
import { peopleFor } from './audience_filter'
import type { Zone } from './audience_zones'
import { Ring } from './model'
import type { Person } from './model'
import type { SharedItem } from '../../demo/src/types'

/** How many names an ask carries (wire.ts parseAskedNames uses the same bound). */
export const ASKED_NAMES_MAX = 50
/** What a tip says about itself on the asker's answer card ("A tip · just now"; the card is shown in the asker's language by its own strings, these two words travel). */
export const KNOW_CONTEXT = 'A tip'
export const KNOW_WHEN = 'just now'
/** The longest tip a person gives (a name, a contact, a hint). */
export const KNOW_NOTE_MAX = 200

/** The names that go to ONE recipient: only Closest few and Close (as the asker placed them), only when the asker left "show who was asked" on. */
export function shownAskedNames(ring: Ring, show: boolean, names: readonly string[]): string[] | undefined {
  if (!show || names.length === 0 || (ring !== Ring.Closest && ring !== Ring.Close)) return undefined
  return names.slice(0, ASKED_NAMES_MAX)
}

type Who = Pick<Person, 'id' | 'ring' | 'fields' | 'peerId'>

/** The connection ids the second round reaches: the zone and narrower, minus who already shared and the hidden chips. Everybody else in the zone is asked, whether they hold the item or not (the asker never learns who does, I3). */
export function escalationTargets<T extends Who>(people: readonly T[], zone: Zone, shared: readonly string[], exclude: readonly string[], hasTag: (p: T, tag: string) => boolean): string[] {
  return peopleFor({ zone, add: [], exclude: [...exclude], degree: 1 }, people, hasTag).map((p) => p.peerId as string).filter((id) => !shared.includes(id))
}

/** The one shared item a tip makes; none for an empty tip. */
export function knowItems(note: string | undefined, context: string, when: string): SharedItem[] {
  const text = (note ?? '').trim().slice(0, KNOW_NOTE_MAX)
  return text ? [{ text, context, when }] : []
}
