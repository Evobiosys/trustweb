// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 (whatsapp-window): the Chat > Extend entry and the card's WhatsApp link. Desktop: one named window beside TrustWeb. Phone: the wa.me link only. DOM only. */
import { el } from '../../../../demo/src/ui/dom'
import { nativeApp } from '../../native_app'
import { S } from '../../strings'
import type { ExtHooks, MessengerSource } from '../registry'
import { WA_URL, createWindowOpener } from './window'

let opener: ReturnType<typeof createWindowOpener> | undefined
/** Built on first use: module load must not touch `localStorage` (absent outside a browser). */
const windowOpener = (): ReturnType<typeof createWindowOpener> =>
  (opener ??= createWindowOpener({
    open: (url, name, features) => window.open(url, name, features),
    host: () => window,
    store: localStorage,
  }))
let toast: (msg: string) => void = () => {}

const onPhone = (): boolean => nativeApp || window.matchMedia('(pointer: coarse)').matches
const isWhatsAppLink = (url: string): boolean => /^https:\/\/(wa\.me|web\.whatsapp\.com)(\/|$)/.test(url)

/** Opens `url` (or WhatsApp Web) in the WhatsApp window; says so when the browser blocks it. */
function openInWindow(url?: string): void {
  if (windowOpener().open(url) === 'blocked') toast(S.whatsapp.blocked)
}

/** The card's Chat on a WhatsApp link: true when handled here (desktop only; the phone opens the app link as before). */
export function openExternal(url: string): boolean {
  if (onPhone() || !isWhatsAppLink(url)) return false
  openInWindow(url)
  return true
}

export function createWhatsApp(h: ExtHooks): MessengerSource {
  toast = h.toast
  const phone = onPhone()
  function setup(): void {
    const blocked = el('p', { class: 'meta', 'data-wa-blocked': '', hidden: true }, [S.whatsapp.blocked])
    const hint = el('p', { class: 'meta', 'data-wa-hint': '', hidden: true }, [S.whatsapp.besideHint])
    const go = phone
      ? [el('a', { class: 'btn', href: 'https://wa.me/', target: '_blank', rel: 'noopener', 'data-wa-open': '' }, [S.whatsapp.openPhone])]
      : [
          // noopener makes window.open return null, so a blocked tab cannot be told apart; the browser shows its own notice.
          el('button', { class: 'btn', 'data-wa-tab': '', onclick: () => { window.open(WA_URL, '_blank', 'noopener') } }, [S.whatsapp.open]),
          el('button', { class: 'btn small', 'data-wa-open': '', onclick: () => { const r = windowOpener().open(); blocked.hidden = r !== 'blocked'; hint.hidden = r === 'blocked' } }, [S.whatsapp.openBeside]),
        ]
    h.page(S.whatsapp.setupTitle, [
      ...go,
      blocked,
      hint,
      el('details', { class: 'info-hint', 'data-wa-info': '' }, [el('summary', {}, [S.whatsapp.info]), el('p', { class: 'meta' }, [phone ? S.whatsapp.infoPhone : S.whatsapp.infoText])]),
    ], 'whatsapp-window')
  }
  return { id: 'whatsapp', label: S.whatsapp.label, icon: '', status: () => 'needs-setup', threads: () => [], open: () => {}, setup }
}
