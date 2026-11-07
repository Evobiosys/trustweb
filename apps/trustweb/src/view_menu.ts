// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: the Web screen's view chooser (the eye): Web (default), Network, People, Complete (wave 36: everyone in one table), Map, then Dex and Contacts compact; Expand (top left of the rings) shows everyone. Pure, no DOM. */
export type WebView = 'rings' | 'network' | 'map'

/** Everything the eye menu can open, in menu order; the last two sit under "Other views". Map shows only when a map page exists. */
export type ViewKey = WebView | 'people' | 'complete' | 'map' | 'dex' | 'compact'
const VIEW_ORDER: readonly ViewKey[] = ['rings', 'network', 'people', 'complete', 'map', 'dex', 'compact']
const OTHER: readonly ViewKey[] = ['dex', 'compact']
export type ViewKey = WebView | 'people' | 'map' | 'dex' | 'compact' | 'groups'
const VIEW_ORDER: readonly ViewKey[] = ['rings', 'network', 'people', 'map', 'dex', 'compact', 'groups']
const OTHER: readonly ViewKey[] = ['dex', 'compact', 'groups']
/** Wave 28: Dex is the one view that sits in the "Alternative UI (beta)" part of Other views; new unique views join Other views. */
const ALT: readonly ViewKey[] = ['dex']

export interface ViewItem {
  view: ViewKey
  on: boolean
  other: boolean
  /** main = always listed; other and alt = inside the collapsed "Other views" group (alt under its "Alternative UI (beta)" label). */
  group: 'main' | 'other' | 'alt'
  pinned: boolean
}

/** Wave 31: Network and People always list (they were hidden while the record held nobody, which made the eye show only Web and Map); Map only when a map page exists. */
function available(hasMap: boolean): ViewKey[] {
  return VIEW_ORDER.filter((v) => v !== 'map' || hasMap)
}

export function viewMenuEntries(state: { current: ViewKey; hasMap: boolean; pins: readonly string[] | undefined }): ViewItem[] {
  const { current, hasMap, pins } = state
  return available(hasMap).map((view) => ({ view, on: view === current, other: OTHER.includes(view), group: ALT.includes(view) ? 'alt' : OTHER.includes(view) ? 'other' : 'main', pinned: !!pins?.includes(view) }))
}

/** The pinned views that exist right now, in menu order (the glyph buttons beside the eye). */
export function pinnedViews(pins: readonly string[] | undefined, hasMap: boolean): ViewKey[] {
  return available(hasMap).filter((v) => pins?.includes(v))
}

export function togglePin(pins: readonly string[] | undefined, view: ViewKey): string[] {
  const now = pins ?? []
  return now.includes(view) ? now.filter((v) => v !== view) : [...now, view]
}

/** The small heading under the title; the Web needs none. */
export function viewHeading(current: WebView): WebView | null {
  return current === 'rings' ? null : current
}

/** The stored choice (`trustweb.ui.webView`); a stale 'desk' or 'complete' reads as the Web. */
export function webViewOf(stored: string | null): WebView {
  return (stored === 'network' || stored === 'map') ? stored : 'rings'
}

/** The stored Expand flag (`trustweb.ui.webExpand` = '1'); only the rings have it. */
export function expandedOf(stored: string | null, view: WebView): boolean {
  return view === 'rings' && stored === '1'
}

export interface ScreenView { key: string; core: boolean; available: boolean }

/** Wave 28: the views menu of Events (Calendar, List, and the non-core Solar calendar, greyed until its module is there) and Resources (List, Outline, Matches, and wave 33 Notes). */
export function screenViews(screen: 'events' | 'inventory', solarInstalled: boolean): ScreenView[] {
  return screen === 'events'
    ? [{ key: 'calendar', core: true, available: true }, { key: 'list', core: true, available: true }, { key: 'solar', core: false, available: solarInstalled }]
    : [{ key: 'list', core: true, available: true }, { key: 'outline', core: true, available: true }, { key: 'matches', core: true, available: true }, { key: 'notes', core: true, available: true }]
}
