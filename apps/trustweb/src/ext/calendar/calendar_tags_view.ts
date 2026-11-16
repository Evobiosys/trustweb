// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44 event-editor (Jakob item 12): calendars grouped by tag, each tag switched on or off (off = struck through, P2), e.g. all calendars
 * shared by one person, or the calendars of where I will physically be. "+ Calendar" adds one with its #tags. Logic: event_draft.ts.
 */
import { el } from '../../../../demo/src/ui/dom'
import { addCalendar, calendarTags, draftsOf, toggleCalendarTag } from '../../event_draft'
import { S } from '../../strings'
import type { ExtHooks } from '../registry'

let adding = false

export function calendarTagsRow(h: ExtHooks): HTMLElement {
  const s = h.state()
  const off = s.calendars?.off ?? []
  const chips = calendarTags(s).map((t) => {
    const on = !off.includes(t)
    return el('button', { class: 'chip' + (on ? ' on' : ' tw-off'), type: 'button', 'aria-pressed': String(on), 'data-cal-tag': t, onclick: () => { toggleCalendarTag(h.state(), t); h.save(); h.redraw() } }, [`#${t}`])
  })
  const name = el('input', { class: 'field', placeholder: S.ev44.calName, 'aria-label': S.ev44.calName, 'data-cal-new-name': '' }) as HTMLInputElement
  const tags = el('input', { class: 'field opt-min', placeholder: S.ev44.calTagsPh, 'aria-label': S.ev44.calTagsPh, 'data-cal-new-tags': '' }) as HTMLInputElement
  const add = (): void => {
    try { addCalendar(h.state(), name.value, tags.value, `cal-${Date.now().toString(36)}`) } catch { h.toast(S.ev44.calBad); return }
    adding = false
    h.save(); h.redraw()
  }
  return el('div', { class: 'cal-tags', 'data-cal-tags': '' }, [
    el('div', { class: 'chips' }, [el('b', { class: 'meta' }, [S.ev44.calTitle]), ...chips,
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'aria-expanded': String(adding), 'data-cal-new': '', onclick: () => { adding = !adding; h.redraw() } }, [S.ev44.calAdd])]),
    off.length ? el('p', { class: 'meta' }, [S.ev44.calHint]) : null,
    // Drafts wait in the plain list (Events), one tap away.
    draftsOf(s).length ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-cal-drafts': '', onclick: h.showList }, [S.ev44.calDrafts(draftsOf(s).length)]) : null,
    adding ? el('div', { 'data-cal-new-form': '' }, [name, tags, el('button', { class: 'btn btn-electric btn-sm', type: 'button', 'data-cal-new-go': '', onclick: add }, [S.ev44.calAddGo])]) : null,
  ])
}
