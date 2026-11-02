// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The CLI record: one JSON file the owner keeps on their own device. It holds trust zones (the share sink's ladder levels, built
 * in, plus named zones the owner creates on a level), people, tags and the share lines. The relation store is never stored: it is
 * derived (derive.ts), so the share sink's canAccess stays the one check. Pure: text in, values out.
 */
import { isZone, LADDER, Zone } from '../../../apps/trustweb/src/share_sink/zones'
import type { ShareLine } from '../../../apps/trustweb/src/share_sink/share_lines'
import { CliError, usage } from './errors'

export const FORMAT = 'trustweb-cli-record'
export const VERSION = 1

/** The levels a zone can sit on: the ladder without self (self is the owner alone; nobody is put in it). */
export const LEVELS: readonly Zone[] = LADDER.filter((z) => z !== Zone.Self)

/** The built-in zones' starting names (the TrustZones list); a rename changes the name, never the id or the level. */
export const BUILTIN_NAMES: Readonly<Record<string, string>> = {
  [Zone.Public]: 'Public (strangers)',
  [Zone.Intending]: 'Intending to connect',
  [Zone.Acquaintance]: 'Acquaintances',
  [Zone.Community]: 'Community (met before)',
  [Zone.Friend]: 'Friends',
  [Zone.Close]: 'Close friends and allies',
  [Zone.Closest]: 'Closest few',
}

export interface ZoneEntry {
  id: string
  name: string
  level: Zone
  builtin: boolean
  /** `person:<id>` or `tag:<id>`; a tag puts everyone who holds it (nesting included) in the zone. */
  members: string[]
  createdAt: string
  /** Archived from this moment: a built-in zone is a ring switched off, a created zone places nobody. Never deleted. */
  archivedAt?: string
}

export interface PersonEntry { id: string; name?: string; tags: string[]; addedAt: string }
export interface TagEntry { id: string; label?: string; parents: string[]; createdAt: string }

export interface CliRecord {
  format: typeof FORMAT
  version: typeof VERSION
  /** The `by` of every tuple derived from this record. */
  device: string
  zones: ZoneEntry[]
  people: PersonEntry[]
  tags: TagEntry[]
  shares: ShareLine[]
  /** One human-readable line per change (I6). */
  log: string[]
}

export const isId = (s: string): boolean => /^[a-z0-9][a-z0-9._-]{0,63}$/.test(s)
export const isLevel = (s: string): boolean => (LEVELS as readonly string[]).includes(s)

export interface MemberRef { kind: 'person' | 'tag'; id: string; ref: string }

/** `person:<id>` or `tag:<id>`, or a usage error. */
export function memberRef(s: string): MemberRef {
  const m = /^(person|tag):(.*)$/.exec(s)
  if (!m || !isId(m[2])) throw usage(`${s}: expected person:<id> or tag:<id>`)
  return { kind: m[1] as MemberRef['kind'], id: m[2], ref: s }
}

export function emptyRecord(now: Date, device = 'device:cli'): CliRecord {
  const at = now.toISOString()
  return {
    format: FORMAT,
    version: VERSION,
    device,
    zones: LEVELS.map((level) => ({ id: level, name: BUILTIN_NAMES[level], level, builtin: true, members: [], createdAt: at })),
    people: [],
    tags: [],
    shares: [],
    log: [`${at} init: empty record, ${LEVELS.length} built-in zones`],
  }
}

/** Two-space JSON with a trailing newline: the same record always writes the same bytes. */
export const serialize = (r: CliRecord): string => `${JSON.stringify(r, null, 2)}\n`

type Obj = Record<string, unknown>
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v !== ''
const date = (v: unknown): v is string => text(v) && !Number.isNaN(Date.parse(v))
const fail = (where: string, what: string): never => { throw new CliError(`record: ${where}${where ? ': ' : ''}${what}`) }

function list(v: unknown, name: string): unknown[] {
  if (!Array.isArray(v)) fail('', `${name} must be a list`)
  return v as unknown[]
}

function ids(where: string, v: unknown, kind: string, seen: Set<string>): string {
  if (!text(v) || !isId(v)) return fail(where, `id ${JSON.stringify(v)} is not an id (${kind})`)
  if (seen.has(v)) fail(where, `id ${v} appears twice`)
  seen.add(v)
  return v
}

function readTags(raw: unknown): TagEntry[] {
  const seen = new Set<string>()
  const tags = list(raw, 'tags').map((t, i) => {
    const where = `tag ${i + 1}`
    if (!obj(t)) return fail(where, 'not an object')
    const id = ids(where, t.id, 'tag', seen)
    if (t.label !== undefined && !text(t.label)) fail(where, 'label must be text')
    if (!Array.isArray(t.parents) || !t.parents.every(text)) fail(where, 'parents must be a list of tag ids')
    if (!date(t.createdAt)) fail(where, 'createdAt must be a date')
    return { id, ...(t.label !== undefined && { label: t.label as string }), parents: t.parents as string[], createdAt: t.createdAt as string }
  })
  tags.forEach((t, i) => t.parents.forEach((p) => seen.has(p) || fail(`tag ${i + 1}`, `parent ${p} is not in tags`)))
  return tags
}

