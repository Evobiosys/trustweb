// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: the Web screen's view chooser (the eye): Web (default), Network, People, Map, then Dex and Contacts compact; Expand (top left of the rings) shows everyone. Pure, no DOM. */
export type WebView = 'rings' | 'network'

/** Everything the eye menu can open, in menu order; the last two sit under "Other views". Map shows only when a map page exists. */
export type ViewKey = WebView | 'people' | 'map' | 'dex' | 'compact'
const VIEW_ORDER: readonly ViewKey[] = ['rings', 'network', 'people', 'map', 'dex', 'compact']
const OTHER: readonly ViewKey[] = ['dex', 'compact']

export interface ViewItem {
  view: ViewKey
  on: boolean
  other: boolean
  pinned: boolean
}

function available(anyone: boolean, hasMap: boolean): ViewKey[] {
  return VIEW_ORDER.filter((v) => (v === 'network' || v === 'people' ? anyone : v === 'map' ? hasMap : true))
}

export function viewMenu(current: ViewKey, anyone: boolean, hasMap: boolean, pins: readonly string[] | undefined): ViewItem[] {
  return available(anyone, hasMap).map((view) => ({ view, on: view === current, other: OTHER.includes(view), pinned: !!pins?.includes(view) }))
}

/** The pinned views that exist right now, in menu order (the glyph buttons beside the eye). */
export function pinnedViews(pins: readonly string[] | undefined, anyone: boolean, hasMap: boolean): ViewKey[] {
  return available(anyone, hasMap).filter((v) => pins?.includes(v))
}

export function togglePin(pins: readonly string[] | undefined, view: ViewKey): string[] {
  const now = pins ?? []
  return now.includes(view) ? now.filter((v) => v !== view) : [...now, view]
}

/** The small heading under the title; the Web needs none. */
export function viewHeading(current: WebView): WebView | null {
  return current === 'rings' ? null : current
}

/** The stored choice (`trustweb.ui.webView`); Network needs someone in the web, a stale 'desk' or 'complete' reads as the Web. */
export function webViewOf(stored: string | null, anyone: boolean): WebView {
  return anyone && stored === 'network' ? 'network' : 'rings'
}

/** The stored Expand flag (`trustweb.ui.webExpand` = '1'); only the rings have it. */
export function expandedOf(stored: string | null, view: WebView): boolean {
  return view === 'rings' && stored === '1'
}
