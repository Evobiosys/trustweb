// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar invitees (cal2): people I add to an event (TwEvent.people). Pure. */
import type { DragRef } from '../../drag_payload'
import type { AppState, Person, TwEvent } from '../../model'
import { CHAT_TEXT_MAX } from '../../chat'
import { LINK_LEAN_MAX } from '../../event_link'
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

/** wave47 invite-fits-chat: the invite for my chat with a person: the whole event link when the text fits one chat message, else the least-trimmed link that
 * does (`linkAt(lean)`, event_link.ts leanForLink); null when even the leanest is too long (the view then says so instead of sending nothing silently). */
export function fittingInviteText(eventName: string, linkAt: (lean: number) => string, max: number = CHAT_TEXT_MAX): string | null {
  for (let lean = 0; lean <= LINK_LEAN_MAX; lean++) {
    const text = inviteText(linkAt(lean), eventName)
    if (text.length <= max) return text
  }
  return null
}

/** Invites a dropped person; false (nothing added) when they are not in this record. */
export function personDropOnEvent(s: Pick<AppState, 'people'>, ev: TwEvent, ref: DragRef): boolean {
  if (!s.people.some((p) => p.id === ref.id)) return false
  addInvitee(ev, ref.id)
  return true
}
