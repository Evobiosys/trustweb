// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** The "Short link" line on Meet (wave 32): the alias link of this phone, a Copy button, a note until the host knows the alias. DOM and words only: short_alias.ts. */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'

export interface AliasLine {
  el: HTMLElement
  /** Shows `link` (null hides the line); `active` = the host accepted it. */
  set(link: string | null, active: boolean): void
}

export function createAliasLine(copy: (text: string) => void): AliasLine {
  let link = ''
  const text = el('code', { class: 'long-link', 'data-short-link': '' })
  const note = el('p', { class: 'meta', 'data-short-link-note': '', hidden: true }, [S.shortAliasPending])
  const button = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', 'data-short-link-copy': '', onclick: () => { if (link) copy(link) } }, [S.shortAliasCopy])
  const root = el('div', { class: 'link-choice', 'data-short-link-box': '', hidden: true }, [
    el('h4', { class: 'eyebrow' }, [S.shortAliasLabel]),
    el('p', { class: 'meta' }, [S.shortAliasHint]),
    text, note, button,
  ])
  return {
    el: root,
    set(next, active) {
      link = next ?? ''
      root.hidden = !next
      text.textContent = link
      note.hidden = active
    },
  }
}
