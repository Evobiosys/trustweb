// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar invitees (cal2): people I add to an event (TwEvent.people). Pure. */
import type { DragRef } from '../../drag_payload'
import type { AppState, Person, TwEvent } from '../../model'
import { S } from '../../strings'

export function addInvitee(ev: TwEvent, personId: string): void {
  if (!ev.people?.includes(personId)) ev.people = [...(ev.people ?? []), personId]
}

export function removeInvitee(ev: TwEvent, personId: string): void {
  const rest = (ev.people ?? []).filter((id) => id !== personId)
  if (rest.length) ev.people = rest; else delete ev.people
}

export const invitees = (s: Pick<AppState, 'people'>, ev: TwEvent): Person[] =>
  (ev.people ?? []).flatMap((id) => s.people.find((p) => p.id === id) ?? [])

export const inviteText = (link: string, eventName: string): string => S.cal.inviteText(eventName, link)

/** Invites a dropped person; false (nothing added) when they are not in this record. */
export function personDropOnEvent(s: Pick<AppState, 'people'>, ev: TwEvent, ref: DragRef): boolean {
  if (!s.people.some((p) => p.id === ref.id)) return false
  addInvitee(ev, ref.id)
  return true
}
