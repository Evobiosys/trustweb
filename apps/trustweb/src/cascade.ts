/**
 * The sharing cascade (N1; Jakob 2026-10-07 18:31: "anything that I want to
 * share with friends should also be visible by close friends, and anything
 * that I share with acquaintances should be visible by friends and friends of
 * friends"). Per line: FIRST who may ask (the audience, model.ts Audience),
 * THEN how many degrees it may travel beyond my direct contacts.
 *
 * The admission matrix, one rule: a line answers an ask that arrives at step
 * `hop` (hops.ts: 0 = asked by my direct contact) only if
 *   1. its audience admits the ring of the person who handed me the ask (the
 *      asker at hop 0, the contact who passed it on at hop 1+), and
 *   2. hop <= its degrees (0 = my direct contacts only, 1 = friends of
 *      friends, ..., or unbounded).
 * Degrees absent = the default by audience: an "acquaintances" line travels
 * one degree (to friends of friends), every narrower line stays at 0 until
 * raised. Notes about people stay at 0 whatever their audience (fail closed:
 * a note about a third person never reaches a stranger by default).
 *
 * The filter runs BEFORE the matcher (askSources), never after: the matcher's
 * relevance band keeps hits relative to the top score, so a line that may not
 * answer must not take part at all. Pure and DOM-free.
 */
import { HOP_CAP } from '../../demo/src/types'
import type { ChatThread } from '../../demo/src/types'
import { Audience, audienceAdmits, threadsForRing } from './model'
import type { AppState, InventoryItem, LineRef, MatchScope, NoteLine, Ring } from './model'
import { meetingNoteThreads } from './notes_source'

/** Stored `degrees` for "as far as any ask goes" (bounded by hops.ts HOP_CAP in practice). */
export const DEGREES_UNBOUNDED = -1
/** The largest finite degrees value: an ask never arrives further out than hop HOP_CAP - 1. */
export const DEGREES_MAX = HOP_CAP - 1

/** The choices of the degrees chooser, in order: my contacts, friends of friends, two further, a number, no limit. */
export enum DegreesChoice {
  Contacts = 'contacts',
  FriendsOfFriends = 'fof',
  Two = 'two',
  Custom = 'custom',
  NoLimit = 'no-limit',
}

export const DEGREES_CHOICES: readonly DegreesChoice[] = [
  DegreesChoice.Contacts, DegreesChoice.FriendsOfFriends, DegreesChoice.Two, DegreesChoice.Custom, DegreesChoice.NoLimit,
]

/** A value `degrees` may hold: 0..DEGREES_MAX or DEGREES_UNBOUNDED. */
export function isDegrees(v: unknown): v is number {
  return v === DEGREES_UNBOUNDED || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= DEGREES_MAX)
}

/** Jakob's default: an acquaintances line travels one degree (friends of friends), everything narrower none. */
export function defaultDegrees(audience: Audience): number {
  return audience === Audience.FriendsOfFriends ? 1 : 0
}

/** The degrees in force for an inventory item: what was set, else the default for its audience. */
export function itemDegrees(item: Pick<InventoryItem, 'audience' | 'degrees'>): number {
  return isDegrees(item.degrees) ? item.degrees : defaultDegrees(item.audience)
}

/** The degrees in force for a note line about a person: what was set, else 0 (fail closed). */
export function lineDegrees(line: Pick<NoteLine, 'degrees'>): number {
  return isDegrees(line.degrees) ? line.degrees : 0
}

/** The chooser position of a degrees value. */
export function degreesChoice(degrees: number): DegreesChoice {
  if (degrees === DEGREES_UNBOUNDED) return DegreesChoice.NoLimit
  if (degrees === 0) return DegreesChoice.Contacts
  if (degrees === 1) return DegreesChoice.FriendsOfFriends
  if (degrees === 2) return DegreesChoice.Two
  return DegreesChoice.Custom
}

/** The degrees value a chooser position stands for; Custom keeps `custom` (clamped to 1..DEGREES_MAX). */
export function degreesFor(choice: DegreesChoice, custom: number): number {
  switch (choice) {
    case DegreesChoice.Contacts: return 0
    case DegreesChoice.FriendsOfFriends: return 1
    case DegreesChoice.Two: return 2
    case DegreesChoice.NoLimit: return DEGREES_UNBOUNDED
    case DegreesChoice.Custom: return Math.min(DEGREES_MAX, Math.max(1, Math.round(Number.isFinite(custom) ? custom : 1)))
  }
}

/** Does a line with this audience and these degrees answer an ask at step `hop`, handed to me by someone in `ring`? */
export function admitsAtHop(audience: Audience, degrees: number, ring: Ring, hop: number): boolean {
  if (!audienceAdmits(audience, ring)) return false
  if (hop <= 0) return true
  return degrees === DEGREES_UNBOUNDED || hop <= degrees
}

/** May this item answer an ask at `hop` from `ring`? */
export function itemAdmits(item: Pick<InventoryItem, 'audience' | 'degrees' | 'tagAudience'>, ring: Ring, hop: number, askerTags: readonly string[] = []): boolean {
  return admitsAtHop(item.audience, itemDegrees(item), ring, hop) || (hop <= 0 && !!item.tagAudience?.some((t) => askerTags.includes(t)))
}

/** May this note line answer an ask at `hop` from `ring`? */
export function lineAdmits(line: Pick<NoteLine, 'audience' | 'degrees'>, ring: Ring, hop: number): boolean {
  return admitsAtHop(line.audience, lineDegrees(line), ring, hop)
}

/**
 * Everything an incoming ask may be matched against, as the matcher's input:
 * model.ts threadsForRing over a copy of the record that holds only the lines
 * this step admits. THE function the incoming-ask matchers call (net.ts and
 * services/trustweb-peer). The notes of stored meetings join here too (notes_source.ts, wave 6 U4).
 */
export function askSources(s: AppState, ring: Ring, hop: number, scope?: MatchScope, askerTags: readonly string[] = []): { threads: ChatThread[]; refs: Map<string, LineRef> } {
  const admitted: AppState = {
    ...s,
    // Events and their tags on people are local only (events.ts, I1).
    events: undefined,
    // My own profile, links and conversations never ride along into an ask's matching.
    profile: undefined,
    myChannels: undefined,
    chats: undefined,
    inventory: s.inventory.filter((item) => itemAdmits(item, ring, hop, askerTags)),
    // The General note (general_notes.ts), the timeline (timeline.ts) and the agreements (agreements.ts) are Only me: this copy of the record holds the admitted lines, never a person's free-text note, timeline, agreements, event tags, where a dot sits in my Web view or the lean score.
    people: s.people.map(({ generalNote: _private, timeline: _timeline, agreements: _agreements, theirProfile: _theirs, theirChannels: _theirChannels, angle: _angle, lean: _lean, events: _events, reachedOut: _reachedOut, ...p }) => ({ ...p, lines: p.lines.filter((l) => lineAdmits(l, ring, hop)) })),
  }
  const base = threadsForRing(admitted, ring, scope, askerTags)
  const notes = meetingNoteThreads(s, ring, hop, scope)
  notes.refs.forEach((ref, id) => base.refs.set(id, ref))
  return { threads: [...base.threads, ...notes.threads], refs: base.refs }
}
