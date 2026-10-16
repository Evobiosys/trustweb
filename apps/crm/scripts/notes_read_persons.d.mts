export interface ReadPerson { name: string; aliases: string[]; context: string; facts: string[]; met: string; confidence: number }
export interface Reading { key?: string; path: string; date: string; reader?: string; chars?: number; communities?: string[]; people: ReadPerson[] }
export const PROMPT: string
export function listNotes(vault: string, include?: string[]): string[]
export function noteDate(rel: string, text: string, mtimeMs: number): string
export function chunks(text: string): string[]
export function parseAnswer(raw: unknown): { people: ReadPerson[] }
export function mergePeople(lists: ReadPerson[][]): ReadPerson[]
export function readerFor(spec: string): (text: string) => Promise<{ text: string; cost: number }>
export function noteKey(rel: string, mtimeMs: number, reader: string): string
export function readNote(reader: (text: string) => Promise<{ text: string; cost: number }>, rel: string, text: string, date: string): Promise<{ people: ReadPerson[]; cost: number }>
