// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 42 B08: the one "No match found" line every search surface shows when a query finds nothing. */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'

export const noMatchLine = (): HTMLElement => el('p', { class: 'empty meta', 'data-no-match': '' }, [S.noMatch])

/** Keeps exactly one "No match found" line in `box` while the query is not blank and the result count is 0; removes it otherwise. */
export function emptyState(box: Element, query: string, count: number): void {
  const mine = box.querySelector(':scope > [data-no-match]')
  const want = query.trim() !== '' && count === 0
  if (want && !mine) box.append(noMatchLine())
  else if (!want) mine?.remove()
}
