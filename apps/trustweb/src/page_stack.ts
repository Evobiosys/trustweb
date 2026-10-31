// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** How many pages (page_view.ts) stay open after a popstate. Pure, no DOM. */

/** Pages carry a numeric depth in `twPage`; the web's own entries carry a string ('card', 'more'), which means no page stays. */
export function pagesToKeep(state: unknown): number {
  const n = (state as { twPage?: unknown } | null)?.twPage
  return typeof n === 'number' ? n : 0
}
