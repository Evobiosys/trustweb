// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** answers-44d (item 3): Settings > Appearance "Emoji before titles" (P2: off = struck through). Logic: title_emoji.ts (re-exported for main.ts). */
import { el } from '../../demo/src/ui/dom'
import { S } from './strings'
import { emojiOn } from './title_emoji'

export { emojiOn, emojiTitle, titleEmoji } from './title_emoji'

/** Flips the switch on the record (off is stored as `titleEmojiOff`), then `after` (save + redraw). */
export function emojiSwitchRow(r: { titleEmojiOff?: true }, after: () => void): HTMLElement {
  const on = emojiOn(r)
  return el('div', { class: 'view-row', 'data-title-emoji-row': '' }, [
    el('button', {
      type: 'button', class: 'chip' + (on ? ' on' : ' tw-off'), 'aria-pressed': String(on), 'data-title-emoji-switch': '',
      onclick: () => { if (on) r.titleEmojiOff = true; else delete r.titleEmojiOff; after() },
    }, [S.a44d.emojiSwitch]),
    el('small', { class: 'meta' }, [` ${S.a44d.emojiHint}`]),
  ])
}
