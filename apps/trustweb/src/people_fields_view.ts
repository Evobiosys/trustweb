// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 37 people-fields: the Birthday field and the "thought of you" row of a person's card. Local until the owner tells the person (I1). */
import { el } from '../../demo/src/ui/dom'
import type { Person } from './model'
import { birthdayOf, birthdayText, parseBirthday } from './birthdays'
import { cardText, shareModeOf, thoughtAnswer, thoughtsThisMonth, type ThoughtShare } from './thought_of'
import { S } from './strings'

export interface FieldsIo {
  save(): void
  redraw(): void
  /** Sends one chat text to a connected person; false when it could not be queued. */
  tell(p: Person, text: string): Promise<boolean>
  /** Writes the share to the local audit log (I6). */
  log(line: string): void
}

/** The default Birthday field: a typed date (year optional), checked on blur, kept as YYYY-MM-DD or --MM-DD. */
export function birthdayRow(io: FieldsIo, p: Person): HTMLElement {
  const b = birthdayOf(p)
  const input = el('input', { class: 'field', type: 'text', inputmode: 'numeric', placeholder: S.birthdayHint, 'aria-label': S.birthdayFieldAria(p.name), 'data-birthday-input': p.id }) as HTMLInputElement
  input.value = b ? birthdayText(b) : (p.fields?.birthday ?? '')
  const bad = el('p', { class: 'meta', 'data-birthday-bad': '', hidden: true }, [S.birthdayBad])
  const commit = (): void => {
    const typed = input.value.trim()
    if (!typed) { if (p.fields) delete p.fields.birthday; bad.hidden = true; io.save(); return }
    const parsed = parseBirthday(typed)
    bad.hidden = parsed !== null
    if (!parsed) return
    p.fields = { ...p.fields, birthday: birthdayText(parsed) }
    io.save()
    io.redraw()
  }
  input.addEventListener('change', commit)
  return el('div', { class: 'keep-row', 'data-birthday-row': p.id }, [
    el('h4', { class: 'eyebrow' }, [S.birthdayTitle]),
    input, bad,
    b?.year ? el('p', { class: 'meta' }, [S.birthdayAge(new Date().getFullYear() - b.year + (new Date(new Date().getFullYear(), b.month - 1, b.day) < new Date() ? 1 : 0))]) : null,
  ])
}

/** "You thought of Anna 3 times this month" plus the choice how (and whether) she hears of it. */
export function thoughtRow(io: FieldsIo, p: Person, now = new Date()): HTMLElement {
  const mode = shareModeOf(p)
  const count = thoughtsThisMonth(p, now)
  return el('div', { class: 'keep-row', 'data-thought-of-share': p.id }, [
    el('h4', { class: 'eyebrow' }, [S.thoughtShareTitle]),
    count ? el('p', { class: 'meta', 'data-thought-count': '' }, [cardText(p.name, count)]) : null,
    el('select', {
      class: 'field', 'aria-label': S.thoughtShareTitle, 'data-thought-mode': p.id,
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value as ThoughtShare
        if (v === 'passive') delete p.thoughtShare; else p.thoughtShare = v
        io.save()
        io.redraw()
      },
    }, (['passive', 'active', 'off'] as const).map((k) => el('option', { value: k, ...(k === mode ? { selected: '' } : {}) }, [S.thoughtShareChoices[k]]))),
    el('p', { class: 'meta' }, [S.thoughtShareHint]),
    p.peerId && thoughtAnswer(p, now) && count > 0
      ? el('button', { class: 'linkbtn', 'data-thought-tell': p.id, onclick: () => { void io.tell(p, S.thoughtTellText(count)).then((ok) => { if (ok) io.log(S.thoughtTold(p.name)) }) } }, [S.thoughtTellNow(p.name)])
      : null,
  ])
}
