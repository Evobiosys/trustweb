// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
// Wave 44 steer-strike-mode: the DOM side of Black and white mode (rules in bw_mode.ts).
import { el } from '../../demo/src/ui/dom'
import type { AppState } from './model'
import { S } from './strings'
import { setBwMode, strikeOff } from './bw_mode'

/** html.tw-bw switches the strike-through CSS (styles.css, wave44 steer-strike-mode). */
export function applyBwMode(s: AppState | null | undefined): void {
  document.documentElement.classList.toggle('tw-bw', strikeOff(s ?? undefined))
}

/** The Variations row. */
export function bwModeRow(s: AppState, onChange: () => void): HTMLElement {
  const on = strikeOff(s)
  return el('button', {
    class: 'radio' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(on), 'aria-pressed': String(on), 'data-variation-bw': '',
    onclick: () => { setBwMode(s, !on); onChange() },
  }, [el('b', {}, [S.w44bw.title]), el('small', {}, [S.w44bw.hint])])
}
