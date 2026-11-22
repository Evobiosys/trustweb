// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44b filters-communities (item 4): EVENT MODE, a filter mode beside community mode. While it is on for an event, the Web shows everyone
 * connected with that event by default and Chat, Resources and Ask list only those people; a pill `#event:<name>` above the filter row leaves it.
 * (event_mode.ts is something else: the event-only app variant of an event link.) The mode lives in `uiRings.eventMode` (an event id). Pure.
 */
import type { AppState, Match, Person, TwEvent } from './model'
import { eventTagLabel } from './event_tag'
import { tagLabel } from './events'
import { filterByChips } from './tag_filter'
import { intimateEventChips } from './event_community' // answers-44d
import { bubbleOn } from './event_bubble' // wave45 event-bubble

type UiEvents = Pick<AppState, 'uiRings'> & { events?: readonly TwEvent[] }

export const eventFilterOf = (s: Pick<AppState, 'uiRings'>): string | null => s.uiRings?.eventMode ?? null

/** On with an event id, off with null. True when it changed. */
export function setEventFilter(s: Pick<AppState, 'uiRings'>, id: string | null): boolean {
  if (eventFilterOf(s) === id) return false
  const ui = { ...s.uiRings }
  delete ui.eventEveryone   // wave45 event-bubble: a lift ends with the mode or the event
  if (id) ui.eventMode = id; else delete ui.eventMode
  s.uiRings = ui
  return true
}

/** The Web's `show` list with the event chip added while the mode is on (the chip filterByChips already understands). */
export function eventModeShow(s: Pick<AppState, 'uiRings' | 'eventBubbleOff'> & Partial<Pick<AppState, 'people' | 'events' | 'extData'>>): string[] {
  const show = s.uiRings?.show ?? []
  const id = bubbleOn(s) ? eventFilterOf(s) : null   // wave45 event-bubble: Everyone or the setting lifts the Web
  const out = id && !show.includes(`event:${id}`) ? [...show, `event:${id}`] : [...show]
  // answers-44d: an intimate community's event shows the community's members too
  for (const c of s.people && id ? intimateEventChips(s as Pick<AppState, 'people'> & typeof s) : []) if (!out.includes(c)) out.push(c)
  return out
}

/** Chat, Resources and Ask: only the people connected with the event; mode off = the list as it is. */
export function narrowToEvent<P extends Pick<Person, 'id' | 'ring' | 'fields' | 'events'>>(s: UiEvents, people: readonly P[]): P[] {
  const id = eventFilterOf(s)
  return id ? filterByChips(people, [], [`event:${id}`], [], s.events) : [...people]
}

/** `#event:<name>`; null when the mode is off or its event is gone. */
export function eventModePill(s: UiEvents): string | null {
  const id = eventFilterOf(s)
  const ev = id ? s.events?.find((e) => e.id === id) : undefined
  return ev ? eventTagLabel(tagLabel(ev)) : null
}

/** Resources > Matches: only the matches with the event's people (a community-only match has no person and goes). Mode off = as is. */
export function narrowMatches(s: UiEvents & Pick<AppState, 'people'>, matches: readonly Match[]): Match[] {
  if (!eventFilterOf(s)) return [...matches]
  const keep = new Set(narrowToEvent(s, s.people).map((p) => p.id))
  return matches.filter((m) => m.personId !== undefined && keep.has(m.personId))
}

/** Any list keyed by person id (the Chat list): only the event's people while the mode is on. */
export function narrowById<T extends { id: string }>(s: UiEvents & Pick<AppState, 'people'>, list: readonly T[]): T[] {
  if (!eventFilterOf(s)) return [...list]
  const keep = new Set(narrowToEvent(s, s.people).map((p) => p.id))
  return list.filter((x) => keep.has(x.id))
}
