// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 31 (zone-share-link): a NAMED link per zone ("Share this link with friends"). It is the person link of wave 30 (person_share_link.ts:
 * connect link + ticked contact + item texts in the fragment) plus the zone it is for (`zl`, the highest zone named), its name (`zn`) and its
 * expiry (`ze`, seconds). The items are what the zone(s) see by the same canAccess as enforcement (share_page.ts). Revoke stops the app
 * from giving the link out again; a copy already handed over cannot be recalled, it only expires (I9: one year). Pure and DOM-free.
 */
import { personShareLink, parsePersonShare, type PersonShare } from './person_share_link'
import type { ChannelMap, ShareSettings } from './contact_share'
import { stripUnsafe } from './safe_text'
import { canAccess } from './share_sink/check'
import { ALL_ZONES, Zone, isZone, rank } from './share_sink/zones'
import { storeOf, type Basis } from './share_page'

const YEAR_MS = 365 * 86_400_000
export const NAME_MAX = 40
const WHO = 'person:zone-link'

/** The record of one link in Settings > Sharing links. Revoked links stay listed. */
export interface ZoneLink { id: string; name: string; zones: Zone[]; created: number; exp: number; revoked?: number }
export interface ZoneShare extends PersonShare { zone: Zone; name: string }

const cleanName = (t: string): string => stripUnsafe(t).trim().slice(0, NAME_MAX)

export const highestZone = (zones: readonly Zone[]): Zone => zones.reduce((a, b) => (rank(b) > rank(a) ? b : a))

export const newZoneLink = (name: string, zones: Zone[], now: number, id: string): ZoneLink => ({ id, name: cleanName(name), zones, created: now, exp: now + YEAR_MS })

export const zoneLinkLive = (l: ZoneLink, now: number): boolean => l.revoked === undefined && now < l.exp

export const revokeZoneLink = (links: readonly ZoneLink[], id: string, now: number): ZoneLink[] =>
  links.map((l) => (l.id === id && l.revoked === undefined ? { ...l, revoked: now } : l))

/** The ids of the shared items any of these zones sees: a stand-in person in the zone, the same check as for a real one. */
export function zoneItems(b: Basis, zones: readonly Zone[], now: Date): string[] {
  const since = new Date(0).toISOString()
  const items = [...new Set((b.shares ?? []).filter((l) => l.op === 'share').map((l) => l.id))]
  const seen = new Set<string>()
  for (const z of zones) {
    const store = [...storeOf(b), { subject: WHO, relation: 'in_zone' as const, object: `zone:${z}`, since, by: 'device:this' }]
    for (const i of items) if (canAccess(store, WHO, i, now, ALL_ZONES).allowed) seen.add(i.slice('item:'.length))
  }
  return [...seen]
}

/** The person link (contact + items) with the zone, name and expiry added. */
export function zoneShareLink(connectLink: string, mine: ChannelMap | undefined, settings: ShareSettings | undefined, link: ZoneLink, items: readonly string[]): string {
  const base = personShareLink(connectLink, mine, settings, items)
  const q = new URLSearchParams({ zl: highestZone(link.zones), zn: cleanName(link.name), ze: String(Math.floor(link.exp / 1000)) })
  return base + (base.includes('#') ? '&' : '#') + q.toString()
}

/** Reads a zone link's fragment; null when it names no valid zone, names Only me, or has expired. Never throws. */
export function parseZoneShare(hash: string, now: number): ZoneShare | null {
  const q = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash)
  const zone = q.get('zl') ?? ''
  const exp = Number(q.get('ze') ?? Infinity)
  if (!isZone(zone) || zone === Zone.Self || !(now < exp * 1000)) return null
  const person = parsePersonShare(hash)
  return { contact: person?.contact ?? null, items: person?.items ?? [], zone, name: cleanName(q.get('zn') ?? '') }
}
