// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Signal / Molly (wave 27): imports contacts and conversation metadata through a laptop companion; shows them read-only in Chat > Extend. */
import { ICONS } from '../../icons'
import { S } from '../../strings'
import type { ExtHooks, ExtModule, MessengerSource } from '../registry'
import { consumePairing } from './companion'
import { deepLink, threadsOf } from './proposals'
import { openSetup, type WordsByNumber } from './setup_view'

function signalMessenger(h: ExtHooks): MessengerSource {
  // The companion prints https://app.trustweb.one/#signal-link=<port>.<token>: read once, keep in localStorage only, drop it from the address bar.
  try { consumePairing(location.hash, localStorage, () => history.replaceState(null, '', location.pathname + location.search)) } catch { /* no storage: not paired */ }
  const words: WordsByNumber = new Map()
  return {
    id: 'signal-link',
    label: S.sigLabel,
    icon: ICONS.chat,
    status: () => (h.state().signalImport ? 'archive' : 'needs-setup'),
    threads: () => threadsOf(h.state().signalImport, h.state().people),
    open: (e164) => {
      const { href, fallback } = deepLink(e164)
      location.assign(href)
      // sgnl:// does nothing without the app; if this page is still in front a moment later, use the https link.
      setTimeout(() => { if (document.visibilityState === 'visible') window.open(fallback, '_blank', 'noopener') }, 1500)
    },
    setup: () => openSetup(h, words),
  }
}

export const signalLinkModule: ExtModule = {
  id: 'signal-link', label: S.sigLabel, icon: ICONS.chat,
  screen: () => ({ body: () => [] }),
  messenger: signalMessenger,
}
