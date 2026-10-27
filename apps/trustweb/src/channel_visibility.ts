// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Settings "Show my Signal / WhatsApp links to people who connect" (wave 21). AppState.showMessengerLinks: absent = shown (today's
 * behaviour), only false is stored. Off keeps Signal and WhatsApp out of what leaves this phone from now on (answers to "Ask for their
 * links", the public-link offer); a link already sent is never taken back. Pure, DOM-free.
 */
import { Channel } from './model'

export type VisibilityState = { showMessengerLinks?: false }

const MESSENGERS: readonly Channel[] = [Channel.Signal, Channel.WhatsApp]

/** Is this channel shown under the setting (`false` = off; anything else = on)? */
export function channelShown(setting: boolean | undefined, channel: Channel): boolean {
  return setting !== false || !MESSENGERS.includes(channel)
}

export function shownChannels(setting: boolean | undefined, channels: readonly Channel[]): Channel[] {
  return channels.filter((ch) => channelShown(setting, ch))
}

export function messengerLinksShown(s: VisibilityState): boolean {
  return s.showMessengerLinks !== false
}

/** Flips the setting; only "off" is stored. */
export function toggleMessengerLinks(s: VisibilityState): void {
  if (s.showMessengerLinks === false) delete s.showMessengerLinks
  else s.showMessengerLinks = false
}
