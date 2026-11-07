// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/** Wave 29: tags on a zone (the record's `zoneTags`, per ring; absent = none). The tags themselves stay the colour tags; removing one here only unsets it for the zone. Pure over the record. */
import type { ColourTag } from './colour_tags'

export interface ZoneTagSet { ids: string[]; /** Last change (ms). */ stamp: number }
export interface ZoneTagRecord { zoneTags?: Record<string, ZoneTagSet> }

const PALETTE = ['#1565c0', '#2e7d32', '#c2185b', '#00838f', '#ef6c00', '#5d4037']
const norm = (s: string): string => s.trim().toLowerCase()
const nameOf = (t: ColourTag): string => t.label ?? t.id

export const zoneTagIds = (rec: ZoneTagRecord, zone: string): string[] => rec.zoneTags?.[zone]?.ids ?? []

function setIds(rec: ZoneTagRecord, zone: string, ids: string[], now: number): void {
  rec.zoneTags = { ...rec.zoneTags, [zone]: { ids, stamp: now } }
}

/** The tag the text names (matched by label or id, ignoring case); an unknown name defines a new one. `tags` is the full list to save when `created`. */
export function tagNamed(tags: readonly ColourTag[], name: string): { tags: readonly ColourTag[]; tag?: ColourTag; created: boolean } {
  const n = norm(name)
  if (!n) return { tags, created: false }
  const known = tags.find((t) => norm(nameOf(t)) === n || norm(t.id) === n)
  if (known) return { tags, tag: known, created: false }
  const slug = n.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'tag'
  let id = slug
  for (let i = 2; tags.some((t) => t.id === id); i++) id = `${slug}-${i}`
  const tag = { id, colour: PALETTE[tags.length % PALETTE.length], label: name.trim() }
  return { tags: [...tags, tag], tag, created: true }
}

/** Gives the zone the tag the text names; an unknown name defines a new tag. */
export function addZoneTag(rec: ZoneTagRecord, tags: readonly ColourTag[], zone: string, name: string, now: number): { tags: readonly ColourTag[]; created: boolean } {
  const { tags: list, tag, created } = tagNamed(tags, name)
  if (!tag) return { tags, created: false }
  const have = zoneTagIds(rec, zone)
  if (!have.includes(tag.id)) setIds(rec, zone, [...have, tag.id], now)
  return { tags: list, created }
}

export function removeZoneTag(rec: ZoneTagRecord, zone: string, id: string, now: number): void {
  setIds(rec, zone, zoneTagIds(rec, zone).filter((x) => x !== id), now)
}

/** Defined tags the zone lacks that contain the text, those starting with it first. */
export function suggestZoneTags(rec: ZoneTagRecord, tags: readonly ColourTag[], zone: string, text: string): ColourTag[] {
  const q = norm(text)
  const have = zoneTagIds(rec, zone)
  const hits = tags.filter((t) => !have.includes(t.id) && norm(nameOf(t)).includes(q))
  const starts = (t: ColourTag): number => (norm(nameOf(t)).startsWith(q) ? 0 : 1)
  return hits.map((t, i) => ({ t, i })).sort((a, b) => starts(a.t) - starts(b.t) || a.i - b.i).map((x) => x.t)
}
