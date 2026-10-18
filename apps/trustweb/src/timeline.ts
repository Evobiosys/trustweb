/**
 * The timeline on a person's card (wave 7, owner 2026-10-14: "a timeline of communicating with them with a symbol like email and
 * signal, which can be later imported ... a unified view of what was shared with a person"). Person.timeline holds the entries typed
 * or imported; TrustWeb's own events on the person (met, connected, asked my web, notes, kept recordings) are derived on the fly and
 * read-only. ONLY ME: kept on this phone (and in the encrypted backup), never matched, relayed, shared or put in an answer
 * (cascade.ts askSources strips it from its copy of the record).
 *
 * IMPORT SHAPE (what a later Signal / email / WhatsApp importer has to emit): one JSON file, either an array of entries or
 * `{ "entries": [...] }`, each entry
 *   { "at": 1760000000000,        epoch milliseconds
 *     "channel": "email",         email | signal | whatsapp | matrix | call | in_person | trustweb | note
 *     "direction": "in",          in | out | both
 *     "summary": "Re: the garden", one line, cut at SUMMARY_MAX
 *     "ref": "msg-123" }          optional: message id or file name, cut at REF_MAX
 * `source` is always set to "import" here whatever the file says. A broken entry is skipped and counted; an entry equal in time,
 * channel, direction and summary to one already there is skipped as a duplicate (so importing a file twice adds nothing).
 *
 * Pure and DOM-free; never throws on bad input.
 */
import type { AppState, Person } from './model'
import { stripUnsafe } from './safe_text'
import { MAX_TIME } from './agreements'
import { S } from './strings'

export enum TlChannel {
  Email = 'email',
  Signal = 'signal',
  WhatsApp = 'whatsapp',
  Matrix = 'matrix',
  Call = 'call',
  InPerson = 'in_person',
  TrustWeb = 'trustweb',
  Note = 'note',
}
export const TL_CHANNELS: readonly TlChannel[] = Object.values(TlChannel)

export enum TlDirection {
  In = 'in',
  Out = 'out',
  Both = 'both',
}

export enum TlSource {
  Manual = 'manual',
  Import = 'import',
  TrustWeb = 'trustweb',
}

export interface TimelineEntry {
  at: number
  channel: TlChannel
  direction: TlDirection
  summary: string
  ref?: string
  source: TlSource
}

export const SUMMARY_MAX = 200
export const REF_MAX = 200
/** Entries kept on one person; further ones are refused (the record is saved whole on every change). */
export const TIMELINE_MAX = 5000
/** The biggest import file read (bytes). */
export const IMPORT_MAX_BYTES = 2_000_000

const oneOf = <T extends string>(all: readonly T[], v: unknown): T | undefined => all.find((a) => a === v)
const line = (v: unknown, max: number): string => (typeof v === 'string' ? [...stripUnsafe(v).replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '')

/** One entry as it is stored, or null when it is unusable (no time, unknown channel or direction, empty summary). */
export function cleanEntry(raw: unknown, source: TlSource): TimelineEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const channel = oneOf(TL_CHANNELS, r.channel)
  const direction = oneOf(Object.values(TlDirection), r.direction)
  const summary = line(r.summary, SUMMARY_MAX)
  if (!channel || !direction || !summary || typeof r.at !== 'number' || !Number.isFinite(r.at) || r.at <= 0 || r.at > MAX_TIME) return null
  const ref = line(r.ref, REF_MAX)
  return { at: Math.round(r.at), channel, direction, summary, ...(ref ? { ref } : {}), source }
}

export const keyOf = (e: TimelineEntry): string => `${e.at}|${e.channel}|${e.direction}|${e.summary}`

/** Adds entries to the person (newest first order is made when drawing); returns how many went in. Duplicates and overflow are skipped. */
export function addEntries(p: Person, entries: readonly TimelineEntry[]): number {
  const list = p.timeline ?? []
  const seen = new Set(list.map(keyOf))
  let added = 0
  for (const e of entries) {
    if (list.length >= TIMELINE_MAX || seen.has(keyOf(e))) continue
    seen.add(keyOf(e))
    list.push(e)
    added++
  }
  if (added) p.timeline = list
  return added
}

export interface ImportResult {
  entries: TimelineEntry[]
  skipped: number
  /** The file was not JSON, or held neither an array nor `entries`. */
  unreadable: boolean
}

/** Reads an import file's text (see the shape above). */
export function parseTimelineImport(text: string): ImportResult {
  let data: unknown
  try { data = JSON.parse(text) } catch { return { entries: [], skipped: 0, unreadable: true } }
  const list = Array.isArray(data) ? data : (data as { entries?: unknown } | null)?.entries
  if (!Array.isArray(list)) return { entries: [], skipped: 0, unreadable: true }
  const entries = list.map((r) => cleanEntry(r, TlSource.Import)).filter((e): e is TimelineEntry => e !== null)
  return { entries, skipped: list.length - entries.length, unreadable: false }
}

/** TrustWeb's own events on this person, read-only: met, connected, asked my web, notes, recordings kept on the server. */
export function ownEvents(s: AppState, p: Person): TimelineEntry[] {
  const mk = (at: number, channel: TlChannel, direction: TlDirection, summary: string): TimelineEntry => ({ at, channel, direction, summary: line(summary, SUMMARY_MAX), source: TlSource.TrustWeb })
  const out: TimelineEntry[] = []
  if (p.metAt > 0) out.push(mk(p.metAt, TlChannel.InPerson, TlDirection.Both, S.tlMet(p.context)))
  const peer = p.peerId ? s.peers.find((x) => x.id === p.peerId) : undefined
  if (peer) out.push(mk(peer.connectedAt, TlChannel.TrustWeb, TlDirection.Both, S.tlConnected))
  if (peer) for (const l of s.log) if (l.peerId === peer.id && !l.away) out.push(mk(l.at, TlChannel.TrustWeb, TlDirection.In, S.tlAsked(l.text)))
  for (const l of p.lines) out.push(mk(l.notedAt, TlChannel.Note, TlDirection.Both, l.text))
  const mine = new Set((s.meetings ?? []).filter((m) => m.personId === p.id).map((m) => m.id))
  for (const r of s.hosting?.recs ?? []) if (mine.has(r.meetingId) && !r.pending) out.push(mk(r.at, TlChannel.TrustWeb, TlDirection.Out, S.tlRecording(Math.round(r.seconds / 60))))
  return out.filter((e) => e.at > 0)
}

/** Everything on one person, newest first. */
export function timelineOf(s: AppState, p: Person): TimelineEntry[] {
  return [...(p.timeline ?? []), ...ownEvents(s, p)].sort((a, b) => b.at - a.at)
}

/** Entries grouped by local calendar day, newest day first (input already newest first). */
export function byDay(entries: readonly TimelineEntry[]): { day: number; entries: TimelineEntry[] }[] {
  const days: { day: number; entries: TimelineEntry[] }[] = []
  for (const e of entries) {
    const d = new Date(e.at)
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const last = days[days.length - 1]
    if (last && last.day === day) last.entries.push(e)
    else days.push({ day, entries: [e] })
  }
  return days
}
