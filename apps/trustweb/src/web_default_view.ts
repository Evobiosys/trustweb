// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 35: the view pinned as the default of the Web tab (AppState.uiViews.webDefault, a view_menu ViewKey; absent = the rings).
 * The Web tab opens it and carries its name. Advanced mode = the Advanced pin is on. Pure, no DOM.
 */
import { headerPins } from './header_controls'

export interface UiViews { webDefault?: string }
interface ViewsState { uiViews?: UiViews; uiPins?: { views: string[]; header?: string[] } }

export const webDefaultOf = (s: ViewsState): string => s.uiViews?.webDefault || 'rings'

/** The Web tab's label: the pinned view's name; the rings (or a name this build lacks) keep "Web". */
export function webTabLabel(s: ViewsState, names: Record<string, string>): string {
  return names[webDefaultOf(s)] ?? names.rings
}

/** The next `uiViews`: pinning the rings drops the pin. */
export function setWebDefault(views: UiViews | undefined, id: string): UiViews | undefined {
  if (id === 'rings') return undefined
  return { ...views, webDefault: id }
}

export function isAdvanced(s: ViewsState): boolean {
  return headerPins(s.uiPins?.header).includes('advanced') || !!s.uiPins?.views.includes('advanced')
}
