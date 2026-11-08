// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37: the one-line "your data lives only in this browser" notice on the Web tab. Pure, no DOM. */

/** Minutes of use before the line shows without the page having been left. */
export const BROWSER_ONLY_AFTER_MS = 5 * 60_000

export interface BrowserOnlyCtx {
  /** The person tapped "Got it" (AppState.browserOnlyDismissed). */
  dismissed: boolean
  demo: boolean
  /** When this visit began. */
  openedAt: number
  /** The page went hidden at least once in this visit, so the person is back from leaving or closing it. */
  wasHidden: boolean
}

export function shouldShowBrowserOnly(c: BrowserOnlyCtx, now: number): boolean {
  return !c.dismissed && !c.demo && (c.wasHidden || now - c.openedAt >= BROWSER_ONLY_AFTER_MS)
}
