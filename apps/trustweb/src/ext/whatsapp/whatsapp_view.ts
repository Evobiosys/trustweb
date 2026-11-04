// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 (whatsapp-desktop): the Chat > Extend entry and the card's WhatsApp link. Desktop: one named tab of this window. Phone: the wa.me link only. DOM only. */
import { el } from '../../../../demo/src/ui/dom'
import { nativeApp } from '../../native_app'
import { S } from '../../strings'
import type { ExtHooks, MessengerSource } from '../registry'
import { createWindowOpener, isDesktopChromium, loadBeside, saveBeside, waDesktopLink } from './window'

const REVIEW_EXT = 'twReviewExt'
const hasExt = (): boolean => document.documentElement.dataset[REVIEW_EXT] === '1'

let opener: ReturnType<typeof createWindowOpener> | undefined
/** Built on first use: module load must not touch `localStorage` (absent outside a browser). */
const windowOpener = (): ReturnType<typeof createWindowOpener> =>
  (opener ??= createWindowOpener({
    open: (url, name) => window.open(url, name),
    ext: hasExt,
    split: (url) => document.dispatchEvent(new CustomEvent('tw-wa-split', { detail: { url } })),
    beside: () => loadBeside(localStorage),
  }))
let toast: (msg: string) => void = () => {}

const onPhone = (): boolean => nativeApp || window.matchMedia('(pointer: coarse)').matches
const isWhatsAppLink = (url: string): boolean => /^https:\/\/(wa\.me|web\.whatsapp\.com)(\/|$)/.test(url)
/** Chromium has native split view but a page cannot trigger it; without the review extension the page only says how. */
const wantsSplitHint = (): boolean =>
  loadBeside(localStorage) && !hasExt() && isDesktopChromium((navigator as Navigator & { userAgentData?: { mobile?: boolean; brands?: { brand: string }[] } }).userAgentData, navigator.userAgent)

/** Opens `url` (or WhatsApp Web) in the WhatsApp tab, as the Side by side switch says; says so when the browser blocks it. */
function openInTab(url?: string): 'opened' | 'reused' | 'blocked' {
  const r = windowOpener().open(url && waDesktopLink(url, windowOpener().isOpen()))
  if (r === 'blocked') toast(S.whatsapp.blocked)
  return r
}

/** The card's Chat on a WhatsApp link: true when handled here (desktop only; the phone opens the app link as before). */
export function openExternal(url: string): boolean {
  if (onPhone() || !isWhatsAppLink(url)) return false
  openInTab(url)
  return true
}

/** The per-person WhatsApp buttons (a[data-wa-person]) go to the WhatsApp tab while it is open; otherwise the plain wa.me link works as before. */
let linksHooked = false
function hookPersonLinks(): void {
  if (linksHooked) return
  linksHooked = true
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest<HTMLAnchorElement>('a[data-wa-person]')
    if (!a || onPhone() || !windowOpener().isOpen()) return
    e.preventDefault()
    openInTab(a.href)
  })
}

export function createWhatsApp(h: ExtHooks): MessengerSource {
  toast = h.toast
  const phone = onPhone()
  if (!phone) hookPersonLinks()
  function setup(): void {
    const blocked = el('p', { class: 'meta', 'data-wa-blocked': '', hidden: true }, [S.whatsapp.blocked])
    const hint = el('p', { class: 'meta', 'data-wa-hint': '', hidden: true }, [S.whatsapp.splitHint])
    const go = phone
      ? [el('a', { class: 'btn', href: 'https://wa.me/', target: '_blank', rel: 'noopener', 'data-wa-open': '' }, [S.whatsapp.openPhone])]
      : [
          el('button', {
            class: 'btn', 'data-wa-open': '',
            onclick: () => { const r = openInTab(); blocked.hidden = r !== 'blocked'; hint.hidden = r === 'blocked' || !wantsSplitHint() },
          }, [hasExt() && loadBeside(localStorage) ? S.whatsapp.openBeside : S.whatsapp.open]),
          el('button', { class: 'btn btn-ghost btn-sm', 'data-wa-close': '', onclick: () => { windowOpener().close(); hint.hidden = true } }, [S.whatsapp.close]),
          el('label', { class: 'meta' }, [
            el('input', { type: 'checkbox', 'data-wa-beside': '', checked: loadBeside(localStorage), onchange: (e: Event) => saveBeside(localStorage, (e.target as HTMLInputElement).checked) }),
            ` ${S.whatsapp.sideBySide}`,
          ]),
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
