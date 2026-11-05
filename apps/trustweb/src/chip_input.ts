// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 32 (shared-notes): the @ people / # tags typeahead box of the Web filters, shared with the note Share picker. DOM only; the matching is share_page.ts suggest / tag_create.ts suggestOrCreate. */
import { el } from '../../demo/src/ui/dom'

export interface ChipHit { label: string; attrs: Record<string, string>; pick: () => void }

/** An input plus the hit chips under it; typing lists `hits(text)`, Enter takes the first. `attrs` go on the input. */
export function chipInput(o: { placeholder: string; aria: string; attrs: Record<string, string>; hits: (text: string) => ChipHit[] }): { input: HTMLInputElement; hits: HTMLElement } {
  const hits = el('div', { class: 'share-hits' })
  const input = el('input', { class: 'field', placeholder: o.placeholder, 'aria-label': o.aria, autocomplete: 'off', ...o.attrs }) as HTMLInputElement
  input.addEventListener('input', () => hits.replaceChildren(...o.hits(input.value).map((h) => el('button', { class: 'chip', ...h.attrs, onclick: h.pick }, [h.label]))))
  input.addEventListener('keydown', (e) => { const first = (e as KeyboardEvent).key === 'Enter' ? o.hits(input.value)[0] : undefined; if (first) first.pick() })
  return { input, hits }
}
