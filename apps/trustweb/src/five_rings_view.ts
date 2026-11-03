// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Five-ring prototype (five_rings.ts): the field overview under the rings, only while the flag is on. Counts per ring with a Dunbar hint, the not yet sorted, the lean moves. */
import { el } from '../../demo/src/ui/dom'
import { fieldOverview, migrateLean } from './five_rings'
import type { AppState } from './model'
import { S } from './strings'
import { toneVar } from './trustzones'

/** `s` is what the screen shows (counts); `on.live` is the stored record the accepted moves are written to (the screen may hold copies). */
export function fieldOverviewPanel(s: AppState, on: { live: () => Pick<AppState, 'people'>; save: () => void; render: () => void }): HTMLElement {
  const o = fieldOverview(s.people)
  return el('section', { class: 'field-overview', 'data-field-overview': '' }, [
    el('h3', {}, [S.fieldOverviewTitle]),
    el('details', { class: 'field-why', 'data-field-why': '' }, [el('summary', {}, [S.fieldWhyTitle]), el('p', { class: 'meta' }, [S.fieldWhy])]),
    ...o.rows.map((r) => el('div', { class: 'field-row', 'data-field-ring': r.ring }, [
      el('span', { class: 'field-dot', style: `background:${toneVar(r.ring)}`, 'aria-hidden': 'true' }),
      el('span', { class: 'field-name' }, [S.ringLabel[r.ring]]),
      el('b', { 'data-count': '' }, [String(r.count)]),
      el('small', {}, [S.fieldUpToHere(r.cumulative, r.hint.about)]),
    ])),
    el('p', { class: 'meta', 'data-field-unsorted': '' }, [S.fieldUnsorted(o.unsorted)]),
    o.leanMoves > 0
      ? el('div', { class: 'field-lean', 'data-field-lean': '' }, [
        el('span', {}, [S.fieldLeanRow(o.leanMoves)]),
        el('button', { type: 'button', onclick: () => { migrateLean(on.live(), 'all'); on.save(); on.render() } }, [S.fieldLeanMove]),
      ])
      : null,
    el('p', { class: 'meta' }, [S.fieldOverviewFoot]),
  ])
}
