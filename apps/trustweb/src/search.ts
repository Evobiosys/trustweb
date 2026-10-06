/**
 * Searching past meetings and recordings (wave 1733, item 2): the person,
 * the place, the date, the notes and the transcript text of everything Past
 * meetings lists, including the older notes it lists by person and day.
 *
 * Every word of the query must appear somewhere in a meeting for it to count
 * (so "Max Prückel" finds the meeting with Max at Café Prückel); each place a
 * word appears is a hit, shown as that line with some context around it.
 * Case and accents are ignored ("pruckel" finds "Prückel"). Pure and DOM-free,
 * so the matching is unit-tested exactly as the app runs it.
 */
import type { PastMeeting } from './model'

/** Where in a meeting a word was found. */
export enum SearchField {
  About = 'about',
  Where = 'where',
  When = 'when',
  Note = 'note',
  Transcript = 'transcript',
}

export interface SearchHit {
  field: SearchField
  /** The note's or transcript line's index; -1 for about, where and when. */
  index: number
  /** The line cut around the match: text before, the match itself, text after (with "..." where cut). */
  before: string
  match: string
  after: string
  /** Transcript hits: the line's offset in the recording. */
  atMs?: number
}

export interface MeetingResult {
  meeting: PastMeeting
  hits: SearchHit[]
}

/** How much of a long line shows on each side of the match. */
const CONTEXT_CHARS = 48
/** At most this many hits per meeting (the meeting itself opens to show the rest). */
const MAX_HITS = 5

/**
 * Folds one character for matching: lower case, accents dropped. One
 * character in, one character out (a character that would fold into more
 * stays as it is), so a position in the folded text is a position in the
 * original: that is what lets a hit show the original words.
 */
function foldChar(c: string): string {
  const f = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return Array.from(f).length === 1 ? f : c
}

export function fold(text: string): string {
  return Array.from(text, foldChar).join('')
}

/** The query's words, folded; empty when there is nothing to search for. */
export function queryWords(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean)
}

/** Where `needle` first starts in `hay`, both as characters (not UTF-16 units); -1 if nowhere. */
function indexOfChars(hay: readonly string[], needle: readonly string[]): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/** One hit: the original text cut around the earliest word found in it, or null. */
function hitIn(text: string, words: readonly string[], field: SearchField, index: number, atMs?: number): SearchHit | null {
  const chars = Array.from(text)
  const folded = chars.map(foldChar)
  let at = -1
  let len = 0
  for (const w of words) {
    const wc = Array.from(w)
    const i = indexOfChars(folded, wc)
    if (i >= 0 && (at < 0 || i < at)) { at = i; len = wc.length }
  }
  if (at < 0) return null
  const from = Math.max(0, at - CONTEXT_CHARS)
  const to = Math.min(chars.length, at + len + CONTEXT_CHARS)
  return {
    field, index,
    before: (from > 0 ? '...' : '') + chars.slice(from, at).join(''),
    match: chars.slice(at, at + len).join(''),
    after: chars.slice(at + len, to).join('') + (to < chars.length ? '...' : ''),
    ...(atMs === undefined ? {} : { atMs }),
  }
}

/** Every text of a meeting that can be searched, with where it sits. */
function fields(m: PastMeeting, dateLabels: readonly string[]): { field: SearchField; index: number; text: string; atMs?: number }[] {
  return [
    { field: SearchField.About, index: -1, text: m.about },
    { field: SearchField.Where, index: -1, text: m.where },
    ...dateLabels.map((text) => ({ field: SearchField.When, index: -1, text })),
    ...m.lines.map((l, i) => ({ field: SearchField.Note, index: i, text: l.text })),
    ...m.transcript.map((t, i) => ({ field: SearchField.Transcript, index: i, text: t.text, atMs: t.atMs })),
  ]
}

/**
 * Past meetings matching every word of the query, in the order given (newest
 * first, as pastMeetings() lists them), each with up to MAX_HITS hits. An
 * empty query finds nothing. `dateLabels` gives the dates a meeting answers to
 * (as shown on this phone, plus a locale-free form), so "October" or "2026-10-06" finds it.
 */
export function searchMeetings(meetings: readonly PastMeeting[], query: string, dateLabels: (m: PastMeeting) => readonly string[]): MeetingResult[] {
  const words = queryWords(query)
  if (!words.length) return []
  const out: MeetingResult[] = []
  for (const m of meetings) {
    const all = fields(m, dateLabels(m))
    const haystack = all.map((f) => fold(f.text)).join('\n')
    if (!words.every((w) => haystack.includes(w))) continue
    const hits: SearchHit[] = []
    let whenHit = false
    for (const f of all) {
      if (f.field === SearchField.When && whenHit) continue
      const h = hitIn(f.text, words, f.field, f.index, f.atMs)
      if (!h) continue
      if (f.field === SearchField.When) whenHit = true
      hits.push(h)
      if (hits.length >= MAX_HITS) break
    }
    out.push({ meeting: m, hits })
  }
  return out
}

/** Locale-free date words for a meeting: "2026-10-06", "6 October 2026", "October", "Monday". */
export function isoDateLabels(at: number): string[] {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return []
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const pad = (n: number): string => String(n).padStart(2, '0')
  return [`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`, days[d.getDay()]]
}
