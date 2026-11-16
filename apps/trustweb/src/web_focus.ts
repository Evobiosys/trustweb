// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 43 web-focus-filter: an event as a Web filter. The chip is `event:<id>` in uiRings.show (tag_filter.ts); the pure parts of the badge, the focus and the way Back returns. */
import { activeFilters, dropFilters } from './filter_active'
import type { AppState } from './model'
import { S } from './strings'

/** What a press on the filter badge does: 'list' opens the filter list, 'clear' clears every filter (a long press / right click always clears). */
export const BADGE_PRESS: 'list' | 'clear' = 'list'

export const eventChip = (eventId: string): string => 'event:' + eventId

/** The Web shows only this event's people: one filter, the event chip; hide chips go, other settings stay. */
export function focusEvent(s: Pick<AppState, 'uiRings'>, eventId: string): void {
  s.uiRings = { ...s.uiRings, show: [eventChip(eventId)], hide: [] }
}

export const clearFilters = (s: Pick<AppState, 'uiRings' | 'membraneLimit'>): void => dropFilters(s, () => false)

type FilterState = Pick<AppState, 'uiRings' | 'membraneLimit'>
/** Everything clearFilters touches, so Undo can put it back. */
export interface FilterSnapshot { show: string[]; hide: string[]; closest150?: boolean; rankBy?: 'recent' | 'frequent'; membraneLimit?: number }
export const snapshotFilters = (s: FilterState): FilterSnapshot => ({
  show: [...(s.uiRings?.show ?? [])], hide: [...(s.uiRings?.hide ?? [])], closest150: s.uiRings?.closest150, rankBy: s.uiRings?.rankBy, membraneLimit: s.membraneLimit,
})
export function restoreFilters(s: FilterState, snap: FilterSnapshot): void {
  s.uiRings = { ...s.uiRings, show: snap.show, hide: snap.hide, closest150: snap.closest150, rankBy: snap.rankBy }
  if (snap.membraneLimit === undefined) delete s.membraneLimit; else s.membraneLimit = snap.membraneLimit
}

/** Jakob's answer (2026-11-15, delta): clearing shows an Undo toast for this long. */
export const UNDO_FILTERS_MS = 5000

/** Clears every filter and offers the Undo (the app's undo notice; none when nothing was on). */
export function clearFiltersWithUndo(s: FilterState, undo: (title: string, onUndo: () => void, ms: number) => void, after: () => void = () => {}): void {
  const snap = snapshotFilters(s)
  if (!snap.show.length && !snap.hide.length && !snap.closest150 && snap.membraneLimit === undefined) return
  clearFilters(s)
  after()
  undo(S.filtersCleared, () => { restoreFilters(s, snap); after() }, UNDO_FILTERS_MS)
}

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
