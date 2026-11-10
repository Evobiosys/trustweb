// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 39: a heading's children = the title plus the grey subscript "untested alpha feature", for every view Jakob has not approved yet. */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'

/** The grey subscript alone (one source for every alpha heading; CSS .alpha-label in styles.css, once). */
export const alphaSub = (): HTMLElement => el('sub', { class: 'alpha-label', 'data-alpha-label': '' }, [S.alphaLabel])

export function alphaHeading(title: string): (Node | string)[] {
  return [title, ' ', alphaSub()]
}
