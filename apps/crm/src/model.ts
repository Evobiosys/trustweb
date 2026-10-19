/**
 * The CRM's own records, additive to TrustWeb's AppState (apps/trustweb/src/model.ts).
 *
 * The CRM invents no second contact model: people, rings, note lines, tags,
 * channels and peers are TrustWeb's, imported as types. What the CRM adds is
 * what a CRM needs on top and TrustWeb has no home for yet:
 *
 *   - Interaction   one dated thing that happened with a person (met, call,
 *                   message, event), the "what happened" of the timeline
 *   - FollowUp      a dated reminder to do something about a person
 *   - Stage         where a line tagged opportunity / looking / offer stands,
 *                   keyed by that NoteLine's id (a pipeline over existing lines,
 *                   not a parallel "deal" record)
 *   - ContactPoint  phone or email, the two things the roadmap wants collapsed
 *                   under Contact info that Channel (messengers only) lacks
 *
 * Privacy: every CrmState field is this-phone-only by construction. TrustWeb's
 * matcher (model.ts threadsForRing) reads only `people[].lines` and
 * `inventory`, so nothing in CrmState can ever be matched, relayed or shared.
 */
import type { AppState, Person } from '../../trustweb/src/model'
import type { FieldValues } from './fields'
import type { Placements } from './placement'
import type { ContactSource, ImportedContact } from './import/types'

export enum InteractionKind {
  Met = 'met',
  Call = 'call',
  Message = 'message',
  Event = 'event',
  Note = 'note',
}

export const INTERACTION_KINDS: readonly InteractionKind[] = [
  InteractionKind.Met, InteractionKind.Call, InteractionKind.Message, InteractionKind.Event, InteractionKind.Note,
]

export interface Interaction {
  id: string
  personId: string
  at: number
  kind: InteractionKind
  text: string
  /** Where it happened, free text ("Café Prückel", "Signal call"). */
  place?: string
}

export interface FollowUp {
  id: string
  personId: string
  text: string
  dueAt: number
  createdAt: number
  doneAt?: number
}

export enum Stage {
  Idea = 'idea',
  Talking = 'talking',
  Agreed = 'agreed',
  Done = 'done',
  Dropped = 'dropped',
}

export const STAGES: readonly Stage[] = [Stage.Idea, Stage.Talking, Stage.Agreed, Stage.Done, Stage.Dropped]

export enum ContactPointKind {
  Phone = 'phone',
  Email = 'email',
}

export interface ContactPoint {
  kind: ContactPointKind
  value: string
}

/** Where one piece of a contact came from: the file name only (no folder path) and the record in it. */
export interface ContactOrigin {
  source: ContactSource
  file: string
  sourceRef: string
  /** What makes a re-import "already here": the record's UID, or for "#n" positions its content (rows shift between exports). */
  key: string
}

/**
 * A person from an imported contacts file (vCard, Google CSV, Facebook JSON).
 * Not a TrustWeb Person: never part of AppState, so the matcher cannot see it (I1).
 */
export type Contact = Omit<ImportedContact, 'source' | 'file' | 'sourceRef'> & {
  /** 'local:' + uuid */
  id: string
  sources: ContactOrigin[]
}

/** One level of undo for the last contacts import. */
export interface LastImport {
  at: number
  files: string[]
  added: number
  before: Contact[]
}

/** Field placement curated for networks, and who may curate when. */
export interface Curation {
  byNetwork: Record<string, Placements>
  /** `personId` absent = me. Period in ms since epoch (an event, say). */
  admins: { networkId: string; personId?: string; from: number; to: number }[]
}

export interface CrmState {
  v: 1
  interactions: Interaction[]
  followUps: FollowUp[]
  /** NoteLine id -> stage. A line with no entry sits at Stage.Idea. */
  stages: Record<string, Stage>
  /** Person id -> phone / email. */
  contactPoints: Record<string, ContactPoint[]>
  /** Imported contacts; absent on records saved before the contacts import. */
  contacts?: Contact[]
  lastImport?: LastImport
  /** Person id -> the person's own edits to #person fields, keyed by field id; laid over the record's values. */
  personFields?: Record<string, FieldValues>
  /** People hidden from TrustWeb here (Tana's "hide in trustweb" ticked): taken out of the record on load, listed in Settings to unhide. */
  hiddenPeople?: { id: string; name: string; /** What "unhide" puts back when the host's record no longer holds them. */ person?: Person }[]
  curation?: Curation
  /** NoteLine id -> the person's own edit of the line's text, and when they last said it is still true. */
  lineEdits?: Record<string, { text?: string; checkedAt?: number }>
  /** People merged into another (the survivor keeps its id): `from`'s note lines are added to `into` on load, `from` stays in hiddenPeople. */
  merges?: { from: string; into: string }[]
}

/** Delete for good from the Archive (Jakob 2026-10-19): the entry and the person it keeps go; nothing can restore them after. */
export function deleteArchived(crm: CrmState, personId: string): void {
  crm.hiddenPeople = (crm.hiddenPeople ?? []).filter((h) => h.id !== personId)
}

export function emptyCrm(): CrmState {
  return { v: 1, interactions: [], followUps: [], stages: {}, contactPoints: {} }
}

/** TrustWeb's record plus the CRM's: the one shape every view reads. */
export interface CrmView {
  app: AppState
  crm: CrmState
}

/** True for a parsed object that looks like a CrmState this code can read. */
export function isCrmState(x: unknown): x is CrmState {
  if (!x || typeof x !== 'object') return false
  const s = x as Partial<CrmState>
  return s.v === 1 && Array.isArray(s.interactions) && Array.isArray(s.followUps)
    && !!s.stages && typeof s.stages === 'object' && !!s.contactPoints && typeof s.contactPoints === 'object'
}

/** True for a parsed object that looks like TrustWeb's AppState (store.ts applies the same test). */
export function isAppState(x: unknown): x is AppState {
  if (!x || typeof x !== 'object') return false
  const s = x as Partial<AppState>
  return s.v === 1 && !!s.me && Array.isArray(s.people)
}
