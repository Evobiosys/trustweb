import type { AppState } from '../../trustweb/src/model'
import type { Reading } from './notes_read_persons.mjs'

export interface MergeStats { notes: number; mentions: number; belowConfidence: number; joinedExisting: number; newPersons: number; lines: number; singleNames: number }
export interface Matched { id: string; name: string; paths: string[] }
export function loadReadings(texts: string[]): Reading[]
export function withoutLocal(record: AppState): AppState
export function withoutTana(record: AppState): AppState
export function merge(seed: AppState, readings: Reading[], o?: { minConfidence?: number; reader?: string }): { record: AppState; stats: MergeStats; matched: Map<string, Matched> }
export function tanaLinksMarkdown(matched: Map<string, Matched>, readings: Reading[]): string
