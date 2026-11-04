// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 31 (whatsapp-desktop): WhatsApp Web refuses to be framed, so it opens as a named TAB of the same browser window (never a popup). Pure of DOM; the window and storage are handed in. */
export const WA_URL = 'https://web.whatsapp.com'
export const WA_NAME = 'tw-whatsapp'
/** 'Side by side' switch on this device (localStorage only, never in the record). Default on. */
export const BESIDE_KEY = 'uiWhatsappBeside'

interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }
interface Tab { closed: boolean; focus(): void; close(): void; location: { href: string } }

export const loadBeside = (store: Store): boolean => store.getItem(BESIDE_KEY) !== '0'

export function saveBeside(store: Store, on: boolean): void {
  try { store.setItem(BESIDE_KEY, on ? '1' : '0') } catch { /* not remembered */ }
}

/** The split-view hint applies to desktop Chromium only (it has native split view); Safari, Firefox and phones get none. */
export function isDesktopChromium(uaData: { mobile?: boolean; brands?: { brand: string }[] } | undefined, ua: string): boolean {
  if (uaData?.brands) return !uaData.mobile && uaData.brands.some((b) => /chromium/i.test(b.brand))
  return /Chrome\//.test(ua) && !/Mobile|Android|Firefox/.test(ua)
}

/** wa.me/<number>[?text=] becomes the same chat on WhatsApp Web while the WhatsApp tab is open; anything else (share-QR links, other hosts) stays. */
export function waDesktopLink(href: string, tabOpen: boolean): string {
  const m = /^https:\/\/wa\.me\/(\d+)(?:\?text=([^#]*))?$/.exec(href)
  if (!tabOpen || !m) return href
  return `${WA_URL}/send?phone=${m[1]}${m[2] ? `&text=${m[2]}` : ''}`
}

export interface OpenerDeps {
  open: (url: string, name: string) => Tab | null
  /** True when the review extension marked the page (data-tw-review-ext). */
  ext: () => boolean
  /** Asks the extension to open the tab beside this one (document event tw-wa-split). */
  split: (url: string) => void
  /** The Side by side switch. */
  beside: () => boolean
}

/** One WhatsApp tab per TrustWeb tab: open it, or focus it (and send it to `url`) while it stays open. 'blocked' = the browser refused the tab. */
export function createWindowOpener(d: OpenerDeps): { open: (url?: string) => 'opened' | 'reused' | 'blocked'; close: () => void; isOpen: () => boolean } {
  let tab: Tab | null = null
  let viaExt = false
  const live = (): boolean => !!tab && !tab.closed
  return {
    open(url) {
      if (d.beside() && d.ext()) {
        const again = viaExt
        viaExt = true
        d.split(url ?? WA_URL)
        return again ? 'reused' : 'opened'
      }
      if (tab && live()) {
        if (url) tab.location.href = url
        tab.focus()
        return 'reused'
      }
      tab = d.open(url ?? WA_URL, WA_NAME)
      return tab ? 'opened' : 'blocked'
    },
    close() { if (tab && live()) tab.close() },
    isOpen: () => live() || viaExt,
  }
}
