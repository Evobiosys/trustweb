// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 32: "I could use support" (Jakob 2026-11-05): an ask for emotional support that goes only to the few people the asker picks.
 * It is not a query: no feed, no search, no Matches. It travels as protocol text inside the encrypted chat envelope of each paired
 * phone (like account_keep.ts), kind "support":
 *   asker -> each chosen person   <app url>?support=<json {id, chips, note, until}>
 *   helper -> asker               <app url>?support-here=<id>          ("I'm here")
 * An older build shows neither text anywhere. The audience is never wider than Friends; the ask closes itself at `until`.
 * Pure and DOM-free.
 */
import { Ring, ringSlot } from './model'
import type { Person } from './model'

export const SUPPORT_PARAM = 'support'
export const HERE_PARAM = 'support-here'

/** What would help, in the order they show. */
export const SUPPORT_CHIPS = ['listen', 'call', 'meet', 'sit', 'practical', 'know'] as const
export type SupportChip = (typeof SUPPORT_CHIPS)[number]

export enum SupportWindow {
  Today = 'today',
  Week = 'week',
}

export const SUPPORT_NOTE_MAX = 200
/** At most this many received asks are kept. */
export const SUPPORT_IN_MAX = 20

/** An ask this phone sent. `to` and `here` hold peer ids. */
export interface SupportAsk {
  id: string
  chips: SupportChip[]
  note: string
  until: number
  to: string[]
  here: string[]
  /** Wave 40 (support_delivery.ts): peer id -> the channel the sender opened for them (Signal, WhatsApp, Geb, e-mail) and when. "Here" stays for the app only. */
  via?: Record<string, { via: 'signal' | 'whatsapp' | 'geb' | 'email'; at: number }>
}

/** An ask this phone received from `peerId`. */
export interface SupportIn {
  id: string
  peerId: string
  chips: SupportChip[]
  note: string
  until: number
}

/** The widest audience the ask may reach. */
const AUDIENCE_RINGS: readonly Ring[] = [Ring.Closest, Ring.Close, Ring.Friend]

/** The rings up to and including `widest`; anything else (unknown, wider than Friends) falls back to the narrowest. */
export function audienceRings(widest: unknown): Ring[] {
  const i = AUDIENCE_RINGS.indexOf(widest as Ring)
  return AUDIENCE_RINGS.slice(0, i < 0 ? 1 : i + 1)
}

/** The connected people on those rings (family sits where its closeness says). */
export function audiencePeople<T extends Pick<Person, 'ring' | 'fields' | 'peerId'>>(people: readonly T[], widest: unknown): T[] {
  const rings = audienceRings(widest)
  return people.filter((p) => p.peerId && rings.includes(ringSlot(p)))
}

