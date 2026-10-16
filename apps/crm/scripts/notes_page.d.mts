import type { Person } from '../../trustweb/src/model'
export const BEGIN: string
export const END: string
export const MARK_FOLDER: string
export interface PageLine { id: string; text: string; date: string }
export interface Page { id: string; name: string; ring: string; tana: string; updated: number; context: string; lines: PageLine[]; userLines: { text: string; date: string }[]; userText: string }
export function slug(person: Pick<Person, 'id' | 'name'>): string
export function renderPage(person: Person, o?: { now?: number; userText?: string }): string
export function parsePage(text: string): Page | null
export function updatePage(existing: string | null, person: Person, o?: { now?: number }): string
export function diffPage(page: Page, person: Person): { ring: string | null; newLines: { text: string; date: string }[] }
export const RINGS: readonly string[]
export interface Block { id: string; name: string; ring: string; updated: number; lines: PageLine[]; userLines: { text: string; date: string }[] }
export function renderBlock(person: Person, o?: { now?: number; keep?: { text: string; date: string }[] }): string
export function parseBlocks(text: string): Block[]
export function upsertBlock(noteText: string, person: Person, o?: { now?: number }): string
export function blockChanges(block: Block, person: Person, fileMtime: number): { ring: string | null; newLines: { text: string; date: string }[] }
