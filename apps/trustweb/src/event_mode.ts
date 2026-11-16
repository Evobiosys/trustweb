// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43b community-shell (B5): the event-only variant of the app. An event link may carry mode=event (the host sets it in the event's
 * Advanced: "What people see when they open this link"); opening such a link keeps the app in the event variant for this session
 * (bottom_bar.ts EVENT_ONLY_BAR). The pick lives in sessionStorage: a later normal visit is the full app again.
 */
const KEY = 'trustweb.ui.appMode'

export function eventModeOn(): boolean {
  try { return sessionStorage.getItem(KEY) === 'event' } catch { return false }
}

/** Called once with the event link the page opened with (or null). */
export function rememberEventMode(link: { linkMode?: 'event' } | null): void {
  if (link?.linkMode !== 'event') return
  try { sessionStorage.setItem(KEY, 'event') } catch { /* the variant then lasts until the next load only */ }
}
