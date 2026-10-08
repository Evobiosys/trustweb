/** The "Is this safe?" sheet and its small link (reassurance.ts): DOM and words only. */
import { el } from '../../demo/src/ui/dom'
import { SafetyPlace, safetyLines } from './reassurance'
import { S } from './strings'

export interface SafetySheetOptions {
  /** Where it was opened from (a data attribute for tests, and the back link's wording). */
  place: SafetyPlace
  /** The way back to where the person came from. */
  back: { label: string; go: () => void }
}

/** The content of the sheet: a back link, the title, the sentences. */
export function safetySheetNodes(o: SafetySheetOptions): Node[] {
  return [
    el('button', { class: 'back-link', type: 'button', 'data-safe-back': '', onclick: o.back.go }, ['‹ ' + o.back.label]),
    el('h3', { 'data-safe-title': o.place }, [S.safeTitle]),
    ...safetyLines().map((line, i) => el('p', { class: 'safe-line', 'data-safe-line': String(i + 1) }, [line])),
  ]
}

/** The small link that opens the sheet. */
export function safetyLink(place: SafetyPlace, open: () => void): HTMLElement {
  return el('button', { class: 'btn btn-ghost btn-sm safe-link', type: 'button', 'data-safe-link': place, onclick: open }, [S.safeTitle])
}
