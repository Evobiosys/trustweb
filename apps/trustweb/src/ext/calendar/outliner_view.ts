// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Calendar outliner rows on Resources (cal8): a folded list, one row per event or task with its fields as chips. */
import { el } from '../../../../demo/src/ui/dom'
import type { TwTask } from '../../model'
import { S } from '../../strings'
import type { ExtHooks } from '../registry'
import { CAL_FIELDS, calendarRows, type OutlinerRow } from './outliner_rows'

export function createOutliner(h: ExtHooks, openTask: (t: TwTask) => void): { section: () => Node[] } {
  const chips = (r: OutlinerRow): HTMLElement[] => {
    const f = r.fields
    return ([['when', f.when], ['where', f.where], ['people', f.people.join(', ')], ['status', S.cal.outlinerStatus[f.status]]] as const)
      .filter(([, v]) => v)
      .map(([k, v]) => el('span', { class: 'cal-chip', 'data-field': CAL_FIELDS[k] }, [`${S.cal.outlinerFields[k]}: ${v}`]))
  }
  const row = (r: OutlinerRow): HTMLElement => el('button', {
    class: 'cal-orow', 'data-cal-orow': r.id,
    onclick: () => {
      if (r.kind === 'event') { h.openEvent(r.id); return }
      const t = h.state().tasks?.find((x) => x.id === r.id)
      if (t) openTask(t)
    },
  }, [el('b', {}, [r.title]), el('div', { class: 'cal-chips' }, chips(r))])
  return {
    section: () => {
      const rows = calendarRows(h.state(), Date.now())
      return rows.length ? [el('details', { class: 'cal-outliner', 'data-cal-outliner': '' }, [el('summary', {}, [S.cal.outlinerTitle(rows.length)]), ...rows.map(row)])] : []
    },
  }
}
