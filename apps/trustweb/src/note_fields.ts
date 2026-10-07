/**
 * The optional fields of wave 5 that live in the stored record, and the rules around them. Pure; no DOM.
 *   PastMeeting.generalNotes   what was typed under "General notes" on Record (capped, as typed)
 *   PastMeeting.plain          a note about neither a person nor a thing ("none of these"): kept as a past meeting only
 *   InventoryItem.context      notes added to an existing thing, oldest first, deduplicated, capped
 * Records stay v:1 and every field is optional: an older build ignores them and keeps them on its own saves (the record is
 * round-tripped whole), a record without them reads as before. normaliseNoteFields never throws and never repairs what it
 * does not understand into something else: a wrong type is dropped, a valid field is left exactly as it is.
 */
import { Audience } from './model'
import type { AppState, InventoryContext, InventoryItem, PastMeeting } from './model'

/** What the General notes field accepts (characters). */
export const GENERAL_NOTES_MAX = 2000
/** Context notes kept per thing: the newest ones; adding past this drops the oldest. */
export const CONTEXT_MAX = 20
/** One context note (characters). */
export const CONTEXT_TEXT_MAX = 400

/** The comparison form of a note: lower case, runs of whitespace collapsed, trimmed. */
export function noteKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * May this draft line travel in a meeting pack (Send meeting, the Meet code after a recording)? Not the General notes line while it
 * is "Only me": the Meet code uploads its pack on its own and its summary names the transcript notes only, so private free text
 * would leave unseen (review-wave5). Once widened on the Review screen it travels like every other note line.
 */
export function travelsInPack(line: { typed?: boolean; audience: Audience }): boolean {
  return !(line.typed === true && line.audience === Audience.OnlyMe)
}

/** A General notes value as stored: trimmed and capped; empty reads as none. */
export function cleanGeneralNotes(v: unknown): string {
  return typeof v === 'string' ? v.trim().slice(0, GENERAL_NOTES_MAX) : ''
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function isContext(v: unknown): v is InventoryContext {
  return isObject(v) && typeof v.text === 'string' && v.text.trim().length > 0 && typeof v.at === 'number' && Number.isFinite(v.at)
    && (v.meetingId === undefined || typeof v.meetingId === 'string')
}

/** The item's context notes, safely: only well-formed entries, whatever the record holds. */
export function contextOf(item: Pick<InventoryItem, 'context'>): readonly InventoryContext[] {
  return Array.isArray(item.context) ? item.context.filter(isContext) : []
}

/**
 * Adds `text` as context to the item: skipped when it is empty, the same note (by noteKey) is already there, or it is the
 * item's own text. Oldest first; past CONTEXT_MAX the oldest go. Returns whether anything was added.
 */
export function appendContext(item: InventoryItem, text: string, at: number, meetingId?: string): boolean {
  const clean = text.trim().slice(0, CONTEXT_TEXT_MAX)
  if (!clean) return false
  const key = noteKey(clean)
  const have = contextOf(item)
  if (key === noteKey(item.text) || have.some((c) => noteKey(c.text) === key)) return false
  const next = [...have, { text: clean, at, ...(meetingId ? { meetingId } : {}) }]
  item.context = next.slice(-CONTEXT_MAX)
  return true
}

/** Adds each text as context (appendContext); returns how many were new. */
export function addContextLines(item: InventoryItem, texts: readonly string[], at: number, meetingId?: string): number {
  let added = 0
  for (const t of texts) if (appendContext(item, t, at, meetingId)) added++
  return added
}

/**
 * Makes the new optional fields of a loaded record safe to read (store load, restore from backup and a demo carry-over all
 * pass through the boot path that calls this). A field of the wrong type is dropped; a context list is cleaned to
 * well-formed entries, deduplicated and capped; a General notes value is capped. Idempotent. Returns whether anything changed.
 */
export function normaliseNoteFields(s: AppState): boolean {
  let changed = false
  for (const m of (Array.isArray(s.meetings) ? s.meetings : []) as PastMeeting[]) {
    if (!isObject(m)) continue
    if (m.generalNotes !== undefined) {
      const clean = cleanGeneralNotes(m.generalNotes)
      if (clean === '') { delete m.generalNotes; changed = true } else if (clean !== m.generalNotes) { m.generalNotes = clean; changed = true }
    }
    if (m.plain !== undefined && m.plain !== true) { delete m.plain; changed = true }
  }
  for (const item of (Array.isArray(s.inventory) ? s.inventory : []) as InventoryItem[]) {
    if (!isObject(item) || item.context === undefined) continue
    const seen = new Set<string>()
    const clean: InventoryContext[] = []
    for (const c of Array.isArray(item.context) ? item.context : []) {
      if (!isContext(c)) continue
      const text = c.text.trim().slice(0, CONTEXT_TEXT_MAX)
      const key = noteKey(text)
      if (seen.has(key)) continue
      seen.add(key)
      clean.push({ text, at: c.at, ...(typeof c.meetingId === 'string' ? { meetingId: c.meetingId } : {}) })
    }
    const kept = clean.slice(-CONTEXT_MAX)
    if (JSON.stringify(kept) !== JSON.stringify(item.context)) {
      if (kept.length) item.context = kept; else delete item.context
      changed = true
    }
  }
  return changed
}
