// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 35: the view pinned as the default of the Web tab (AppState.uiViews.webDefault, a view_menu ViewKey; absent = the rings).
 * The Web tab opens it and carries its name. Advanced mode = the Advanced pin is on. Pure, no DOM.
 */
import { headerPins } from './header_controls'

export interface UiViews { webDefault?: string }
interface ViewsState { uiViews?: UiViews; uiPins?: { views: string[]; header?: string[] } }

export const webDefaultOf = (s: ViewsState): string => s.uiViews?.webDefault || 'rings'

/** Wave 43c: false = the bottom-bar tab keeps "Web" (Settings texts say Contacts); true = the rings tab reads "Contacts". Jakob decides. */
export const CONTACTS_TAB_LABEL = false

/** The Web tab's label: the pinned view's name; the rings (or a name this build lacks) keep "Web", or read `contacts` when the caller hands that word in. */
export function webTabLabel(s: ViewsState, names: Record<string, string>, contacts?: string): string {
  const pinned = webDefaultOf(s)
  return names[pinned] && pinned !== 'rings' ? names[pinned] : contacts ?? names.rings
}

/** Wave 43c: pinning these views changes what the Web screen shows right now (they are remembered, WEB_VIEW_KEY); the others open as pages on the next tap. */
export const shownAtOnce = (view: string): boolean => view === 'rings' || view === 'network' || view === 'map'

/** review-fixes-43c: the Web view to remember after a new default (eye-menu pin AND the Settings select), or null when it opens as a page on the next tap. */
export const webViewAfterDefault = (view: string): string | null => (shownAtOnce(view) ? view : null)

/** The next `uiViews`: pinning the rings drops the pin. */
export function setWebDefault(views: UiViews | undefined, id: string): UiViews | undefined {
  if (id === 'rings') return undefined
  return { ...views, webDefault: id }
}

export function isAdvanced(s: ViewsState): boolean {
  return headerPins(s.uiPins?.header).includes('advanced') || !!s.uiPins?.views.includes('advanced')
}
