// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Undelivered fallback (wave 21): a message of mine still waiting after a day gets offers to send the same text through a messenger the
 * person shared with me (Signal first, WhatsApp second). Pure and DOM-free. Nothing here changes delivery: the TrustWeb message stays.
 */
import { MessageState } from './chat'
import type { ChatMessage } from './chat'
import { channelLink, isWhatsAppQrLink } from './channel'
import type { ChannelMap } from './contact_share'
import { Channel } from './model'

export const STUCK_AFTER_MS = 24 * 60 * 60 * 1000

export type FallbackKind = 'signal' | 'whatsapp'
export interface FallbackOffer {
  kind: FallbackKind
  url: string
}

export const isStuck = (m: Pick<ChatMessage, 'state' | 'at'>, now: number): boolean => m.state === MessageState.Pending && now - m.at > STUCK_AFTER_MS

/** Signal cannot prefill text (the caller copies it); WhatsApp can, except through a share link, which carries no number. */
export function fallbackOffers(theirs: ChannelMap | undefined, text: string): FallbackOffer[] {
  const out: FallbackOffer[] = []
  const signal = theirs?.[Channel.Signal]
  if (signal) out.push({ kind: 'signal', url: channelLink(Channel.Signal, signal) })
  const wa = theirs?.[Channel.WhatsApp]
  if (wa) {
    const link = channelLink(Channel.WhatsApp, wa)
    out.push({ kind: 'whatsapp', url: isWhatsAppQrLink(wa) ? link : `${link}?text=${encodeURIComponent(text)}` })
  }
  return out
}