function readPeople(raw: unknown, tagIds: ReadonlySet<string>): PersonEntry[] {
  const seen = new Set<string>()
  return list(raw, 'people').map((p, i) => {
    const where = `person ${i + 1}`
    if (!obj(p)) return fail(where, 'not an object')
    const id = ids(where, p.id, 'person', seen)
    if (p.name !== undefined && !text(p.name)) fail(where, 'name must be text')
    if (!Array.isArray(p.tags) || !p.tags.every(text)) fail(where, 'tags must be a list of tag ids')
    for (const t of p.tags as string[]) if (!tagIds.has(t)) fail(where, `tag ${t} is not in tags`)
    if (!date(p.addedAt)) fail(where, 'addedAt must be a date')
    return { id, ...(p.name !== undefined && { name: p.name as string }), tags: p.tags as string[], addedAt: p.addedAt as string }
  })
}

function readMembers(where: string, v: unknown, people: ReadonlySet<string>, tags: ReadonlySet<string>): string[] {
  if (!Array.isArray(v)) return fail(where, 'members must be a list')
  const seen = new Set<string>()
  for (const m of v) {
    let ref: MemberRef
    try { ref = memberRef(String(m)) } catch (e) { return fail(where, (e as Error).message) }
    if (seen.has(ref.ref)) fail(where, `${ref.ref} appears twice`)
    seen.add(ref.ref)
    if (!(ref.kind === 'person' ? people : tags).has(ref.id)) fail(where, `${ref.ref} is not in ${ref.kind === 'person' ? 'people' : 'tags'}`)
  }
  return v as string[]
}

function readZones(raw: unknown, people: ReadonlySet<string>, tags: ReadonlySet<string>): ZoneEntry[] {
  const seen = new Set<string>()
  const zones = list(raw, 'zones').map((z, i) => {
    const where = `zone ${i + 1}`
    if (!obj(z)) return fail(where, 'not an object')
    const id = ids(where, z.id, 'zone', seen)
    if (!text(z.name)) fail(where, 'name must be text')
    if (!isLevel(String(z.level))) fail(where, `level must be one of ${LEVELS.join(', ')}`)
    if (typeof z.builtin !== 'boolean') fail(where, 'builtin must be true or false')
    if (z.builtin && !isLevel(id)) fail(where, 'only the levels are built in')
    if (z.builtin && z.level !== id) fail(where, 'a built-in zone sits on its own level')
    if (!z.builtin && isLevel(id)) fail(where, `id ${id} is a level, so it is built in`)
    const members = readMembers(where, z.members, people, tags)
    if (!date(z.createdAt)) fail(where, 'createdAt must be a date')
    if (z.archivedAt !== undefined && !date(z.archivedAt)) fail(where, 'archivedAt must be a date')
    return {
      id, name: z.name as string, level: z.level as Zone, builtin: z.builtin as boolean, members, createdAt: z.createdAt as string,
      ...(z.archivedAt !== undefined && { archivedAt: z.archivedAt as string }),
    }
  })
  for (const level of LEVELS) if (!seen.has(level)) fail('', `built-in zone ${level} is missing`)
  return zones
}

const scopeOk = (s: unknown): boolean => {
  if (!obj(s) || !isZone(String(s.zone)) || !Array.isArray(s.include) || !Array.isArray(s.exclude)) return false
  return [...s.include, ...s.exclude].every((m) => /^(person|tag):[a-z0-9][a-z0-9._-]{0,63}$/.test(String(m)))
}

function readShares(raw: unknown): ShareLine[] {
  return list(raw, 'shares').map((l, i) => {
    if (!obj(l) || !['share', 'revoke', 'retract', 'agree'].includes(String(l.op)) || !text(l.id)) return fail(`share line ${i + 1}`, 'not a share line')
    if (l.op !== 'share') return l as unknown as ShareLine
    const ok = /^item:[a-z0-9][a-z0-9._-]{0,63}$/.test(l.id as string) && date(l.ts) && scopeOk(l.scope)
    return ok ? (l as unknown as ShareLine) : fail(`share line ${i + 1}`, 'not a share of item:<id> with a zone, include and exclude')
  })
}

/** Reads a record, or throws a CliError that names the first thing wrong with it. */
export function parseRecord(source: string): CliRecord {
  let raw: unknown
  try { raw = JSON.parse(source) } catch { return fail('', 'not JSON') }
  if (!obj(raw) || raw.format !== FORMAT) return fail('', 'not a TrustWeb CLI record (format must be trustweb-cli-record)')
  if (raw.version !== VERSION) fail('', `version ${String(raw.version)} found; this CLI reads version ${VERSION}`)
  if (!text(raw.device)) fail('', 'device must be text')
  const tags = readTags(raw.tags)
  const tagIds = new Set(tags.map((t) => t.id))
  const people = readPeople(raw.people, tagIds)
  const zones = readZones(raw.zones, new Set(people.map((p) => p.id)), tagIds)
  const shares = readShares(raw.shares)
  if (!Array.isArray(raw.log) || !raw.log.every((x) => typeof x === 'string')) fail('', 'log must be a list of lines')
  return { format: FORMAT, version: VERSION, device: raw.device as string, zones, people, tags, shares, log: raw.log as string[] }
}
