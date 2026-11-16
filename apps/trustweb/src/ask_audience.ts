// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43b ask-page-filter: the stored audience of the hints and intro asks (AppState.askAudience; its degree is `askReach`) and the peers it reaches. */
import { parseFilter, peopleFor } from './audience_filter'
import type { AudienceFilter } from './audience_filter'
import { memberIds } from './colour_tags'
import type { ColourTag } from './colour_tags'
import type { AppState, Person } from './model'
import { eventFilterOf, narrowToEvent } from './event_filter_mode'

type Held = Pick<AppState, 'people' | 'askAudience' | 'askReach'>

/** The stored filter; anything unreadable counts as off. The degree is the stored reach, capped at 3 (Custom and No limit live in the reach chooser). */
export function askFilterOf(s: Pick<Held, 'askAudience' | 'askReach'>): AudienceFilter {
  try { return parseFilter({ ...s.askAudience, degree: s.askReach === 2 || s.askReach === 3 ? s.askReach : 1 }) } catch { return parseFilter({}) }
}

/** Stores the zone and the chips (nothing at all when the filter is off). The degree is not stored here: the reach chooser owns `askReach`. */
export function saveAskFilter(s: Pick<Held, 'askAudience'>, f: AudienceFilter): void {
  if (!f.zone && !f.add.length && !f.exclude.length) delete s.askAudience
  else s.askAudience = { ...(f.zone ? { zone: f.zone } : {}), add: [...f.add], exclude: [...f.exclude] }
}

/** A tag holder test that resolves groups to their children's people (colour_tags.ts memberIds), the same one the support ask uses. */
export function tagTester(people: readonly Person[], tags: readonly ColourTag[]): (p: { id: string }, tag: string) => boolean {
  const cache = new Map<string, Set<string>>()
  return (p, id) => {
    if (!cache.has(id)) cache.set(id, new Set(memberIds(people, tags, id)))
    return cache.get(id)?.has(p.id) === true
  }
}

/** The peer ids the hints and intro asks may reach; null = the filter is off, everybody connected is asked. */
export function allowedPeerIds(s: Held & Partial<Pick<AppState, 'uiRings' | 'events'>>, tags: readonly ColourTag[]): string[] | null {
  const f = askFilterOf(s)
  const own = !f.zone && !f.add.length && !f.exclude.length ? null : peopleFor(f, s.people, tagTester(s.people, tags)).map((p) => p.peerId as string)
  if (!eventFilterOf(s)) return own
  // Wave 44b: event mode narrows an ask to the people connected with that event.
  const inEvent = narrowToEvent(s, s.people).map((p) => p.peerId).filter((x): x is string => !!x)
  return own ? own.filter((id) => inEvent.includes(id)) : inEvent
}
