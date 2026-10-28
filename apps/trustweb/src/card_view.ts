// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
import { normalizeHandle } from './channel'
import type { Channel, Person } from './model'

/** localStorage key (per device) for the folded "Curate" section at the bottom of a person's card. */
export const CARD_CURATE_KEY = 'trustweb.ui.cardCurate'

/** Folded unless this device stored "1" (absent = folded). */
export const curateOpen = (raw: string | null): boolean => raw === '1'
export const curateStored = (open: boolean): string => (open ? '1' : '0')

/** Connected on TrustWeb = a peer id is set; the rings draw such a person filled, any other as an outline. */
export const isConnected = (p: Pick<Person, 'peerId'>): boolean => Boolean(p.peerId)

/** The card's primary button: chat inside TrustWeb, or (not connected yet) the way to connect first. */
export const chatButtonKind = (p: Pick<Person, 'peerId'>): 'chat' | 'connect' => (isConnected(p) ? 'chat' : 'connect')

/** The value a tap-edit of a typed channel saves: normalized; '' clears it; null = keep the old (invalid or unchanged). */
export function channelEdit(ch: Channel, current: string | undefined, typed: string): string | null {
  if (!typed.trim()) return current ? '' : null
  const next = normalizeHandle(ch, typed)
  return next && next !== current ? next : null
}
