/**
 * SenseMeet logic for TrustWeb's Meeting view: pure functions, no DOM, no
 * network. Grounded only in what the SenseMeet page says (sensemeet/index.html,
 * "drafted from the founder's working notes", a concept, not a product).
 * Nothing here invents a feature the page does not describe; every helper
 * quotes the line it rests on.
 *
 * The page names TrustWeb as "the first working piece of SenseMeet's own
 * capture step": "meeting someone, jotting what's worth remembering, and
 * deciding who can later ask about it". These helpers turn a transcribed
 * meeting into that capture step's inputs.
 */
import type { Segment } from './meeting_transcriber_core'

export interface MeetingMeta {
  who: string
  where: string
  startedAt: number
}

/** Optional wording, so strings.ts can localise what the text export says. */
export interface MeetingTextLabels {
  speaker?: (n: number) => string
  header?: (meta: MeetingMeta, date: string) => string
}

/** One clock reading, "mm:ss", or "h:mm:ss" from one hour on. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const two = (n: number): string => (n < 10 ? '0' + n : String(n))
  return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`
}

function formatDate(ms: number): string {
  const d = new Date(ms)
  const two = (n: number): string => (n < 10 ? '0' + n : String(n))
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/**
 * What the meeting says, once: the latest version of each id, finished
 * utterances only, empty ones dropped, in the order they were spoken.
 * A segment still marked live is not part of the record yet.
 */
export function settledSegments(segs: readonly Segment[]): Segment[] {
  const latest = new Map<string, { seg: Segment; order: number }>()
  segs.forEach((seg, order) => { latest.set(seg.id, { seg, order }) })
  return Array.from(latest.values())
    .filter((e) => e.seg.final && e.seg.text.trim() !== '')
    .sort((a, b) => a.seg.atMs - b.seg.atMs || a.order - b.order)
    .map((e) => e.seg)
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function defaultHeader(meta: MeetingMeta, date: string): string {
  const who = meta.who.trim()
  const where = meta.where.trim()
  return 'Meeting' + (who ? ` with ${who}` : '') + (where ? ` at ${where}` : '') + ` on ${date}`
}

/**
 * The "Send as is" text: a header line, then "Speaker n (mm:ss): text" lines.
 * Plain and shareable. Page: "meetings recorded this way are meant to be
 * shareable inside a shared space". This is the raw record: it is the said
 * text exactly as transcribed, with no summary added.
 */
export function meetingToText(meta: MeetingMeta, segs: readonly Segment[], labels: MeetingTextLabels = {}): string {
  const speaker = labels.speaker ?? ((n: number): string => `Speaker ${n}`)
  const header = (labels.header ?? defaultHeader)(meta, formatDate(meta.startedAt))
  const lines = settledSegments(segs).map((s) => `${speaker(s.speaker)} (${formatClock(s.atMs)}): ${oneLine(s.text)}`)
  return [header, ...lines].join('\n')
}

/**
 * Prose for TrustWeb's notes extractor (notes.ts extractLines): one
 * sentence per utterance, no speaker or clock fragments, so each utterance
 * lands in the Review step as its own line. Page: the note-capture step is
 * "meeting someone, jotting what's worth remembering".
 */
export function meetingToNoteText(segs: readonly Segment[]): string {
  return settledSegments(segs)
    .map((s) => oneLine(s.text))
    .map((t) => (/[.!?]$/.test(t) ? t : t + '.'))
    .join('\n')
}

// ------------------------------------------------------- two layers of memory

/**
 * A comment on one utterance. Page: "an immutable layer, what was actually
 * said or recorded, kept as the record of truth, and a lighter, editable
 * layer on top for clarifications, corrections, and comments. If something
 * needs correcting, it happens as a comment that can be flagged as the
 * clarified version, without erasing what was originally recorded."
 */
export interface MeetingComment {
  segmentId: string
  text: string
  /** Flagged as the clarified version of the utterance. */
  clarified: boolean
  at: number
}

export interface LayeredUtterance {
  /** The immutable layer: exactly what was transcribed. */
  readonly said: Segment
  /** The editable layer: comments in the order they were written. */
  readonly comments: readonly MeetingComment[]
  /** The newest comment flagged as the clarified version, if any. */
  readonly clarified: MeetingComment | null
}

/**
 * Lays the editable layer over the record. The utterance text is never
 * touched: a correction shows up as `clarified`, beside what was said.
 * Comments pointing at an utterance that is not in the record are returned
 * nowhere (they have nothing to be about).
 */
export function layerComments(segs: readonly Segment[], comments: readonly MeetingComment[]): LayeredUtterance[] {
  return settledSegments(segs).map((said) => {
    const mine = comments.filter((c) => c.segmentId === said.id).slice().sort((a, b) => a.at - b.at)
    const flagged = mine.filter((c) => c.clarified)
    return { said, comments: mine, clarified: flagged.length > 0 ? flagged[flagged.length - 1] : null }
  })
}
