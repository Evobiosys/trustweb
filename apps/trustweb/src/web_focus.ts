// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 web-focus-filter: an event as a Web filter. The chip is `event:<id>` in uiRings.show (tag_filter.ts); the pure parts of the badge, the focus and the way Back returns. */
import { activeFilters, dropFilters } from './filter_active'
import type { AppState } from './model'

/** What a press on the filter badge does: 'list' opens the filter list, 'clear' clears every filter (a long press / right click always clears). */
export const BADGE_PRESS: 'list' | 'clear' = 'list'

export const eventChip = (eventId: string): string => 'event:' + eventId

/** The Web shows only this event's people: one filter, the event chip; hide chips go, other settings stay. */
export function focusEvent(s: Pick<AppState, 'uiRings'>, eventId: string): void {
  s.uiRings = { ...s.uiRings, show: [eventChip(eventId)], hide: [] }
}

export const clearFilters = (s: Pick<AppState, 'uiRings' | 'membraneLimit'>): void => dropFilters(s, () => false)

/** The number on the badge: every active filter (hidden at 0). */
export const filterCount = (s: Pick<AppState, 'uiRings' | 'people'>): number => activeFilters(s.uiRings, [], s.people).length

/** The history entry the focus pushes, so Back leaves it. */
export const focusState = (eventId: string): { twFocus: string } => ({ twFocus: eventId })

/** Back landed on an entry before the focus (one without any of the app's own state keys) while a focus is open: the event whose page to show again; else null. */
export function focusPop(state: unknown, from: string | null): string | null {
  const own = state as Record<string, unknown> | null
  return from && !(own && ('twFocus' in own || 'twPage' in own || 'twZoom' in own)) ? from : null
}

export interface WebFocusDeps {
  state: () => AppState
  save: () => void
  /** Show the Web view. */
  showWeb: () => void
  /** Show this event's page on the Events screen. */
  showEvent: (eventId: string) => void
  atWeb: () => boolean
}

/** The button's action: the Web with only this event's people, one history entry pushed so Back (browser, phone or the ‹) returns to the event's page. */
export function createWebFocus(d: WebFocusDeps): (ev: { id: string }) => void {
  let from: string | null = null
  window.addEventListener('popstate', (e) => {
    const id = d.atWeb() ? focusPop(e.state, from) : null
    if (id) { from = null; d.showEvent(id) }
  })
  return (ev) => {
    focusEvent(d.state(), ev.id)
    d.save()
    from = ev.id
    history.pushState(focusState(ev.id), '')
    d.showWeb()
  }
}
