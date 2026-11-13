// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 42 community-support (B13): the "Community (community chat)" row of the Chat list only shows when that chat holds something: a
 * group chat (Telegram) linked for the community in force. An empty row is hidden; the top button reaches the Community view anyway.
 * Pure, no DOM.
 */
import { parseCommunity } from '../community-mighty/community_data'
import { NO_TAG, entryFor, parseEmbeds } from '../embeds/embeds_model'

export function communityChatLive(ext: Record<string, unknown> | undefined, ringsCommunity: string | undefined): boolean {
  const tag = parseCommunity(ext?.['community-mighty']).tag ?? ringsCommunity
  const embeds = parseEmbeds(ext?.embeds)
  return !!(entryFor(embeds, tag ?? NO_TAG).telegramUrl ?? entryFor(embeds, NO_TAG).telegramUrl)
}
