// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44 steer-people-picker-4: "They will be placed in" as the app's segmented pills (`.seg`), one pill per scan zone. */
import { el } from '../../demo/src/ui/dom'
import type { Ring } from './model'
import { SCAN_RINGS } from './scan_rules'
import { S } from './strings'

export function placementPills(current: Ring, onPick: (r: Ring) => void): HTMLElement {
  const group = el('div', { class: 'seg', role: 'group', 'aria-label': S.w44pp2.placedIn, 'data-connect-placement': '' }, SCAN_RINGS.map((r) =>
    el('button', { type: 'button', class: r === current ? 'on' : '', 'aria-pressed': String(r === current), 'data-ring': r, onclick: () => {
      group.querySelectorAll('button').forEach((b) => { const on = b === group.querySelector(`[data-ring="${r}"]`); b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)) })
      onPick(r)
    } }, [S.ringLabel[r]])))
  return group
}
