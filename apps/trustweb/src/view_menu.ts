// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 24: the Web screen's view chooser (three-dots sheet): Membranes (default), Network, Desk. Pure, no DOM. */
export type WebView = 'rings' | 'network' | 'desk'

export interface ViewItem {
  view: WebView
  on: boolean
}

export function viewMenuItems(current: WebView, anyone: boolean): ViewItem[] {
  const views: WebView[] = anyone ? ['rings', 'network', 'desk'] : ['rings', 'desk']
  return views.map((view) => ({ view, on: view === current }))
}

/** The small heading under the title; Membranes needs none. */
export function viewHeading(current: WebView): WebView | null {
  return current === 'rings' ? null : current
}
