// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 28 (whatsapp-window): WhatsApp Web refuses to be framed, so it opens in a named window beside TrustWeb. Pure of DOM; the window and storage are handed in. */
export const WA_URL = 'https://web.whatsapp.com'
export const WA_NAME = 'trustweb-whatsapp'
/** Position and size of the WhatsApp window on this device (localStorage only, never in the record). Absent: beside TrustWeb. */
export const WA_KEY = 'uiWhatsappWindow'
const WA_WIDTH = 700

export interface Geometry { left: number; top: number; width: number; height: number }
export interface HostWindow { screenX: number; screenY: number; outerWidth: number; outerHeight: number }
interface Store { getItem(k: string): string | null; setItem(k: string, v: string): void }
interface Popup { closed: boolean; focus(): void; location: { href: string } }

export const besideGeometry = (h: HostWindow): Geometry => ({ left: h.screenX + h.outerWidth, top: h.screenY, width: WA_WIDTH, height: h.outerHeight })

export const featuresString = (g: Geometry): string => `popup=yes,left=${g.left},top=${g.top},width=${g.width},height=${g.height}`

/** Wave 29: 'tab' = a normal new tab of this window (no popup features); 'beside' = the own window at `g`. */
export type OpenMode = 'tab' | 'beside'
export const windowFeatures = (mode: OpenMode, g: Geometry): string => (mode === 'tab' ? 'noopener' : featuresString(g))

export function loadGeometry(store: Store): Geometry | null {
  try {
    const g = JSON.parse(store.getItem(WA_KEY) ?? 'null') as Partial<Geometry> | null
    return g && [g.left, g.top, g.width, g.height].every((n) => Number.isFinite(n)) ? (g as Geometry) : null
  } catch { return null }
}

export function saveGeometry(store: Store, g: Geometry): void {
  try { store.setItem(WA_KEY, JSON.stringify(g)) } catch { /* not remembered */ }
}

export interface OpenerDeps {
  open: (url: string, name: string, features: string) => Popup | null
  host: () => HostWindow
  store: Store
}

/** One WhatsApp window per TrustWeb tab: open it, or focus it (and send it to `url`) while it stays open. 'blocked' = the browser refused the popup. */
export function createWindowOpener(d: OpenerDeps): { open: (url?: string) => 'opened' | 'reused' | 'blocked' } {
  let win: Popup | null = null
  return {
    open(url) {
      if (win && !win.closed) {
        if (url) win.location.href = url
        win.focus()
        return 'reused'
      }
      const g = loadGeometry(d.store) ?? besideGeometry(d.host())
      win = d.open(url ?? WA_URL, WA_NAME, windowFeatures('beside', g))
      if (!win) return 'blocked'
      saveGeometry(d.store, g)
      return 'opened'
    },
  }
}
