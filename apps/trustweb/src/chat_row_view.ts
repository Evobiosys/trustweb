// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 chat-row: [Chat] + a caret on a person's card. Chat opens the picked service (chat_row.ts pickService); the caret opens a
 * small inline menu of the linked services with a pin each. The one popover in the app that stays a popover: it is a menu, not a page.
 * DOM only; opening and saving are handed in (main.ts).
 */
import { el } from '../../demo/src/ui/dom'
import { pickService } from './chat_row'
import { dismissOnOutside } from './key_press'
import type { ChatPrefs, ChatService, ServiceId } from './chat_row'
import { S } from './strings'

export interface ChatRowDeps {
  personId: string
  services: readonly ChatService[]
  prefs: () => ChatPrefs | undefined
  /** Class of the main button (electric while it opens the in-app chat, ghost otherwise). */
  mainClass: string
  /** The Chat button's icon markup. */
  iconHtml: string
  label: (s: ChatService) => string
  open: (s: ChatService) => void
  pin: (id: ServiceId) => void
}

export function chatRow(d: ChatRowDeps): HTMLElement {
  const menu = el('div', { class: 'chat-menu', role: 'menu', 'data-chat-menu': d.personId, hidden: '' })
  const main = el('button', { class: 'btn ' + d.mainClass, 'data-card-chat': d.personId, 'data-chat-open': d.personId, onclick: () => { const s = pickService(d.services, d.prefs()); if (s) d.open(s) } })
  main.innerHTML = d.iconHtml
  main.append(S.chatOpen)
  const caret = el('button', {
    class: 'btn btn-ghost chat-caret', 'data-chat-caret': d.personId, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': S.chatRowChoose,
    onclick: (e: Event) => { e.stopPropagation(); if (menu.hidden) show(); else hide() },
  }, ['▾'])
  let stopListening: (() => void) | null = null
  const hide = (): void => { menu.hidden = true; caret.setAttribute('aria-expanded', 'false'); stopListening?.(); stopListening = null }
  const show = (): void => { menu.hidden = false; caret.setAttribute('aria-expanded', 'true'); stopListening = dismissOnOutside((t) => t instanceof Node && wrap.contains(t), hide) }
  const draw = (): void => {
    const pinned = d.prefs()?.pinned
    menu.replaceChildren(...d.services.map((s) => el('div', { class: 'chat-menu-item', role: 'none' }, [
      el('button', { class: 'chat-menu-open', role: 'menuitem', 'data-chat-service': s.id, onclick: () => { hide(); d.open(s) } }, [d.label(s)]),
      el('button', {
        class: 'chat-menu-pin' + (pinned === s.id ? ' on' : ''), 'data-chat-pin': s.id, 'aria-pressed': String(pinned === s.id),
        'aria-label': S.chatRowPinAria(d.label(s), pinned === s.id), onclick: () => { d.pin(s.id); draw() },
      }, [pinned === s.id ? '📌' : '📍']),
    ])))
  }
  draw()
  const wrap = el('div', { class: 'chat-row-wrap', 'data-chat-row': d.personId }, [main, caret, menu])
  return wrap
}
