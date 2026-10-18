/**
 * The notes Jakob took on one person, by day (wave 6, U4 c; his 08:23 message: "i would like to be able to see the notes that i have
 * taken on other people"): every note line on the person's card (also the ones no longer true) and every past meeting about them
 * (stored ones and the entries pastMeetings() derives from older notes), grouped per day, newest first, and searchable with the same
 * words rule as the past-meetings search (search.ts: every word of the query must appear, case and accents ignored).
 * Pure and DOM-free; past_meetings_view.ts draws it.
 */
import { LineStatus, ServerJobState, pastMeetings } from './model'
import type { AppState, NoteLine, PastMeeting } from './model'
import { fold, queryWords, searchMeetings } from './search'
import { lineShown } from './sources'

const DAY_MS = 86_400_000

/** One day of notes on a person. */
export interface PersonNoteDay {
  /** Start of the day (UTC, as pastMeetings() groups), ms. */
  day: number
  meetings: PastMeeting[]
  lines: NoteLine[]
}

/** The day a moment belongs to. */
export function dayOf(at: number): number {
  return Math.floor(at / DAY_MS) * DAY_MS
}

/** The past meetings about this person: the ones that name them, newest first. */
export function meetingsAbout(s: Pick<AppState, 'meetings' | 'people'>, personId: string): PastMeeting[] {
  return pastMeetings(s).filter((m) => m.personId === personId)
}

/** Does every word of the query appear in the text (folded)? An empty query matches everything. */
function matchesWords(text: string, words: readonly string[]): boolean {
  const folded = fold(text)
  return words.every((w) => folded.includes(w))
}

/**
 * The days of notes on the person, newest first; with a query only the lines and meetings that hold all its words.
 * `dateLabels` gives the dates a meeting answers to (as in the past-meetings search), so "October" finds a day.
 */
export function personNotes(s: AppState, personId: string, query: string, dateLabels: (m: PastMeeting) => readonly string[]): PersonNoteDay[] {
  const person = s.people.find((p) => p.id === personId)
  if (!person) return []
  const words = queryWords(query)
  const all = meetingsAbout(s, personId)
  const meetings = words.length ? searchMeetings(all, query, dateLabels).map((r) => r.meeting) : all
  const lines = person.lines.filter((l) => lineShown(s, l, person) && (!words.length || matchesWords(`${l.text} ${l.tag}`, words)))
  const days = new Map<number, PersonNoteDay>()
  const entry = (at: number): PersonNoteDay => {
    const day = dayOf(at)
    let d = days.get(day)
    if (!d) { d = { day, meetings: [], lines: [] }; days.set(day, d) }
    return d
  }
  for (const m of meetings) entry(m.startedAt).meetings.push(m)
  for (const l of lines) entry(l.notedAt).lines.push(l)
  return [...days.values()].sort((a, b) => b.day - a.day)
}

/** Is the transcript of this meeting still on its way (the server is transcribing it, or the sender's full version has not arrived)? */
export function transcriptPending(m: Pick<PastMeeting, 'serverJob' | 'late'>): boolean {
  return m.serverJob?.state === ServerJobState.Running || m.late !== undefined
}

/** How many past meetings about this person have a transcript still on its way (for "transcribing" next to the typed note). */
export function pendingTranscripts(s: Pick<AppState, 'meetings' | 'people'>, personId: string): number {
  return meetingsAbout(s, personId).filter(transcriptPending).length
}

/** Is this line still true? (LineStatus.Gone: the person said it no longer is; kept so nothing noted is lost.) */
export function lineIsCurrent(l: Pick<NoteLine, 'status'>): boolean {
  return l.status === LineStatus.Current
}

/** The longest note line (as the Advanced "add" field and the inventory import cap it). */
export const LINE_TEXT_MAX = 160

/** Edits the text of one of the person's lines in place (keeps id, tag, audience, status, source, notedAt; checkedAt = now). False: unknown line or empty text. */
export function editLineText(s: Pick<AppState, 'people'>, personId: string, lineId: string, text: string, now = Date.now()): boolean {
  const line = s.people.find((p) => p.id === personId)?.lines.find((l) => l.id === lineId)
  const t = text.trim().slice(0, LINE_TEXT_MAX)
  if (!line || !t) return false
  line.text = t
  line.checkedAt = now
  return true
}

/** Removes one line of the person. False: unknown line. */
export function removeLine(s: Pick<AppState, 'people'>, personId: string, lineId: string): boolean {
  const person = s.people.find((p) => p.id === personId)
  const i = person ? person.lines.findIndex((l) => l.id === lineId) : -1
  if (!person || i < 0) return false
  person.lines.splice(i, 1)
  return true
}
