// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Calendar scheduling (wave 24, cal5): availability snapshots and the two link kinds, pure and DOM-free. Everything travels in URL fragments
 * (never sent to a server): `#book=` carries free/busy intervals (no names, places or people: I1), `#booked=` the booker's reply.
 */
import { newEvent } from '../../events'
import { fromBase64Url, toBase64Url } from '../../event_link'
import type { AppState, AvailSnap, HeldAvail, TwEvent } from '../../model'
import { S } from '../../strings'

type Span = { s: number; e: number }
const MIN = 60_000
const DAY = 86_400_000
const MAX_CHARS = 6144
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^(\d{4})-(\d{2})-(\d{2})(T(\d{2}):(\d{2}))?$/

const localMs = (iso: string, endOfDay: boolean): number => {
  const m = DATE.exec(iso)
  if (!m) return NaN
  return m[4] ? new Date(iso).getTime() : new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (endOfDay ? 1 : 0)).getTime()
}

/** Busy intervals of my events in [fromMs, fromMs + days): date-only = whole days, no end = one hour. Intervals only, no names. */
export function busyOf(events: TwEvent[], fromMs: number, days: number): Span[] {
  const to = fromMs + days * DAY
  return events
    .map((ev): Span => ({ s: localMs(ev.from, false), e: ev.to ? localMs(ev.to, true) : ev.from.length > 10 ? localMs(ev.from, false) + 60 * MIN : localMs(ev.from, true) }))
    .filter((b) => b.s < to && b.e > fromMs)
    .sort((a, b) => a.s - b.s)
}

const merge = (spans: Span[]): Span[] => {
  const out: Span[] = []
  for (const x of [...spans].sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1]
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e); else out.push({ ...x })
  }
  return out
}

/** My snapshot, busy rounded outward to the slot length and merged; null when availability is not set up. */
export function snapshot(state: Pick<AppState, 'me' | 'events' | 'availability'>, now: number, tz = Intl.DateTimeFormat().resolvedOptions().timeZone): AvailSnap | null {
  const a = state.availability
  if (!a) return null
  const slotMin = a.slotMin ?? 30
  const step = slotMin * MIN
  const busy = merge(busyOf(state.events ?? [], now, a.horizonDays ?? 14).map((b) => ({ s: Math.floor(b.s / step) * step, e: Math.ceil(b.e / step) * step })))
  return { name: state.me.displayName, tz, windows: a.windows, slotMin, busy, at: now }
}

/** Zone offset (ms east of UTC) at an instant, via Intl: no library. */
function offsetAt(tz: string, ms: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(ms).map((x) => [x.type, Number(x.value)]))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** Wall clock in a zone to an instant (one refinement step covers a DST change). */
function wallToMs(tz: string, y: number, m0: number, d: number, hhmm: string): number {
  const wall = Date.UTC(y, m0, d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3)))
  const first = wall - offsetAt(tz, wall)
  return wall - offsetAt(tz, first)
}

/** A snapshot's windows as instants over the zone-days around [fromMs, fromMs + days) (one day of margin each side; the caller clips). */
function windowSpans(sn: AvailSnap, fromMs: number, days: number): Span[] {
  const start = new Date(fromMs + offsetAt(sn.tz, fromMs))
  const out: Span[] = []
  for (let i = -1; i <= days; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i))
    const day = (d.getUTCDay() + 6) % 7
    for (const w of sn.windows) {
      if (w.day === day) out.push({ s: wallToMs(sn.tz, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), w.from), e: wallToMs(sn.tz, d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), w.to) })
    }
  }
  return merge(out)
}

const intersect = (a: Span[], b: Span[]): Span[] => a.flatMap((x) => b.flatMap((y) => (Math.max(x.s, y.s) < Math.min(x.e, y.e) ? [{ s: Math.max(x.s, y.s), e: Math.min(x.e, y.e) }] : [])))

function subtract(free: Span[], busy: Span[]): Span[] {
  return busy.reduce((acc, b) => acc.flatMap((f) => (b.e <= f.s || b.s >= f.e ? [f] : [...(b.s > f.s ? [{ s: f.s, e: b.s }] : []), ...(b.e < f.e ? [{ s: b.e, e: f.e }] : [])])), free)
}

