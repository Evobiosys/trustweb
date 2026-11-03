import type { AppState } from '../../trustweb/src/model'
import type { Reading } from './notes_read_persons.mjs'

export interface MergeStats { notes: number; mentions: number; belowConfidence: number; joinedExisting: number; newPersons: number; lines: number; singleNames: number; offers: number; joinedByDecision: number; dismissed: number }
export interface Matched { id: string; name: string; paths: string[] }
export interface JoinOffer { key: string; name: string; path: string; date: string; context: string; facts: string[]; candidates: { id: string; name: string }[] }
export interface JoinDecision { key: string; decision: 'join' | 'dismiss'; into?: string; at: string }
export function firstNameKey(name: string): string
export function offerKey(name: string, notePath: string): string
export function loadDecisions(text: string): JoinDecision[]
export function writeIfChanged(outPath: string, text: string, o?: { now?: number }): 'written' | 'unchanged'
export function loadReadings(texts: string[]): Reading[]
export function withoutLocal(record: AppState): AppState
export function withoutTana(record: AppState): AppState
export function merge(seed: AppState, readings: Reading[], o?: { minConfidence?: number; reader?: string; decisions?: JoinDecision[] }): { record: AppState; stats: MergeStats; matched: Map<string, Matched>; offers: JoinOffer[] }
export function tanaLinksMarkdown(matched: Map<string, Matched>, readings: Reading[]): string
