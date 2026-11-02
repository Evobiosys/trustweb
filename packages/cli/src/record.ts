// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The record the CLI works on: one JSON file, `.trustweb/record.json` in a directory of the owner's choosing (git-like:
 * `trustweb init` makes it, every command finds it by walking up from the current directory; `--record` or
 * TRUSTWEB_RECORD point elsewhere). It holds
 *   - zones: the ladder zones set up here (zones.ts LADDER), each with a label and, once archived, when;
 *   - persons and tags: who and what the relation store may name, with a display name and when they were added;
 *   - tuples: the relation store itself, the share sink's shape (share_sink/tuples.ts), append-only: a membership that
 *     ends is closed with `until`, never removed, so the record stays its own history;
 *   - shares: the share lines (share_sink/share_lines.ts), the same ones the app's Share page appends;
 *   - log: one human-readable line per command that changed the record (I6 auditability).
 * Everything stays on this machine. Validation reuses the share sink's own parser for the tuples, so the CLI can never
 * write a store the app would refuse. The bytes are canonical (fixed key order, two-space indent, final newline).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { BARE_ID } from './ids.ts'
import { Zone, isZone, parseJsonl, type ShareLine, type Tuple } from './sink.ts'

export const RECORD_KIND = 'trustweb-cli-record'
export const RECORD_VERSION = 1
export const RECORD_DIR = '.trustweb'
export const RECORD_FILE = 'record.json'
export const RECORD_ENV = 'TRUSTWEB_RECORD'
export const DEFAULT_DEVICE = 'device:cli'

export interface ZoneEntry {
  label: string
  createdAt: string
  /** Set when the zone was archived (switched off, zones.ts `active`). Absent: on. */
  archivedAt?: string
}

export interface PersonEntry {
  name: string
  addedAt: string
  /** Set when the person was removed; their tuples were closed then. Kept, never deleted. */
  removedAt?: string
}

export interface TagEntry {
  label: string
  addedAt: string
  removedAt?: string
}

export interface LogEntry {
  at: string
  by: string
  command: string
  text: string
}

export interface TrustRecord {
  kind: typeof RECORD_KIND
  v: typeof RECORD_VERSION
  /** Who writes the tuples (`by`): `device:<name>`, chosen at init. */
  device: string
  zones: Partial<Record<Zone, ZoneEntry>>
  persons: Record<string, PersonEntry>
  tags: Record<string, TagEntry>
  tuples: Tuple[]
  shares: ShareLine[]
  log: LogEntry[]
}

/** The record could not be read or is not a record (exit code 1). */
export class RecordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RecordError'
  }
}

export function emptyRecord(device: string, now: Date): TrustRecord {
  return {
    kind: RECORD_KIND, v: RECORD_VERSION, device, zones: {}, persons: {}, tags: {}, tuples: [], shares: [],
    log: [{ at: now.toISOString(), by: device, command: 'init', text: `record created by ${device}` }],
  }
}

/** One line to the audit log. The record is changed in place; the caller saves it. */
export function appendLog(r: TrustRecord, command: string, text: string, now: Date): void {
  r.log.push({ at: now.toISOString(), by: r.device, command, text })
}

// ---- validation -------------------------------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): v is string => typeof v === 'string' && v !== ''
const iso = (v: unknown): v is string => str(v) && !Number.isNaN(Date.parse(v))

function entry(what: string, id: string, v: unknown, nameKey: 'label' | 'name', atKey: 'createdAt' | 'addedAt', endKey: 'archivedAt' | 'removedAt'): void {
  if (!isObj(v)) throw new RecordError(`${what} "${id}" is not an object`)
  if (typeof v[nameKey] !== 'string') throw new RecordError(`${what} "${id}": ${nameKey} must be a string`)
  if (!iso(v[atKey])) throw new RecordError(`${what} "${id}": ${atKey} must be an ISO date`)
  if (v[endKey] !== undefined && !iso(v[endKey])) throw new RecordError(`${what} "${id}": ${endKey} must be an ISO date`)
}

const SHARE_OPS = ['share', 'revoke', 'retract', 'agree'] as const

function shareLine(i: number, v: unknown): void {
  const bad = (why: string): never => { throw new RecordError(`share line ${i + 1}: ${why}`) }
  if (!isObj(v)) return bad('not an object')
  if (!SHARE_OPS.includes(v.op as (typeof SHARE_OPS)[number])) return bad(`op must be one of ${SHARE_OPS.join(', ')}`)
  if (!str(v.id) || typeof v.seq !== 'number' || !iso(v.ts)) return bad('needs id, seq and ts')
  if (v.op === 'share') {
    const s = v.scope
    if (!isObj(s) || !isZone(String(s.zone)) || !Array.isArray(s.include) || !Array.isArray(s.exclude)) return bad('scope needs a ladder zone, include[] and exclude[]')
    if (![...s.include, ...s.exclude].every(str)) return bad('scope ids must be strings')
    if (typeof v.cutoff !== 'number' || !str(v.to) || v.terms !== 'read-keep') return bad('needs cutoff, to and terms "read-keep"')
  } else if (v.op === 'agree') {
    if (!str(v.agreement) || !str(v.by) || typeof v.cutoff !== 'number') return bad('needs agreement, by and cutoff')
  } else if (!str(v.target) || (v.op === 'revoke' && typeof v.at !== 'number')) {
    return bad('needs target (and at, for a revoke)')
  }
}

