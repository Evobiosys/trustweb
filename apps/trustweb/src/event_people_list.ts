// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** wave45 event-people-list: "People at this event" on the event page: the hosts first, then who joins; a long list shows its first 10 until "Show all". */
/* Runtime-import free: apps/mcp loads it under plain node. */

/** More than this many people: only the first PEOPLE_SHOWN show, behind "Show all (N)". */
export const PEOPLE_COLLAPSE_AT = 15
export const PEOPLE_SHOWN = 10

export interface EventPerson { id?: string; name: string; host: boolean }
type Card = { id: string; name: string; deleted_at?: string | number; via?: unknown }

/** Hosts (a host without a card of mine is a name only), then who joins, once each. `joining` = the page's Joining list (hosts already left out). */
export function peopleAtEvent(people: readonly Card[], hosts: readonly string[], joining: readonly { id: string; name: string }[]): EventPerson[] {
  const live = people.filter((p) => p.deleted_at === undefined && !p.via)
  const out: EventPerson[] = hosts.map((name) => ({ id: live.find((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())?.id, name, host: true }))
  const seen = new Set(out.map((x) => x.id).filter(Boolean))
  for (const p of joining) if (!seen.has(p.id)) out.push({ id: p.id, name: p.name, host: false })
  return out
}

export const visiblePeople = (all: readonly EventPerson[], expanded: boolean): EventPerson[] =>
  all.length > PEOPLE_COLLAPSE_AT && !expanded ? all.slice(0, PEOPLE_SHOWN) : [...all]
