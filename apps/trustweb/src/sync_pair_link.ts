// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 44c sync-seamless (A5): the app opened from a pairing link (the QR of "Link a device" read by the camera app): joins and shows the confirm sheet. */
import { pairCodeFromHash } from './sync_core'

/** True when `hash` held a pair code: it is handed to the view and the address bar is cleared (the code is a one-time secret). */
export function openPairLink(hash: string, view: { joinLink(code: string): Promise<void> }, clear: () => void = () => history.replaceState(null, '', location.pathname + location.search)): boolean {
  const code = pairCodeFromHash(hash)
  if (!code) return false
  clear()
  void view.joinLink(code)
  return true
}