function logEntry(i: number, v: unknown): void {
  if (!isObj(v) || !iso(v.at) || !str(v.by) || typeof v.command !== 'string' || typeof v.text !== 'string') throw new RecordError(`log line ${i + 1} is not a log entry`)
}

/** Reads the JSON text of a record; a RecordError names the first thing wrong with it. */
export function parseRecord(text: string): TrustRecord {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    throw new RecordError('not valid JSON')
  }
  if (!isObj(v)) throw new RecordError('a record is a JSON object')
  if (v.kind !== RECORD_KIND) throw new RecordError(`kind must be "${RECORD_KIND}"`)
  if (v.v !== RECORD_VERSION) throw new RecordError(`record version ${String(v.v)} is not known to this build (expected ${RECORD_VERSION})`)
  if (!str(v.device)) throw new RecordError('device must be a non-empty string')
  for (const k of ['zones', 'persons', 'tags'] as const) if (!isObj(v[k])) throw new RecordError(`${k} must be an object`)
  for (const k of ['tuples', 'shares', 'log'] as const) if (!Array.isArray(v[k])) throw new RecordError(`${k} must be an array`)
  const zones = v.zones as Record<string, unknown>
  for (const [id, z] of Object.entries(zones)) {
    if (!isZone(id)) throw new RecordError(`zone "${id}" is not on the ladder`)
    if (id === Zone.Public || id === Zone.Self) throw new RecordError(`zone "${id}" is always on and is never set up or archived`)
    entry('zone', id, z, 'label', 'createdAt', 'archivedAt')
  }
  for (const [id, p] of Object.entries(v.persons as Record<string, unknown>)) {
    if (!BARE_ID.test(id)) throw new RecordError(`person id "${id}" is not a valid id`)
    entry('person', id, p, 'name', 'addedAt', 'removedAt')
  }
  for (const [id, t] of Object.entries(v.tags as Record<string, unknown>)) {
    if (!BARE_ID.test(id)) throw new RecordError(`tag id "${id}" is not a valid id`)
    entry('tag', id, t, 'label', 'addedAt', 'removedAt')
  }
  let tuples: Tuple[]
  try {
    // The share sink's own validator, line by line, so the CLI never keeps a tuple the app would refuse.
    tuples = parseJsonl((v.tuples as unknown[]).map((t) => JSON.stringify(t)).join('\n'))
  } catch (e) {
    throw new RecordError(`tuple ${String((e as Error).message).replace(/^share sink: line /, '')}`)
  }
  ;(v.shares as unknown[]).forEach((s, i) => shareLine(i, s))
  ;(v.log as unknown[]).forEach((l, i) => logEntry(i, l))
  return {
    kind: RECORD_KIND, v: RECORD_VERSION, device: v.device,
    zones: zones as TrustRecord['zones'], persons: v.persons as TrustRecord['persons'], tags: v.tags as TrustRecord['tags'],
    tuples, shares: v.shares as ShareLine[], log: v.log as LogEntry[],
  }
}

// ---- bytes ------------------------------------------------------------------------------------------------------

const TOP_KEYS: readonly (keyof TrustRecord)[] = ['kind', 'v', 'device', 'zones', 'persons', 'tags', 'tuples', 'shares', 'log']
const TUPLE_KEYS = ['subject', 'relation', 'object', 'zone', 'tag', 'since', 'until', 'by'] as const

const ordered = (o: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]))
const sortedKeys = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))

/** The canonical bytes: top-level keys in a fixed order, maps by sorted id, tuples in the share sink's key order. */
export function serializeRecord(r: TrustRecord): string {
  const out = ordered(r as unknown as Record<string, unknown>, TOP_KEYS)
  out.zones = sortedKeys(r.zones as Record<string, unknown>)
  out.persons = sortedKeys(r.persons)
  out.tags = sortedKeys(r.tags)
  out.tuples = r.tuples.map((t) => ordered(t as unknown as Record<string, unknown>, TUPLE_KEYS))
  return JSON.stringify(out, null, 2) + '\n'
}

export function loadRecord(path: string): TrustRecord {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    throw new RecordError(`cannot read the record at ${path}`)
  }
  try {
    return parseRecord(text)
  } catch (e) {
    throw new RecordError(`${path}: ${(e as Error).message}`)
  }
}

/** Writes the canonical bytes through a temporary file and a rename, so a crash never leaves half a record. */
export function saveRecord(path: string, r: TrustRecord): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${process.pid}`
  writeFileSync(tmp, serializeRecord(r))
  renameSync(tmp, path)
}

/**
 * Where the record is: `given` (--record, relative to cwd), else TRUSTWEB_RECORD, else the nearest `.trustweb/record.json`
 * walking up from cwd (git-like), else null.
 */
export function discoverRecord(cwd: string, env: Record<string, string | undefined>, given?: string): string | null {
  if (given) return resolve(cwd, given)
  if (env[RECORD_ENV]) return env[RECORD_ENV]
  let dir = resolve(cwd)
  for (;;) {
    const candidate = join(dir, RECORD_DIR, RECORD_FILE)
    if (existsSync(candidate)) return candidate
    const up = dirname(dir)
    if (up === dir) return null
    dir = up
  }
}

/** The path `trustweb init` writes to in `cwd`. */
export const recordPathIn = (cwd: string): string => join(resolve(cwd), RECORD_DIR, RECORD_FILE)
