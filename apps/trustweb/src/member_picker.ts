// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-people-picker: the "+" on a community's Members offers the people I know; picking one gives them the community tag. Pure, DOM-free. */
import { addMember } from './ext/community-mighty/community_data'
import { buildMembers } from './ext/community-mighty/community_model'
import type { Person } from './model'

/** The ids the picker does not offer: the people who already carry the tag. */
export const memberExclude = (people: readonly Person[], tag: string): string[] => buildMembers(people, tag).map((m) => m.id)

/** Gives each person the tag; the number that were new members. */
export function addKnownMembers(people: Person[], ids: readonly string[], tag: string): number {
  return ids.filter((id) => addMember(people, id, tag)).length
}
