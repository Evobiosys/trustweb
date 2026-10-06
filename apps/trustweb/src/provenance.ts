/**
 * The chain of proof (wave 1733, item 4a; owner 2026-10-06 16:08): every
 * inventory item and every note keeps WHERE it came from (model.ts
 * ItemSource): recorded by yourself or in a meeting (with the meeting and the
 * moment in the recording), typed, from Tana, shared by a person, or demo
 * content. An item noted in a recording links to that past meeting, opened at
 * exactly that line (main.ts pastMeetingSheet) and, where the audio was kept,
 * played from that moment (audio_store.ts / player).
 *
 * A moment exists while recording: a line added by hand during a take is
 * stamped with the take's current offset; a line picked from the transcript
 * carries that transcript line's offset and index.
 *
 * Everything here stays on the phone: the matcher, answers, Meet codes and
 * meetings sent inside TrustWeb never read a source (see model.ts sharedItems).
 * Pure and DOM-free.
 */
import type { AppState, InventoryItem, ItemSource, PastMeeting, Person, Tag, TranscriptLine } from './model'
import { Provenance, PROVENANCES } from './model'
import type { Segment } from './meeting_transcriber'
import { extractLines } from './notes'
import { meetingToNoteText, settledSegments } from './sensemeet'

/** A note line picked out of a transcript, with where in the recording it was said. */
export interface MomentLine {
  text: string
  tag: Tag
  atMs: number
  /** Index of the transcript line (into the segments as stored with the meeting). */
  line: number
}

/**
 * Picks note lines out of a transcript, one utterance at a time, so each line
 * keeps its utterance's offset and index. The same lines as picking them from
 * the joined transcript (meetingToNoteText ends every utterance with a full
 * stop and a line break, so a picked line never spans two utterances).
 */
export function linesFromTranscript(segments: readonly Segment[]): MomentLine[] {
  return settledSegments(segments).flatMap((seg) => {
    const line = segments.indexOf(seg)
    return extractLines(meetingToNoteText([seg])).map((l) => ({ ...l, atMs: seg.atMs, line }))
  })
}

/** What a draft line carries into its saved item: the meeting it belongs to and its moment. */
export interface DraftMoment {
  atMs?: number
  line?: number
}

/** The source of a line saved from Record: recorded solo or in a meeting, with the meeting and the moment when known. */
export function recordedSource(meeting: boolean, meetingId: string | undefined, moment: DraftMoment): ItemSource {
  return {
    kind: meeting ? Provenance.RecordedMeeting : Provenance.RecordedSolo,
    ...(meetingId ? { meetingId } : {}),
    ...(moment.atMs === undefined ? {} : { atMs: Math.max(0, Math.round(moment.atMs)) }),
    ...(moment.line === undefined ? {} : { line: moment.line }),
  }
}

export function typedSource(): ItemSource {
  return { kind: Provenance.Typed }
}

export function sharedSource(fromName: string): ItemSource {
  return { kind: Provenance.SharedByPerson, fromName }
}

export function demoSource(): ItemSource {
  return { kind: Provenance.Demo }
}

/** Marks seeded people's notes and seeded things as demo content (a demo phone, "Show demo content"). */
export function markDemo(people: readonly Person[], inventory: readonly InventoryItem[]): void {
  for (const p of people) for (const l of p.lines) l.source ??= demoSource()
  for (const i of inventory) i.source ??= demoSource()
}

function isSource(v: unknown): v is ItemSource {
  return typeof v === 'object' && v !== null && PROVENANCES.includes((v as ItemSource).kind)
}

/** A stored meeting whose notes hold this text (for notes saved before provenance existed). */
function meetingWithLine(meetings: readonly PastMeeting[], text: string, personId?: string): PastMeeting | undefined {
  return meetings.find((m) => (personId === undefined || m.personId === personId) && m.lines.some((l) => l.text === text || `${m.about}: ${l.text}` === text))
}

function migratedSource(text: string, demo: boolean, meetings: readonly PastMeeting[], personId?: string): ItemSource {
  if (demo) return demoSource()
  const m = meetingWithLine(meetings, text, personId)
  if (!m) return typedSource()
  // A meeting another phone sent (a kept pack): its notes were shared by that person, not recorded here.
  if (m.fromName) return { ...sharedSource(m.fromName), meetingId: m.id }
  const l = m.lines.find((x) => x.text === text || `${m.about}: ${x.text}` === text)
  return recordedSource(m.meeting, m.id, { atMs: l?.atMs, line: l?.line })
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Only what is shaped as this build reads it takes part; anything odd is left exactly as it is. */
function wellFormedMeetings(s: AppState): PastMeeting[] {
  return Array.isArray(s.meetings) ? s.meetings.filter((m) => isObject(m) && Array.isArray(m.lines) && m.lines.every(isObject)) : []
}

/**
 * Gives every item and note without a (valid) source one, once: demo content
 * "demo"; a note or item found among a stored meeting's notes "recorded" with
 * that meeting (or "shared by" where another phone sent that meeting);
 * everything else "typed". Never touches a source that is there, so running it
 * again changes nothing; skips (never repairs or drops) anything not shaped as
 * expected, so a record from an older or odd build cannot make it throw.
 * Returns whether anything changed.
 */
export function migrateSources(s: AppState): boolean {
  let changed = false
  const meetings = wellFormedMeetings(s)
  const demo = (ids: unknown, id: string): boolean => Array.isArray(ids) && ids.includes(id)
  for (const item of Array.isArray(s.inventory) ? s.inventory : []) {
    if (!isObject(item) || typeof item.text !== 'string' || isSource(item.source)) continue
    item.source = migratedSource(item.text, demo(s.demo?.inventory, item.id), meetings)
    changed = true
  }
  for (const p of Array.isArray(s.people) ? s.people : []) {
    if (!isObject(p) || !Array.isArray(p.lines)) continue
    for (const l of p.lines) {
      if (!isObject(l) || typeof l.text !== 'string' || isSource(l.source)) continue
      l.source = migratedSource(l.text, demo(s.demo?.people, p.id), meetings, p.id)
      changed = true
    }
  }
  return changed
}

/** Where to open a past meeting for a source: the transcript line, else the line said at that moment, else the note. */
export interface SourceFocus {
  field: 'note' | 'transcript'
  index: number
}

/** The last transcript line said at or before `atMs` (the first one when it is earlier than all). */
export function transcriptIndexAt(transcript: readonly TranscriptLine[], atMs: number): number {
  let best = -1
  transcript.forEach((t, i) => { if (t.atMs <= atMs && (best < 0 || t.atMs >= transcript[best].atMs)) best = i })
  return best < 0 ? (transcript.length ? 0 : -1) : best
}

export function focusFor(m: PastMeeting, source: ItemSource, itemText: string): SourceFocus | null {
  if (source.line !== undefined && source.line >= 0 && source.line < m.transcript.length) return { field: 'transcript', index: source.line }
  if (source.atMs !== undefined && m.transcript.length) return { field: 'transcript', index: transcriptIndexAt(m.transcript, source.atMs) }
  const note = m.lines.findIndex((l) => l.text === itemText || `${m.about}: ${l.text}` === itemText)
  return note >= 0 ? { field: 'note', index: note } : null
}
