// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43c connect-extras (zeta): the TrustWeb-level Mastodon default. An event whose Feed is on (offers.feed) and that names no instance of its own
 * reads the public hashtag timeline of its tag on this one, read-only (mastodon_tag.ts). Leaf module with no runtime import (plain node, the MCP server, loads it too); `offers.feed` is event_press.ts eventOffersFeed.
 */
import type { TwEvent } from './model.ts'

export const MASTODON_DEFAULT_INSTANCE = 'mastodon.social'
/** Posting to Mastodon from TrustWeb waits for the TrustWeb account (Jakob 2026-11-16: "read first, post later"); the Feed only reads. */
export const MASTODON_POST_ENABLED = false

/** The instance an event's Feed reads: its own, else the default when the event's Feed is on, else none. */
export const eventMastodonHost = (ev: Pick<TwEvent, 'offers' | 'mastodonInstance'>): string | undefined => ev.mastodonInstance ?? (ev.offers?.feed === true ? MASTODON_DEFAULT_INSTANCE : undefined)
