// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 steer-event-visibility: how I show to the other people at an event, and which of them the attendee list shows; the host's
 * "Share with the whole community". Pure, no DOM.
 *   open          everyone at the event sees me in the attendee list and can connect.
 *   discoverable  (default) I appear only when someone searches for me; no name in the open list.
 *   off           I appear nowhere.
 * A person I tagged myself has no announced mode and is listed (I know them). Their announced mode arrives with the event envelope.
 */
import { isVisibility } from './event_press'
import type { EventVisibility } from './event_press'
import type { AppState, Person, TwEvent } from './model'

export { DEFAULT_EVENT_VISIBILITY, EVENT_VISIBILITIES, isVisibility, setShowMe, visibilityOf } from './event_press'
export type { EventVisibility } from './event_press'

/** The mode a person announced for this event; absent = listed. */
const modeOf = (p: Pick<Person, 'eventShow'>, eventId: string): EventVisibility => (isVisibility(p.eventShow?.[eventId]) ? p.eventShow![eventId] : 'open')

/** Who the attendee list shows: everyone except those who announced discoverable or off. Wave 44 steer-open-space: with the host flag "Everyone can see everyone" the discoverable ones are listed too; off stays hidden. */
export const listedAttendees = <P extends Pick<Person, 'eventShow'>>(people: readonly P[], eventId: string, showAll = false): P[] => people.filter((p) => (showAll ? modeOf(p, eventId) !== 'off' : modeOf(p, eventId) === 'open'))

/** Who a search may still find: the listed ones and the discoverable ones; never those who are off. */
export const searchableAttendees = <P extends Pick<Person, 'eventShow'>>(people: readonly P[], eventId: string): P[] => people.filter((p) => modeOf(p, eventId) !== 'off')

/** Records what a person announced (an envelope from them). Unknown value: ignored. */
export function noteShow(p: Person, eventId: string, v: unknown): void {
  if (isVisibility(v)) p.eventShow = { ...p.eventShow, [eventId]: v }
}

/** The community this event is shared with: communityId, else the one it was made in. */
export const communityOfEvent = (ev: Pick<TwEvent, 'communityId' | 'community'>): string | undefined => ev.communityId || ev.community || undefined

/** True when the event goes to the whole community and has not gone yet. */
export const announceDue = (ev: Pick<TwEvent, 'shareCommunity' | 'announcedAt' | 'communityId' | 'community' | 'fromLink'>): boolean =>
  ev.shareCommunity === true && ev.announcedAt === undefined && !ev.fromLink && communityOfEvent(ev) !== undefined

/** The people who hold the community's colour tag (person.fields[tag] === 'true'), connected ones only: they get the event. */
export const communityMembers = (s: Pick<AppState, 'people'>, tag: string): Person[] =>
  s.people.filter((p) => p.deleted_at === undefined && !!p.peerId && String(p.fields?.[tag]) === 'true')

/** The events of one community (its colour tag), for the community calendar. */
export const communityEvents = <E extends Pick<TwEvent, 'communityId' | 'community'>>(events: readonly E[], tag: string): E[] => events.filter((e) => communityOfEvent(e) === tag)
