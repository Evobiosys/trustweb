// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** What a drop does to the record (wave 24, cal7): decisions only, no DOM. Unknown ids (another record) do nothing. */
import type { DragRef } from './drag_payload'
import { eventLabel } from './events'
import { addInvitee } from './ext/calendar/invitees'
import { Audience, type AppState, type InventoryItem, type TwEvent } from './model'
import { typedSource } from './provenance'

/** The My Resources item for a dropped event, with the defaults a hand-typed item gets; null when the event is not in this record. */
export function eventDropItem(s: AppState, ref: DragRef, id: string, now: number): InventoryItem | null {
  const ev = s.events?.find((e) => e.id === ref.id)
  return ev ? { id, text: eventLabel(ev), audience: Audience.FriendsOfFriends, included: true, createdAt: now, source: typedSource(), eventId: ev.id } : null
}

/** Invites a dropped person; false (nothing added) when they are not in this record. */
export function personDropOnEvent(s: AppState, ev: TwEvent, ref: DragRef): boolean {
  if (!s.people.some((p) => p.id === ref.id)) return false
  addInvitee(ev, ref.id)
  return true
}
