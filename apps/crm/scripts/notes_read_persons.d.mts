export interface ReadPerson { name: string; aliases: string[]; context: string; facts: string[]; met: string; confidence: number }
export interface Reading { key?: string; path: string; date: string; reader?: string; chars?: number; communities?: string[]; people: ReadPerson[] }
export const PROMPT: string
export function listNotes(vault: string, include?: string[]): string[]
export function noteDate(rel: string, text: string, mtimeMs: number): string
export function chunks(text: string): string[]
export function parseAnswer(raw: unknown): { people: ReadPerson[] }
export function mergePeople(lists: ReadPerson[][]): ReadPerson[]
export function readerFor(spec: string): (text: string) => Promise<{ text: string; cost: number }>
export function noteKey(rel: string, text: string, reader: string): string
export const CONFIG_FILE: string
export function skipFolders(vault: string, flagList?: string[]): string[]
export function inSkippedFolder(rel: string, folders: string[]): boolean
export interface ToRead { rel: string; text: string; key: string; date: string; communities: string[] }
export function selectNotes(rels: string[], load: (rel: string) => { text: string; mtimeMs: number }, o?: { done?: Set<string>; reader?: string; limit?: number; folders?: string[] }): { todo: ToRead[]; folderSkipped: number; skippedSmall: number; optedOut: number; peopleSkipped: number }
export function readNote(reader: (text: string) => Promise<{ text: string; cost: number }>, rel: string, text: string, date: string): Promise<{ people: ReadPerson[]; cost: number }>
