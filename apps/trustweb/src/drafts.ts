// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 44c event-autosave (Jakob, answer eta: "save a draft silently; and always save progress across all apps and what I create, unless it is
 * more than 10 MB"): one draft store for every editor and composer. Key = editor id + target id; value = the form state as typed, its time and
 * size. Saved 500 ms after the last change and at once when the editor is left (drafts_dom.ts); restored when the editor opens again.
 * THIS DEVICE ONLY: never synced (sync_core.ts SYNC_EXCLUDED), never in an export or an ask (withoutDrafts, cascade.ts). Pure; apps/mcp loads it.
 */
import type { AppState } from './model.ts'

/** A state larger than this (UTF-8 bytes of its JSON form) is not kept; the editor says so quietly. */
export const DRAFT_MAX_BYTES = 10 * 1024 * 1024
export const DRAFT_DEBOUNCE_MS = 500

export interface Draft { editor: string; target: string; value: unknown; updatedAt: number; size: number }
export type DraftOutcome = 'saved' | 'too-big' | 'empty'
type Rec = Pick<AppState, 'drafts'>

export const draftKey = (editor: string, target: string): string => `${editor}:${target}`
export const draftSize = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value) ?? '').length

export const getDraft = (s: Rec, editor: string, target: string): Draft | undefined => s.drafts?.[draftKey(editor, target)]

/** Newest first. */
export const listDrafts = (s: Rec): Draft[] => Object.values(s.drafts ?? {}).sort((a, b) => b.updatedAt - a.updatedAt)

export function discardDraft(s: Rec, key: string): boolean {
  if (!s.drafts?.[key]) return false
  const { [key]: _gone, ...rest } = s.drafts
  if (Object.keys(rest).length) s.drafts = rest; else delete s.drafts
  return true
}

/** Keeps `value` as the draft of editor + target; an empty state drops it; one over DRAFT_MAX_BYTES is skipped (an earlier draft stays). */
export function putDraft<T>(s: Rec, editor: string, target: string, value: T, now: number, isEmpty?: (v: T) => boolean): DraftOutcome {
  if (isEmpty?.(value)) { discardDraft(s, draftKey(editor, target)); return 'empty' }
  const size = draftSize(value)
  if (size > DRAFT_MAX_BYTES) return 'too-big'
  s.drafts = { ...s.drafts, [draftKey(editor, target)]: { editor, target, value: structuredClone(value), updatedAt: now, size } }
  return 'saved'
}

/** The record without its drafts: what an export or anything leaving this device carries. */
export function withoutDrafts<T extends Rec>(s: T): Omit<T, 'drafts'> {
  const { drafts: _drafts, ...rest } = s
  return rest
}

export interface DraftHost {
  state(): Rec
  save(): void
  now(): number
  /** Runs fn after ms; returns the cancel. */
  later(fn: () => void, ms: number): () => void
}

export interface Autosave {
  /** The form changed: save DRAFT_DEBOUNCE_MS after the last change. */
  changed(): void
  /** Save now (the editor is left, the page hides). */
  flush(): void
  /** A change waits for its save. */
  pending(): boolean
  /** Sent, saved or discarded: drop the draft and any pending save. */
  clear(): void
  /** What the last save did, or null before the first. */
  last(): DraftOutcome | null
  stored(): Draft | undefined
}

export function createAutosave<T>(host: DraftHost, editor: string, target: string, read: () => T, isEmpty?: (v: T) => boolean, onOutcome?: (o: DraftOutcome) => void): Autosave {
  let cancel: (() => void) | null = null
  let outcome: DraftOutcome | null = null
  const stop = (): void => { cancel?.(); cancel = null }
  const flush = (): void => {
    stop()
    outcome = putDraft(host.state(), editor, target, read(), host.now(), isEmpty)
    host.save()
    onOutcome?.(outcome)
  }
  return {
    changed: () => { stop(); cancel = host.later(flush, DRAFT_DEBOUNCE_MS) },
    flush,
    pending: () => cancel !== null,
    clear: () => { stop(); if (discardDraft(host.state(), draftKey(editor, target))) host.save() },
    last: () => outcome,
    stored: () => getDraft(host.state(), editor, target),
  }
}