/** Slots (slotMin long, on the slotMin grid) where every snapshot is inside a window and not busy, from fromMs on. */
export function freeSlots(snaps: AvailSnap[], fromMs: number, days: number, slotMin: number): Span[] {
  const step = slotMin * MIN
  const end = fromMs + days * DAY
  const free = snaps.reduce<Span[] | null>((acc, sn) => {
    const mine = subtract(windowSpans(sn, fromMs, days), sn.busy)
    return acc ? intersect(acc, mine) : mine
  }, null) ?? []
  return free.flatMap((f) => {
    const slots: Span[] = []
    for (let s = Math.ceil(Math.max(f.s, fromMs) / step) * step; s + step <= Math.min(f.e, end); s += step) slots.push({ s, e: s + step })
    return slots
  })
}

export interface BookPayload { v: 1; owner: { name: string; did?: string }; snaps: AvailSnap[]; id: string }
export interface BookedPayload { v: 1; id: string; slot: Span; from: { name: string; did?: string }; note?: string }

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const validZone = (tz: string): boolean => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false } }
const span = (v: unknown): v is Span => { const o = obj(v); return !!o && num(o.s) && num(o.e) && o.s < o.e }

function validSnap(v: unknown): v is AvailSnap {
  const o = obj(v)
  return !!o && text(o.name, 80) && text(o.tz, 60) && validZone(o.tz) && num(o.at) && (o.slotMin === 30 || o.slotMin === 60)
    && Array.isArray(o.windows) && o.windows.length <= 28 && o.windows.every((w) => { const x = obj(w); return !!x && Number.isInteger(x.day) && (x.day as number) >= 0 && (x.day as number) <= 6 && HHMM.test(String(x.from)) && HHMM.test(String(x.to)) && String(x.from) < String(x.to) })
    && Array.isArray(o.busy) && o.busy.length <= 400 && o.busy.every(span)
}

const who = (v: unknown): v is { name: string; did?: string } => { const o = obj(v); return !!o && text(o.name, 80) && (o.did === undefined || text(o.did, 600)) }

function decodeFragment(hash: string, key: string): Record<string, unknown> | null {
  const raw = new URLSearchParams(hash.replace(/^#/, '')).get(key)
  if (!raw || raw.length > MAX_CHARS) return null
  try { return obj(JSON.parse(fromBase64Url(raw))) } catch { return null }
}

export const encodeBookLink = (origin: string, p: BookPayload): string => `${origin}/#book=${toBase64Url(JSON.stringify(p))}`
export const encodeBookedLink = (origin: string, p: BookedPayload): string => `${origin}/#booked=${toBase64Url(JSON.stringify(p))}`

/** The scheduling payload in a location.hash, or null for anything missing, mangled, invalid or over 6 KB. */
export function decodeBookLink(hash: string): BookPayload | null {
  const o = decodeFragment(hash, 'book')
  if (!o || o.v !== 1 || !who(o.owner) || !text(o.id, 40) || !Array.isArray(o.snaps) || !o.snaps.length || o.snaps.length > 6 || !o.snaps.every(validSnap)) return null
  return o as unknown as BookPayload
}

export function decodeBookedLink(hash: string): BookedPayload | null {
  const o = decodeFragment(hash, 'booked')
  if (!o || o.v !== 1 || !text(o.id, 40) || !span(o.slot) || !who(o.from) || (o.note !== undefined && (typeof o.note !== 'string' || o.note.length > 500))) return null
  return o as unknown as BookedPayload
}

const p2 = (n: number): string => String(n).padStart(2, '0')
export const localIso = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}` }

/** The event for an accepted booking, or null when the reply is not for one of my links. Local time; people = the booker if I know them. */
export function acceptBooking(state: Pick<AppState, 'bookLinks' | 'people'>, b: BookedPayload, id: string, now: number): TwEvent | null {
  if (!state.bookLinks?.some((l) => l.id === b.id)) return null
  const ev = newEvent({ name: S.cal.bookedEventName(b.from.name), from: localIso(b.slot.s), to: localIso(b.slot.e), where: '', ...(b.note ? { conditions: b.note } : {}) }, id, now)
  if (typeof ev === 'string') return null
  const person = b.from.did ? state.people.find((p) => p.did === b.from.did || p.peerId === b.from.did) : undefined
  return person ? { ...ev, people: [person.id] } : ev
}

/** Keeps (or replaces) a person's snapshot for my scheduling links; their did names the person if I know them. */
export function keepHeld(state: Pick<AppState, 'people' | 'heldAvailability'>, snap: AvailSnap, did: string | undefined, now: number): void {
  const personId = did ? state.people.find((p) => p.did === did || p.peerId === did)?.id : undefined
  const held: HeldAvail = { ...(personId ? { personId } : {}), name: snap.name, snap, at: now }
  state.heldAvailability = [...(state.heldAvailability ?? []).filter((h) => (personId ? h.personId !== personId : h.name !== snap.name)), held]
}
