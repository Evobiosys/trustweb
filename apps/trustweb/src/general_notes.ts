/**
 * The General note on a person's card (wave 6e, owner 2026-10-08 16:12: "under an advanced setting, be able to write some notes about them,
 * not just where I met them ... a general note section"). One optional plain-text field per person, Person.generalNote, at most
 * GENERAL_NOTE_MAX characters, saved as it is typed (debounced, and on blur).
 *
 * PRIVATE, ALWAYS "Only me": the field is never a source for asks, hops, the direct ask, the notes that answer asks, the search by others,
 * the inventory export, provenance, or any share or contact payload, and it never goes to a server in plaintext (the only copy that leaves
 * the phone is the end-to-end encrypted backup, backup.ts, which holds the whole record under the person's own key). cascade.ts
 * askSources strips it from its copy of the record; test/unit/general_notes.test.mjs scans the source for every place that names the field,
 * so a new reader of it cannot appear unnoticed. Not to be confused with PastMeeting.generalNotes (the field under "General notes" on Record).
 *
 * Pure and DOM-free: the clock, the timers and the store are injected.
 */
import { fold, queryWords } from './search'

/** What the field accepts (characters). */
export const GENERAL_NOTE_MAX = 4000
/** Typing pauses this long, then the note is saved. */
export const GENERAL_NOTE_DEBOUNCE_MS = 700

/** Control characters other than tab and newline, which never belong in a note. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** Cuts to `max` characters without splitting a surrogate pair (an emoji). */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const end = text.charCodeAt(max - 1)
  return text.slice(0, end >= 0xD800 && end <= 0xDBFF ? max - 1 : max)
}

/**
 * A note as it is stored: line breaks as \n, control characters removed, capped; text that is only white space reads as none ('').
 * What was typed is otherwise kept exactly (no trimming of a line being written).
 */
export function cleanGeneralNote(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const text = cut(raw.replace(/\r\n?/g, '\n').replace(CONTROL, ''), GENERAL_NOTE_MAX)
  return text.trim() === '' ? '' : text
}

export interface HasGeneralNote {
  generalNote?: string
}

/** The note on a person, or ''. */
export function generalNoteOf(person: HasGeneralNote): string {
  return cleanGeneralNote(person.generalNote)
}

/** Stores a typed note on a person (an empty one removes the field). True when the stored value changed. Idempotent. */
export function setGeneralNote(person: HasGeneralNote, raw: string): boolean {
  const next = cleanGeneralNote(raw)
  const before = person.generalNote ?? ''
  if (next === before) return false
  if (next) person.generalNote = next
  else delete person.generalNote
  return true
}

/** Boot repair: a stored note that is not a string is dropped, an over-long or unclean one is cut, an empty one removed. True when anything changed. Never throws. */
export function repairGeneralNotes(state: { people?: unknown }): boolean {
  if (!Array.isArray(state.people)) return false
  let changed = false
  for (const p of state.people) {
    if (typeof p !== 'object' || p === null || !('generalNote' in p)) continue
    const person = p as { generalNote?: unknown }
    const clean = cleanGeneralNote(person.generalNote)
    if (clean === person.generalNote) continue
    if (clean) person.generalNote = clean
    else delete person.generalNote
    changed = true
  }
  return changed
}

/** Does every word of the query appear in the note (case and accents ignored, as everywhere)? An empty query matches. */
export function generalNoteMatches(note: string, query: string): boolean {
  const words = queryWords(query)
  if (!words.length) return true
  const folded = fold(note)
  return words.every((w) => folded.includes(w))
}

// ---------------------------------------------------------------------------
// autosave
// ---------------------------------------------------------------------------

export interface AutosaveDeps {
  /** Writes the note (setGeneralNote + the store's save); called with the text typed last. */
  commit: (text: string) => void
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface Autosaver {
  /** The text changed: save after the pause. */
  input(text: string): void
  /** Save now if something is waiting (blur, the card closing, the page hidden). Safe to call at any time. */
  flush(): void
  /** True while a save is waiting. */
  pending(): boolean
}

export function createAutosaver(d: AutosaveDeps): Autosaver {
  const setTimer = d.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms))
  const clearTimer = d.clearTimer ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>))
  let handle: unknown = null
  let waiting: string | null = null

  const run = (): void => {
    handle = null
    if (waiting === null) return
    const text = waiting
    waiting = null
    d.commit(text)
  }

  return {
    input(text: string): void {
      waiting = text
      if (handle !== null) clearTimer(handle)
      handle = setTimer(run, d.delayMs ?? GENERAL_NOTE_DEBOUNCE_MS)
    },
    flush(): void {
      if (handle !== null) { clearTimer(handle); handle = null }
      run()
    },
    pending: (): boolean => waiting !== null,
  }
}
