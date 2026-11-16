// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c shell-fix-2 (43-D3): the one place that decides whether something about an event may notify (bell entry, toast, popup row).
 * The event page's Notifications switch is `ev.notify`; absent = on. No DOM, types only: apps/mcp runs this file under plain node.
 */
import type { AppState, TwEvent } from './model'

/** The central predicate. */
export const eventNotifies = (ev: Pick<TwEvent, 'notify'>): boolean => ev.notify !== false

export type NotifySource =
  | { kind: 'invitation'; event?: string }
  | { kind: 'feed'; eventId?: string; group?: string }
  | { kind: 'support'; peerId: string }

type Src = Partial<Pick<AppState, 'events' | 'people'>>

const fold = (t: string): string => t.trim().toLowerCase()

/** The events a source belongs to (none when it belongs to no known event). */
function eventsOf(s: Src, src: NotifySource): TwEvent[] {
  const all = s.events ?? []
  switch (src.kind) {
    case 'invitation': {
      const name = fold(src.event ?? '')
      return name ? all.filter((e) => fold(e.name) === name || fold(e.tagName ?? '') === name) : []
    }
    case 'feed': {
      const id = src.eventId ?? (src.group?.startsWith('event:') ? src.group.slice(6) : '')
      return all.filter((e) => e.id === id)
    }
    case 'support': {
      const ids = (s.people ?? []).find((p) => p.peerId === src.peerId)?.events ?? []
      return all.filter((e) => ids.includes(e.id))
    }
  }
}

/** False only when the source belongs to at least one known event and every one of them has Notifications off. */
export function sourceNotifies(s: Src, src: NotifySource): boolean {
  const evs = eventsOf(s, src)
  return !evs.length || evs.some(eventNotifies)
}

/** A notification inbox row tied to an event (InboxItem.eventId): quiet while that event's switch is off. */
export function inboxItemNotifies(s: Src, item: { eventId?: string }): boolean {
  const ev = item.eventId ? s.events?.find((e) => e.id === item.eventId) : undefined
  return !ev || eventNotifies(ev)
}
