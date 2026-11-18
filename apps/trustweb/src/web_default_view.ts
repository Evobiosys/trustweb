// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 35: the view pinned as the default of the Web tab (AppState.uiViews.webDefault, a view_menu ViewKey; absent = the rings; wave 44c answers-44c).
 * The Web tab opens it and carries its name. Advanced mode = the Advanced pin is on. Pure, no DOM.
 */
import { headerPins } from './header_controls'

export interface UiViews { webDefault?: string }
interface ViewsState { uiViews?: UiViews; uiPins?: { views: string[]; header?: string[] } }

/** Wave 44c answers-44c (Jakob 20:22): the personal Web tab is the web again; Home only when chosen (Settings > Home "Open Home first"). The community view leads with its Home tab. */
export const webDefaultOf = (s: ViewsState): string => s.uiViews?.webDefault || 'rings'

/** Wave 43c: false = the bottom-bar tab keeps "Web" (Settings texts say Contacts); true = the rings tab reads "Contacts". Jakob decides. */
export const CONTACTS_TAB_LABEL = false

/** The Web tab's label: the pinned view's name; the rings (or a name this build lacks) keep "Web", or read `contacts` when the caller hands that word in. */
export function webTabLabel(s: ViewsState, names: Record<string, string>, contacts?: string): string {
  const pinned = webDefaultOf(s)
  return names[pinned] && pinned !== 'rings' && pinned !== 'home' ? names[pinned] : contacts ?? names.rings
}

/** Wave 43c: pinning these views changes what the Web screen shows right now (they are remembered, WEB_VIEW_KEY); the others open as pages on the next tap. */
export const shownAtOnce = (view: string): boolean => view === 'rings' || view === 'network' || view === 'map'

/** review-fixes-43c: the Web view to remember after a new default (eye-menu pin AND the Settings select), or null when it opens as a page on the next tap. */
export const webViewAfterDefault = (view: string): string | null => (shownAtOnce(view) ? view : null)

/** The next `uiViews`: the rings are stored too (absent = the rings as well). */
export function setWebDefault(views: UiViews | undefined, id: string): UiViews {
  return { ...views, webDefault: id }
}

export function isAdvanced(s: ViewsState): boolean {
  return headerPins(s.uiPins?.header).includes('advanced') || !!s.uiPins?.views.includes('advanced')
}

/* wave44c answers-44c */
/** What the Web tab opens: in the community view always the web (its Home is the tab before it); in the personal view the pinned default. */
export const webTabTarget = (s: ViewsState, community: boolean): string => (community ? 'rings' : webDefaultOf(s))
