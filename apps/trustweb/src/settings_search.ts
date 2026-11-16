// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37: the search field at the top of Settings. The matcher is pure; filterSettings hides the rows that miss. */

import { emptyState } from './empty_state'

/** Lower case, accents removed, white space collapsed. */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Every word of the query occurs in the text. An empty query matches all. */
export function settingsMatches(query: string, text: string): boolean {
  const q = foldText(query)
  if (!q) return true
  const t = foldText(text)
  return q.split(' ').every((w) => t.includes(w))
}

const HEADING = 'h3, h4, .eyebrow, .settings-group-title'
const hits = (e: Element, q: string): boolean => settingsMatches(q, e.textContent ?? '')

/**
 * Hide every row under `root` that misses `query`. A group or section whose own title matches keeps all its rows; one with a
 * matching row opens; one without any match hides. While a query stands, no heading (summary, eyebrow) shows, only rows
 * (wave 44). An empty query shows everything again.
 */
export function filterSettings(root: Element, query: string): void {
  const rows = (box: Element): Element[] => Array.from(box.children).filter((c) => c.tagName !== 'SUMMARY')
  const walk = (box: Element, q: string): boolean => {
    const title = box.querySelector(':scope > summary')
    if (title) (title as HTMLElement).hidden = !!q
    const whole = !q || (title !== null && hits(title, q))
    let any = whole
    for (const r of rows(box)) {
      if (r.matches(HEADING)) { (r as HTMLElement).hidden = !!q; continue }
      const nested = r.matches('details')
      const ok = nested ? walk(r, whole ? '' : q) || whole : whole || hits(r, q)
      ;(r as HTMLElement).hidden = !ok
      if (ok && !whole) any = true
    }
    if (q && any && box.matches('details')) (box as HTMLDetailsElement).open = true
    return any
  }
  let shown = 0
  for (const g of Array.from(root.querySelectorAll('[data-settings-group]'))) { const any = walk(g, query); (g as HTMLElement).hidden = !any; if (any) shown++ }
  emptyState(root, query, shown)
}
