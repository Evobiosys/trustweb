// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 25: the Web screen's view chooser (three-dots sheet): Membranes (default), Network; Expand (top left of the rings) shows everyone. Pure, no DOM. */
export type WebView = 'rings' | 'network'

export interface ViewItem {
  view: WebView
  on: boolean
}

export function viewMenuItems(current: WebView, anyone: boolean): ViewItem[] {
  const views: WebView[] = anyone ? ['rings', 'network'] : ['rings']
  return views.map((view) => ({ view, on: view === current }))
}

/** The small heading under the title; Membranes needs none. */
export function viewHeading(current: WebView): WebView | null {
  return current === 'rings' ? null : current
}

/** The stored choice (`trustweb.ui.webView`); Network needs someone in the web, a stale 'desk' or 'complete' reads as Membranes. */
export function webViewOf(stored: string | null, anyone: boolean): WebView {
  return anyone && stored === 'network' ? 'network' : 'rings'
}

/** The stored Expand flag (`trustweb.ui.webExpand` = '1'); only the rings have it. */
export function expandedOf(stored: string | null, view: WebView): boolean {
  return view === 'rings' && stored === '1'
}
