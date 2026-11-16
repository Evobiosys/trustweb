// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 43 answers-43 (alpha): people from the same event or community sit closer together inside their ring on the Web view, and an event
 * has its own colour. Pure and DOM-free. Jakob (2026-11-15): "show people from the same community closer together in the friends and acquaintance rings".
 */
import { eventTagSlug } from './event_tag'
import type { Person, TwEvent } from './model'

const hash = (s: string): number => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

/** One colour per event tag, from the slug alone (case-insensitive, so every device and every letter case agrees). */
export function eventColour(slug: string): string {
  const hue = hash(slug.toLowerCase()) % 360
  const [s, l] = [0.62, 0.45]
  const f = (n: number): string => {
    const k = (n + hue / 30) % 12
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

/** The colours of the events a person has (in the order the person was tagged); events this device does not know are skipped. */
export function eventColours(p: Pick<Person, 'events'>, events: readonly Pick<TwEvent, 'id' | 'name' | 'tagName'>[]): string[] {
  return (p.events ?? []).flatMap((id) => { const ev = events.find((e) => e.id === id); return ev ? [eventColour(eventTagSlug(ev.tagName ?? ev.name))] : [] })
}

/** Members of one group sit within this many degrees of each other (a crowd spreads further, one lap at a time: packLaps). */
const SECTOR = 120
const STEP = 12

/**
 * The angle each person of ONE ring is laid out at: people sharing an event (Person.events) or a community tag (`groupTags`, colour tag ids held as fields)
 * sit next to each other, in a sector placed by the group's name; everyone else, and anyone whose dot was dropped by hand (a stored angle), keeps `angleOf`.
 * A person in several groups joins the largest one (ties: the first by name).
 */
export function clusterAngles(people: readonly Person[], angleOf: (p: Person) => number, groupTags: readonly string[] = []): Map<string, number> {
  const groupsOf = (p: Person): string[] => [...(p.events ?? []).map((e) => `event:${e}`), ...groupTags.filter((t) => String(p.fields?.[t]) === 'true').map((t) => `tag:${t}`)]
  const size = new Map<string, number>()
  for (const p of people) for (const g of groupsOf(p)) size.set(g, (size.get(g) ?? 0) + 1)
  const home = (p: Person): string | undefined => groupsOf(p).filter((g) => (size.get(g) ?? 0) > 1).sort((a, b) => size.get(b)! - size.get(a)! || (a < b ? -1 : 1))[0]
  const members = new Map<string, Person[]>()
  const out = new Map<string, number>()
  for (const p of people) {
    const g = p.angle === undefined ? home(p) : undefined
    if (g) members.set(g, [...(members.get(g) ?? []), p]); else out.set(p.id, angleOf(p))
  }
  for (const [g, list] of members) {
    const step = list.length > 1 ? Math.min(STEP, SECTOR / (list.length - 1)) : 0
    const base = hash(g) % 360
    list.sort((a, b) => (a.id < b.id ? -1 : 1)).forEach((p, i) => out.set(p.id, (base + i * step) % 360))
  }
  return out
}
