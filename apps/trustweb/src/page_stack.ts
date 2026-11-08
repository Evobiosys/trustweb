// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** How many pages (page_view.ts) stay open after a popstate. Pure, no DOM. */

/** Pages carry a numeric depth in `twPage`; the web's own entries carry a string ('card', 'more'), which means no page stays. */
export function pagesToKeep(state: unknown): number {
  const n = (state as { twPage?: unknown } | null)?.twPage
  return typeof n === 'number' ? n : 0
}

/** Wave 27: what a popstate does to the card page. `collapse` = fold the expanded card, `none` = a page or the expanded entry is still on top, `leave` = back to the web. */
export function cardPopAction(state: unknown, expanded: boolean): 'collapse' | 'none' | 'leave' {
  const t = (state as { twPage?: unknown } | null)?.twPage
  if (t === 'card' && expanded) return 'collapse'
  if (t === 'card-expanded' || typeof t === 'number') return 'none'
  return 'leave'
}

/** Wave 37: the Web press in the bottom bar. A page over the Web (a person's card, more, the Curator) closes first, so the press lands on the main Web view. */
export function webTabAction(page: unknown): 'leave-page' | 'tab' {
  return page ? 'leave-page' : 'tab'
}
