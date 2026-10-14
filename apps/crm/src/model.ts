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
import type { AppState } from '../../trustweb/src/model'
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
