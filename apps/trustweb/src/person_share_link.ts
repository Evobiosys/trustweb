// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 30 (person-share-link): ONE link per person. It is the owner's connect link (so the receiver reaches out with the existing tap)
 * plus, in the FRAGMENT (a browser never sends it to a server), the contact channels the owner ticked and the texts of the things the
 * person's zone may see (share_page.ts seenBy, the same canAccess as enforcement). Nothing else travels. Pure and DOM-free.
 */
import { buildContactPayload, contactText, parseContactText, type ChannelMap, type ContactPayload, type ShareSettings } from './contact_share'
import { CHANNELS } from './model'
import { stripUnsafe } from './safe_text'

const ITEM_KEY = 'si'
/** The contact keys (contact_share.ts wire): the channel names, `wa` (a WhatsApp share-QR link) and `p`. */
const CONTACT_KEYS: readonly string[] = [...CHANNELS, 'wa', 'p']
export const ITEMS_MAX = 8
export const ITEM_MAX = 80

export interface PersonShare {
  contact: ContactPayload | null
  items: string[]
}

const cleanItem = (t: string): string => stripUnsafe(t).trim().slice(0, ITEM_MAX)

/** `connectLink` (net.connectLink, may hold a fragment already) + the ticked contact + the zone's item texts. Nothing to add: unchanged. */
export function personShareLink(connectLink: string, mine: ChannelMap | undefined, settings: ShareSettings | undefined, items: readonly string[]): string {
  const q = new URLSearchParams()
  const built = buildContactPayload('', mine, settings)
  if (built) for (const [k, v] of new URLSearchParams(contactText('', built.payload).split('#')[1])) q.append(k, v)
  for (const t of items.map(cleanItem).filter(Boolean).slice(0, ITEMS_MAX)) q.append(ITEM_KEY, t)
  const add = q.toString()
  if (!add) return connectLink
  return connectLink + (connectLink.includes('#') ? '&' : '#') + add
}

/** Reads a link's fragment; null when it carries neither contact nor items. Never throws. */
export function parsePersonShare(hash: string): PersonShare | null {
  const frag = hash.startsWith('#') ? hash.slice(1) : hash
  const q = new URLSearchParams(frag)
  const items = q.getAll(ITEM_KEY).map(cleanItem).filter(Boolean).slice(0, ITEMS_MAX)
  // Only the contact keys go to the contact parser: its length bound counts the text it is given, not the items beside it.
  const own = new URLSearchParams([...q].filter(([k]) => CONTACT_KEYS.includes(k)))
  const contact = parseContactText('', `?contact=1#${own}`)
  return contact || items.length ? { contact, items } : null
}
