/**
 * Notes as a source for asks that arrive through me (wave 6, U4 b; Jakob 2026-10-08 08:23: "all my notes should be
 * queriable"). The matcher already reads what sits on the inventory and on the people's cards; this adds the notes of
 * my stored meetings that have no card line of their own, so nothing I noted stays out of reach of an ask.
 *
 * The rules, one by one (each is a unit test):
 *   - a hit goes in front of ME for a yes or no, like any line; nothing here answers by itself, and the answer carries the
 *     line (text, coarse date, a context that names no person and no place), never the whole note or the meeting;
 *   - a meeting line answers only with the audience it was saved with (PastMeeting.lines[].audience); "Only me" never
 *     does, and a line from before audiences were stored (none recorded) does not either: fail closed;
 *   - a meeting line that is also a line on somebody's card (same words) is left to that card line: its audience governs,
 *     so changing or retiring the card line also silences this copy;
 *   - like the notes on people they answer at step 0 only (degrees 0, cascade.ts): a note about a third person never
 *     travels on through me by default;
 *   - the typed "General notes" text reaches an ask only as the note line it became on the Review screen (an Only me line
 *     until widened); the raw text of a meeting (PastMeeting.generalNotes) and its transcript are never matched;
 *   - a demo account's ask is scoped to the demo content (model.ts demoAccountScope), so no meeting note joins it;
 *   - a meeting another phone sent me (fromName) is never a source: those are their notes, not mine;
 *   - Settings > Advanced "Let asks match my notes too": on for a personal account (also one that shows demo content), off for a demo
 *     account's own phone and for the side-by-side demo phones.
 * Pure and DOM-free.
 */
import type { ChatThread } from '../../demo/src/types'
import { audienceAdmits, lineThread } from './model'
import type { AppState, LineRef, MatchScope, Ring } from './model'
import { noteKey } from './note_fields'

/** What an asker reads under a shared meeting note: no name, no place, no date finer than the month. */
export const MEETING_NOTE_CONTEXT = 'A note I took in a meeting'

/** The thread id prefix of a meeting note ("meet:<meeting id>:<line index>"); model.ts threadIsDemo reads it as not demo. */
export const MEETING_THREAD_PREFIX = 'meet:'

/**
 * The default of "Let asks match my notes too": on for a personal account, off for a demo account's own phone. A personal phone that also shows
 * demo content stays ON: its demo-account askers are scoped to the demo content anyway (no meeting note joins a scoped ask), and the
 * side-by-side demo phones are stored OFF at boot.
 */
export function notesMatchDefault(s: Pick<AppState, 'testOf'>): boolean {
  return !s.testOf
}

/** Is the notes source on for this record? What the person chose wins; absent reads as the default. */
export function asksMatchNotes(s: Pick<AppState, 'asksMatchNotes' | 'testOf'>): boolean {
  return typeof s.asksMatchNotes === 'boolean' ? s.asksMatchNotes : notesMatchDefault(s)
}

/** The words of every line on a card or on a thing (any status): a meeting copy of one is left to it. */
function cardKeys(s: AppState): Set<string> {
  const keys = new Set<string>()
  for (const p of s.people) for (const l of p.lines) keys.add(noteKey(l.text))
  for (const item of s.inventory) {
    keys.add(noteKey(item.text))
    for (const c of item.context ?? []) keys.add(noteKey(c.text))
  }
  return keys
}

/**
 * The meeting notes this ask may read, as matcher input: only when the source is on, the ask is not scoped to demo
 * content, it arrived at step 0 (degrees 0), and the note was saved with an audience that admits `ring`. Empty otherwise.
 */
export function meetingNoteThreads(s: AppState, ring: Ring, hop: number, scope?: MatchScope): { threads: ChatThread[]; refs: Map<string, LineRef> } {
  const out = { threads: [] as ChatThread[], refs: new Map<string, LineRef>() }
  if (hop > 0 || scope || !asksMatchNotes(s) || !Array.isArray(s.meetings)) return out
  const onCards = cardKeys(s)
  const seen = new Set<string>()
  for (const m of s.meetings) {
    // A meeting somebody else sent me (kept from a share) holds THEIR notes, never mine to answer with.
    if (m.fromName || !Array.isArray(m.lines)) continue
    m.lines.forEach((l, i) => {
      if (typeof l?.text !== 'string' || !l.audience) return
      const key = noteKey(l.text)
      if (!key || onCards.has(key) || seen.has(key) || !audienceAdmits(l.audience, ring)) return
      seen.add(key)
      const id = `${MEETING_THREAD_PREFIX}${m.id}:${i}`
      out.refs.set(id, { threadId: id, text: l.text, context: MEETING_NOTE_CONTEXT, at: m.startedAt })
      out.threads.push(lineThread(s.me.displayName, id, l.text, MEETING_NOTE_CONTEXT, m.startedAt))
    })
  }
  return out
}
