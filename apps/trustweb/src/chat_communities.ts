// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 40: the chat list filtered to communities only (like Signal's filter): the chats of people who carry a community tag. Pure, no DOM. */
export function communityChatRows<T extends { personId: string }>(rows: readonly T[], people: readonly { id: string; tags?: readonly string[] }[], communityTagIds: ReadonlySet<string>): T[] {
  const inCommunity = new Set(people.filter((p) => p.tags?.some((t) => communityTagIds.has(t))).map((p) => p.id))
  return rows.filter((r) => inCommunity.has(r.personId))
}