/** Today ends at the next local midnight; this week is seven days from now. */
export function closeAt(now: number, w: SupportWindow): number {
  if (w === SupportWindow.Week) return now + 7 * 86_400_000
  const d = new Date(now)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

export function isOpen(a: { until: number }, now: number): boolean {
  return now < a.until
}

export function openAsks<T extends { until: number }>(list: readonly T[] | undefined, now: number): T[] {
  return (list ?? []).filter((a) => isOpen(a, now))
}

const knownChips = (v: unknown): SupportChip[] =>
  SUPPORT_CHIPS.filter((c) => Array.isArray(v) && v.includes(c))

export function buildSupport(
  o: { chips: readonly string[]; note: string; window: SupportWindow; ids: readonly string[] }, now: number, id: string,
): SupportAsk {
  return { id, chips: knownChips(o.chips), note: o.note.trim().slice(0, SUPPORT_NOTE_MAX), until: closeAt(now, o.window), to: [...o.ids], here: [] }
}

/** The ask text for one person: no recipient list, so nobody learns who else was asked. */
export function supportText(appUrl: string, a: Pick<SupportAsk, 'id' | 'chips' | 'note' | 'until'>): string {
  return `${appUrl}?${SUPPORT_PARAM}=${encodeURIComponent(JSON.stringify({ id: a.id, chips: a.chips, note: a.note, until: a.until }))}`
}

export function hereText(appUrl: string, id: string): string {
  return `${appUrl}?${HERE_PARAM}=${encodeURIComponent(id)}`
}

/** Does this text claim to be a support text (well formed or not)? */
export function isSupportText(appUrl: string, text: string): boolean {
  return typeof text === 'string' && (text.startsWith(`${appUrl}?${SUPPORT_PARAM}=`) || text.startsWith(`${appUrl}?${HERE_PARAM}=`))
}

export function parseSupportText(appUrl: string, text: string): Pick<SupportAsk, 'id' | 'chips' | 'note' | 'until'> | null {
  const head = `${appUrl}?${SUPPORT_PARAM}=`
  if (typeof text !== 'string' || !text.startsWith(head)) return null
  try {
    const o = JSON.parse(decodeURIComponent(text.slice(head.length))) as Record<string, unknown>
    if (typeof o.id !== 'string' || !o.id || o.id.length > 40 || typeof o.until !== 'number' || !Number.isFinite(o.until)) return null
    return { id: o.id, chips: knownChips(o.chips), note: typeof o.note === 'string' ? o.note.slice(0, SUPPORT_NOTE_MAX) : '', until: o.until }
  } catch {
    return null
  }
}

export function parseHereText(appUrl: string, text: string): string | null {
  const head = `${appUrl}?${HERE_PARAM}=`
  if (typeof text !== 'string' || !text.startsWith(head)) return null
  try {
    const id = decodeURIComponent(text.slice(head.length))
    return id && id.length <= 40 ? id : null
  } catch {
    return null
  }
}

/** Notes that `peerId` is here; true when this changed anything. Only someone the ask went to, only while it is open, once. */
export function recordHere(asks: SupportAsk[], id: string, peerId: string, now: number): boolean {
  const a = asks.find((x) => x.id === id)
  if (!a || !isOpen(a, now) || !a.to.includes(peerId) || a.here.includes(peerId)) return false
  a.here.push(peerId)
  return true
}

const LOCAL_NUMBER: Record<string, string> = { US: '911', CA: '911', GB: '999', AU: '000', NZ: '111' }

/** The emergency number for a device locale; 112 (EU) when the region is unknown. */
export function emergencyNumber(locale: string | undefined): string {
  const region = locale?.split('-')[1]?.toUpperCase()
  return (region && LOCAL_NUMBER[region]) || '112'
}

/** The three things the ask dock can do: ask for hints (a question to the web), for support, or for intros. */
export const AskMode = { Hints: 'hints', Support: 'support', Intros: 'intros' } as const
export type AskMode = (typeof AskMode)[keyof typeof AskMode]
export const ASK_MODES: readonly AskMode[] = [AskMode.Support, AskMode.Hints, AskMode.Intros]

export function nextAskMode(mode: unknown): AskMode {
  return ASK_MODES.find((m) => m === mode) ?? AskMode.Hints
}

/** Wave 39: the one audience control. zone = "ring:<ring>" (up to that ring) or "tag:<id>"; Closest few are always in unless `notClosest`; `include` adds any connected person, `exclude` wins over everything. "Not Closest few" drops them even from a wider zone. */
export interface AudienceChoice { zone: string; notClosest?: boolean; include?: readonly string[]; exclude?: readonly string[] }

export function audience<T extends Pick<Person, 'id' | 'ring' | 'fields' | 'peerId'>>(
  people: readonly T[], a: AudienceChoice, hasTag: (p: T, tag: string) => boolean = () => false,
): T[] {
  const connected = people.filter((p) => p.peerId)
  const closest = (p: T): boolean => ringSlot(p) === Ring.Closest
  const inZone = a.zone.startsWith('tag:')
    ? (p: T): boolean => audienceRings(Ring.Friend).includes(ringSlot(p)) && hasTag(p, a.zone.slice(4))
    : (p: T): boolean => audienceRings(a.zone.slice(5)).includes(ringSlot(p))
  const out = new Set(a.exclude)
  const inc = new Set(a.include)
  return connected.filter((p) => !out.has(p.id) && (inc.has(p.id) || (closest(p) ? !a.notClosest : inZone(p))))
}
