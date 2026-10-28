// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { el } from '../../demo/src/ui/dom'

/** What a key does inside a tap-edit input: Enter saves, Escape cancels. */
export const editKey = (key: string): 'save' | 'cancel' | null => (key === 'Enter' ? 'save' : key === 'Escape' ? 'cancel' : null)

export interface TapEdit {
  /** The text shown while not editing. */
  text: string
  /** Initial input value. */
  value: string
  aria: string
  attrs?: Record<string, string>
  maxlength?: number
  /** The value to save for what was typed, or null to keep the old one. */
  resolve(typed: string): string | null
  /** Saves a resolved value; the caller redraws. */
  commit(next: string): void
}

/** A text that becomes an input on tap (Enter or blur saves, Escape cancels). */
export function tapEdit(host: HTMLElement, o: TapEdit): void {
  const show = (): void => host.replaceChildren(el('button', { class: 'tap-edit', 'aria-label': o.aria, ...o.attrs, onclick: edit }, [o.text]))
  const edit = (): void => {
    const input = el('input', { class: 'field tap-edit-input', 'aria-label': o.aria, ...(o.maxlength ? { maxlength: String(o.maxlength) } : {}) })
    input.value = o.value
    let done = false
    const finish = (save: boolean): void => {
      if (done) return
      done = true
      const next = save ? o.resolve(input.value) : null
      if (next === null) show(); else o.commit(next)
    }
    input.addEventListener('keydown', (e) => { const a = editKey(e.key); if (a) finish(a === 'save') })
    input.addEventListener('blur', () => finish(true))
    host.replaceChildren(input)
    input.focus(); input.select()
  }
  show()
}
