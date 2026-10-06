/**
 * "Import inventory file" (wave 1733 round B, amendment A4 and A8 f): the
 * file the Mac makes from Tana (trustweb-inventory-import.json, schema in
 * W/peer_of-trust_result-report.txt section 5) lands in this phone's
 * inventory. Rules:
 *   - every line lands as "Only me" (nobody can ask about it), provenance
 *     "tana", the file's `key` kept as the source's ref (local only, never
 *     sent: answers carry text, coarse date and context only);
 *   - re-importing is idempotent: a line whose key is already here (even after
 *     an edit) or whose normalised text equals an item's is skipped;
 *   - a summary comes BEFORE anything is written;
 *   - "Undo import" removes exactly the items that import added and the
 *     person has not changed since (text or who can ask): what they touched stays.
 * Nothing is sent anywhere. Pure and DOM-free: the unit tests run these functions.
 */
import { Audience, Provenance } from './model'
import type { AppState, ImportBatch, InventoryItem } from './model'

export const IMPORT_FORMAT = 'trustweb-inventory-import'
export const IMPORT_VERSION = 1
/** Bigger files are refused before they are read as JSON. */
export const IMPORT_MAX_BYTES = 1_000_000
export const IMPORT_MAX_ITEMS = 2000
const TEXT_MAX = 160
const KEY_RE = /^[0-9a-f]{16}$/
/** Import batches kept for "Undo import", newest first. */
export const IMPORTS_KEPT = 10

export enum ImportProblem {
  NotJson = 'not-json',
  WrongFormat = 'wrong-format',
  WrongVersion = 'wrong-version',
  TooBig = 'too-big',
  Empty = 'empty',
}

export interface ImportLine {
  key: string
  text: string
  allowedInAdvance: boolean
}

export interface ParsedImport {
  exportedOn: string
  lines: ImportLine[]
  /** Entries in the file that were not shaped as a line (left out). */
  unreadable: number
}

export interface ImportPlan {
  exportedOn: string
  add: ImportLine[]
  /** Already in this inventory (by key or by text), skipped. */
  already: number
  unreadable: number
  allowedInAdvance: number
}

/** The same normalisation as the Mac side: inline markup stripped, whitespace collapsed, trimmed, lower-cased. */
export function normalise(text: string): string {
  return text.replace(/\*\*|__|~~|\^\^|\[\[|\]\]|`/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function lineOf(v: unknown): ImportLine | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (typeof o.key !== 'string' || !KEY_RE.test(o.key) || typeof o.text !== 'string') return null
  const text = o.text.replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX)
  if (!text) return null
  return { key: o.key, text, allowedInAdvance: o.allowedInAdvance === true }
}

/** Reads the file; any other format or version is refused with the reason. */
export function parseImportFile(raw: string): ParsedImport | ImportProblem {
  if (raw.length > IMPORT_MAX_BYTES) return ImportProblem.TooBig
  let v: unknown
  try { v = JSON.parse(raw) } catch { return ImportProblem.NotJson }
  if (typeof v !== 'object' || v === null) return ImportProblem.WrongFormat
  const o = v as Record<string, unknown>
  if (o.format !== IMPORT_FORMAT) return ImportProblem.WrongFormat
  if (o.version !== IMPORT_VERSION) return ImportProblem.WrongVersion
  if (!Array.isArray(o.items)) return ImportProblem.WrongFormat
  const entries = o.items.slice(0, IMPORT_MAX_ITEMS)
  const lines = entries.map(lineOf).filter((l): l is ImportLine => l !== null)
  if (!lines.length) return ImportProblem.Empty
  const exportedOn = typeof o.exportedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.exportedOn) ? o.exportedOn : ''
  return { exportedOn, lines, unreadable: entries.length - lines.length }
}

/** What would be added: new keys and new texts only (also within the file itself). */
export function planImport(s: Pick<AppState, 'inventory'>, parsed: ParsedImport): ImportPlan {
  const keys = new Set(s.inventory.map((i) => (i.source?.kind === Provenance.Tana ? i.source.ref : undefined)).filter((k): k is string => Boolean(k)))
  const texts = new Set(s.inventory.map((i) => normalise(i.text)))
  const add: ImportLine[] = []
  for (const l of parsed.lines) {
    const n = normalise(l.text)
    if (keys.has(l.key) || texts.has(n)) continue
    keys.add(l.key)
    texts.add(n)
    add.push(l)
  }
  return { exportedOn: parsed.exportedOn, add, already: parsed.lines.length - add.length, unreadable: parsed.unreadable, allowedInAdvance: add.filter((l) => l.allowedInAdvance).length }
}

/** Writes the plan: the new items (Only me, from Tana, the key kept), and the batch for "Undo import". */
export function applyImport(s: AppState, plan: ImportPlan, now: number, newId: () => string): ImportBatch {
  const batch: ImportBatch = { id: newId(), at: now, exportedOn: plan.exportedOn, items: [] }
  const items: InventoryItem[] = plan.add.map((l) => ({
    id: newId(), text: l.text, audience: Audience.OnlyMe, included: true, createdAt: now, source: { kind: Provenance.Tana, ref: l.key },
  }))
  for (const it of items) batch.items.push({ itemId: it.id, key: it.source?.ref ?? '', text: it.text, audience: it.audience })
  s.inventory.unshift(...items)
  s.imports = [batch, ...(Array.isArray(s.imports) ? s.imports : [])].slice(0, IMPORTS_KEPT)
  return batch
}

/** Has the person changed this imported item since (its text or who can ask)? Then Undo leaves it. */
function changed(item: InventoryItem, as: ImportBatch['items'][number]): boolean {
  return item.text !== as.text || item.audience !== as.audience
}

/** Undo one import: removes its items the person has not changed; the batch goes. Returns removed / kept counts. */
export function undoImport(s: AppState, batchId: string): { removed: number; kept: number } {
  const batch = (s.imports ?? []).find((b) => b.id === batchId)
  if (!batch) return { removed: 0, kept: 0 }
  const byId = new Map(batch.items.map((x) => [x.itemId, x]))
  let removed = 0
  let kept = 0
  s.inventory = s.inventory.filter((item) => {
    const as = byId.get(item.id)
    if (!as) return true
    if (changed(item, as) || item.source?.ref !== as.key) { kept++; return true }
    removed++
    return false
  })
  s.imports = (s.imports ?? []).filter((b) => b.id !== batchId)
  if (!s.imports.length) delete s.imports
  return { removed, kept }
}

/** The newest import still listed (Settings shows it with "Undo import"). */
export function lastImport(s: Pick<AppState, 'imports'>): ImportBatch | null {
  const list = Array.isArray(s.imports) ? s.imports : []
  return list.find((b) => b && typeof b.id === 'string' && Array.isArray(b.items)) ?? null
}
