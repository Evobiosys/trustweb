// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 36 keep-in-touch: the "Keep in touch" row of a person's card (cadence select, next date, "I was in touch today" with Undo). Local only. */
import { el } from '../../demo/src/ui/dom'
import type { AppState, Person } from './model'
import { CADENCE_CHOICES, nextReminder, setCadence } from './cadence'
import { lastContact } from './people_list'
import { S } from './strings'

export interface KeepIo {
  state(): AppState
  save(): void
  /** Redraws the card after a change. */
  redraw(): void
  toast(msg: string, undo: () => void): void
}

export function keepInTouchRow(io: KeepIo, p: Person): HTMLElement {
  const next = nextReminder(p, lastContact(io.state(), p), Date.now())
  return el('div', { class: 'keep-row', 'data-keep-row': p.id }, [
    el('h4', { class: 'eyebrow' }, [S.keepRowTitle]),
    el('select', {
      class: 'field', 'data-keep-cadence': p.id, 'aria-label': S.completeCadenceAria(p.name),
      onchange: (e: Event) => {
        setCadence(p, Number((e.target as HTMLSelectElement).value))
        io.save()
        io.redraw()
      },
    }, [el('option', { value: '0' }, [S.completeCadenceOff]), ...CADENCE_CHOICES.map((d) => el('option', { value: String(d), ...(d === p.cadenceDays ? { selected: '' } : {}) }, [S.completeCadenceEvery(d)]))]),
    next === undefined ? null : el('p', { class: 'meta', 'data-keep-next': '' }, [S.keepRowNext(new Date(next).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }))]),
    el('button', { class: 'linkbtn', 'data-keep-today': p.id, onclick: () => {
      const before = p.engagementKept
      p.engagementKept = Date.now()
      io.save()
      io.redraw()
      io.toast(S.keepTodayToast(p.name), () => {
        if (before === undefined) delete p.engagementKept; else p.engagementKept = before
        io.save()
        io.redraw()
      })
    } }, [S.keepToday]),
  ])
}
