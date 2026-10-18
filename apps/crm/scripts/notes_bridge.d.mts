import type { Person } from '../../trustweb/src/model'
import type { Reading } from './notes_read_persons.mjs'
export interface BridgeConfig { vault: string; port: number; token: string }
export interface PushResult { written: number; unchanged: number; noHome: number; pages: number; errors: string[] }
export interface Change { id: string; path: string; newLines: { text: string; date: string }[] }
export function readConfig(file?: string): BridgeConfig
export function writeConfig(c: BridgeConfig, file?: string): void
export function listNotes(vault: string): string[]
export function homeNotes(people: Person[], readings: Reading[]): Map<string, string>
export function loadReadings(vault: string): Reading[]
export function safePath(vault: string, rel: unknown): string | null
export function push(vault: string, people: Person[], o?: { everyone?: boolean; now?: number }): PushResult
export function changes(vault: string, people: Person[]): Change[]
export function allowed(req: { headers: Record<string, string | undefined>; method?: string }, cfg: BridgeConfig): 'host' | 'origin' | 'token' | null
export function watchVault(cfg: BridgeConfig): { changedAt: number; own: Map<string, number> }
export function serve(cfg: BridgeConfig, onListen?: (server: import('node:http').Server) => void): import('node:http').Server
