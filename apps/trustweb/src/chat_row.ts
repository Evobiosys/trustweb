// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 27 chat-row (Jakob 2026-10-31): the Chat button on a person's card opens the service most recently used WITH THIS PERSON,
 * unless the owner pinned one in the dropdown. Pure, no DOM. Preferences live in AppState.chatPrefs[personId] (travel to the owner's own devices as a setting; absent = none).
 */
import { reachableChannels } from './contact_share'
import type { ContactCarrier } from './contact_share'
import type { AppState, Channel, Person } from './model'
import { linkEntries } from './person_links'
import type { LinkKind } from './person_links'

export const TRUSTWEB = 'trustweb'

/** `trustweb`, `ch:<Channel>` (a stored channel handle) or `link:<LinkKind>` (a link typed on the card). */
export type ServiceId = string

export interface ChatService {
  id: ServiceId
  kind: 'trustweb' | 'channel' | 'link'
  channel?: Channel
  linkKind?: LinkKind
  /** The https link that opens it; absent for TrustWeb's in-app chat. */
  url?: string
}

export interface ChatPrefs {
  pinned?: ServiceId
  lastUsed?: Record<ServiceId, number>
}

type PrefsHolder = Pick<AppState, 'chatPrefs'>

/** Every way to chat with this person: TrustWeb (when connected), their channels in channel order, then links typed on the card. */
export function chatServices(p: ContactCarrier & Pick<Person, 'id' | 'peerId' | 'links'>): ChatService[] {
  const reach = reachableChannels(p)
  const out: ChatService[] = []
  if (p.peerId) out.push({ id: TRUSTWEB, kind: 'trustweb' })
  for (const r of reach) out.push({ id: 'ch:' + r.channel, kind: 'channel', channel: r.channel, url: r.link })
  for (const { kind, url } of linkEntries(p)) {
    if (!reach.some((r) => r.channel === kind)) out.push({ id: 'link:' + kind, kind: 'link', linkKind: kind, url })
  }
  return out
}

/** The service Chat opens: the pinned one, else the most recently used, else the first listed; null when nothing is linked. */
export function pickService(services: readonly ChatService[], prefs: ChatPrefs | undefined): ChatService | null {
  const by = (id: ServiceId | undefined): ChatService | undefined => services.find((s) => s.id === id)
  const pinned = by(prefs?.pinned)
  if (pinned) return pinned
  let best: ChatService | null = null
  let bestAt = -Infinity
  for (const s of services) {
    const at = prefs?.lastUsed?.[s.id]
    if (at !== undefined && at > bestAt) { best = s; bestAt = at }
  }
  return best ?? services[0] ?? null
}

/** Stamps `id` as just used with this person. */
export function noteUsed(s: PrefsHolder, personId: string, id: ServiceId, at: number): void {
  const prefs = s.chatPrefs ?? (s.chatPrefs = {})
  const mine = prefs[personId] ?? (prefs[personId] = {})
  mine.lastUsed = { ...mine.lastUsed, [id]: at }
}

/** Pins `id` for this person; pinning the pinned one unpins. Empty prefs are dropped so the record stays as it was. */
export function togglePin(s: PrefsHolder, personId: string, id: ServiceId): void {
  const prefs = s.chatPrefs ?? (s.chatPrefs = {})
  const mine = prefs[personId] ?? (prefs[personId] = {})
  if (mine.pinned === id) delete mine.pinned; else mine.pinned = id
  if (!mine.pinned && !mine.lastUsed) delete prefs[personId]
  if (!Object.keys(prefs).length) delete s.chatPrefs
}
