// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Wave 41 obsidian-sync: reading a vault. scanAll hashes every note and parses only the new and changed ones (this is what the Web Worker runs);
 * syncVault joins that with the cache of earlier parses, so a re-sync touches only what changed. Pure over file-like objects and a NoteCache.
 */
import type { VaultFile } from './obsidian_files'
import { NEEDS_HTTPS, diffHashes, sha256Hex } from './obsidian_diff'
import type { HashDiff } from './obsidian_diff'
import { parseNote } from './obsidian_parse'
import type { ParsedNote } from './obsidian_parse'

export interface NoteRecord { path: string; hash: string; note: ParsedNote }
export interface ScanResult { changed: NoteRecord[]; same: string[]; failed: string[] }
export type Progress = (done: number, total: number) => void

/** A hash and a parse for each note whose hash differs from `known` (path -> hash). A note that cannot be read is listed in `failed`. */
export async function scanAll(files: readonly VaultFile[], known: Readonly<Record<string, string>>, onProgress?: Progress, signal?: AbortSignal): Promise<ScanResult> {
  const r: ScanResult = { changed: [], same: [], failed: [] }
  if (files.length && !globalThis.crypto?.subtle) throw new Error(NEEDS_HTTPS)
  let done = 0
  for (const { path, file } of files) {
    signal?.throwIfAborted()
    try {
      const text = await file.text()
      const hash = await sha256Hex(text)
      if (known[path] === hash) r.same.push(path); else r.changed.push({ path, hash, note: parseNote(path, text) })
    } catch { r.failed.push(path) }
    onProgress?.(++done, files.length)
  }
  return r
}

/** Parsed notes by path, kept on this device (IndexedDB, see obsidian_cache.ts). Holds the parse, never the note text. */
export interface NoteCache {
  all(): Promise<NoteRecord[]>
  put(records: readonly NoteRecord[]): Promise<void>
  remove(paths: readonly string[]): Promise<void>
  clear(): Promise<void>
}

export function memoryCache(): NoteCache {
  const m = new Map<string, NoteRecord>()
  return {
    all: async () => [...m.values()],
    put: async (rs) => { for (const r of rs) m.set(r.path, r) },
    remove: async (ps) => { for (const p of ps) m.delete(p) },
    clear: async () => { m.clear() },
  }
}

export type Scanner = (files: readonly VaultFile[], known: Record<string, string>, onProgress?: Progress, signal?: AbortSignal) => Promise<ScanResult>

/** The cache after this scan: the notes now in the vault, parsed. `scan` is the Web Worker in the app, scanAll in tests. */
export async function syncVault(files: readonly VaultFile[], cache: NoteCache, scan: Scanner = scanAll, onProgress?: Progress, signal?: AbortSignal): Promise<{ notes: ParsedNote[]; /** Hash of each note now in the cache, by path. */ hashes: Record<string, string>; diff: Record<keyof HashDiff, number>; failed: string[] }> {
  const cached = new Map((await cache.all()).map((r) => [r.path, r]))
  const known = Object.fromEntries([...cached].map(([p, r]) => [p, r.hash]))
  const r = await scan(files, known, onProgress, signal)
  const now = new Set(files.map((f) => f.path))
  for (const p of r.failed) now.delete(p)
  const current: Record<string, string> = {}
  for (const p of r.same) current[p] = known[p]
  for (const c of r.changed) current[c.path] = c.hash
  const d = diffHashes(known, current)
  const removed = [...cached.keys()].filter((p) => !now.has(p) && !r.failed.includes(p))
  await cache.remove(removed)
  await cache.put(r.changed)
  for (const c of r.changed) cached.set(c.path, c)
  for (const p of removed) cached.delete(p)
  return { notes: [...cached.values()].map((x) => x.note), hashes: Object.fromEntries([...cached.values()].map((x) => [x.path, x.hash])), diff: { added: d.added.length, changed: d.changed.length, removed: removed.length, same: d.same.length }, failed: r.failed }
}
