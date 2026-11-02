// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * Every change the CLI makes to a record. Each one is pure (record in, new record out, the given one untouched), refuses what makes
 * no sense with a CliError, and appends one human-readable line to the record's log (I6). Nothing is ever deleted: a zone is
 * archived, a member taken out of a zone stays a person or tag of the record. Tag nesting and share lines go through the share sink.
 */
import { appendShare } from '../../../apps/trustweb/src/share_sink/share_lines'
import { nest } from '../../../apps/trustweb/src/share_sink/tags'
import type { Store, Tuple } from '../../../apps/trustweb/src/share_sink/tuples'
import { Zone } from '../../../apps/trustweb/src/share_sink/zones'
import { CliError, usage } from './errors'
import { type CliRecord, type MemberRef, type ZoneEntry, LEVELS, isId, isLevel, memberRef } from './record'

export interface Change { record: CliRecord; message: string }

const MAX_NAME = 80

function change(r: CliRecord, now: Date, message: string, patch: Partial<CliRecord>): Change {
  return { record: { ...r, ...patch, log: [...r.log, `${now.toISOString()} ${message}`] }, message }
}

export function checkId(id: string, what: string): string {
  if (!isId(id)) throw usage(`${what} ${JSON.stringify(id)} is not an id (lowercase a-z, 0-9, dot, dash, underscore; up to 64)`)
  return id
}

function cleanName(name: string): string {
  const n = name.trim()
  if (!n) throw usage('name must not be blank')
  if (n.length > MAX_NAME) throw usage(`name is longer than ${MAX_NAME} characters`)
  return n
}

export function findZone(r: CliRecord, id: string): ZoneEntry {
  const z = r.zones.find((x) => x.id === id)
  if (!z) throw new CliError(`no zone ${id} (see: trustweb zone list --all)`)
  return z
}

const withZone = (r: CliRecord, id: string, patch: (z: ZoneEntry) => ZoneEntry): ZoneEntry[] => r.zones.map((z) => (z.id === id ? patch(z) : z))
const quoted = (name: string | undefined): string => (name === undefined ? '' : ` "${name}"`)
const newNote = (added: readonly string[]): string => (added.length ? ` (new: ${added.join(', ')})` : '')

function unique<T>(xs: readonly T[], key: (x: T) => string): void {
  const seen = new Set<string>()
  for (const x of xs) {
    if (seen.has(key(x))) throw usage(`${key(x)} given twice`)
    seen.add(key(x))
  }
}

/** Adds the people and tags the refs name that the record does not hold yet; returns the refs it added. */
function register(r: CliRecord, refs: readonly MemberRef[], now: Date): { record: CliRecord; added: string[] } {
  const at = now.toISOString()
  const people = [...r.people]
  const tags = [...r.tags]
  const added: string[] = []
  for (const m of refs) {
    const list: { id: string }[] = m.kind === 'person' ? people : tags
    if (list.some((x) => x.id === m.id)) continue
    if (m.kind === 'person') people.push({ id: m.id, tags: [], addedAt: at })
    else tags.push({ id: m.id, parents: [], createdAt: at })
    added.push(m.ref)
  }
  return { record: { ...r, people, tags }, added }
}

function refsOf(words: readonly string[]): MemberRef[] {
  if (!words.length) throw usage('name at least one person:<id> or tag:<id>')
  const refs = words.map(memberRef)
  unique(refs, (m) => m.ref)
  return refs
}

function openZone(r: CliRecord, id: string): ZoneEntry {
  const z = findZone(r, id)
  if (z.archivedAt) throw new CliError(`zone ${id} is archived; restore it first (trustweb zone restore ${id})`)
  return z
}

export function createZone(r: CliRecord, id: string, level: string, name: string | undefined, now: Date): Change {
  checkId(id, 'zone')
  if (isLevel(id)) throw new CliError(`${id} is a built-in level; pick another id`)
  if (r.zones.some((z) => z.id === id)) throw new CliError(`zone ${id} exists`)
  if (!isLevel(level)) throw usage(`level must be one of ${LEVELS.join(', ')}`)
  const zone: ZoneEntry = { id, name: name === undefined ? id : cleanName(name), level: level as Zone, builtin: false, members: [], createdAt: now.toISOString() }
  return change(r, now, `zone create: ${id} "${zone.name}" on level ${level}`, { zones: [...r.zones, zone] })
}

export function renameZone(r: CliRecord, id: string, name: string, now: Date): Change {
  const z = findZone(r, id)
  const next = cleanName(name)
  return change(r, now, `zone rename: ${id} "${z.name}" -> "${next}"`, { zones: withZone(r, id, (x) => ({ ...x, name: next })) })
}

export function archiveZone(r: CliRecord, id: string, now: Date): Change {
  const z = findZone(r, id)
  if (z.archivedAt) throw new CliError(`zone ${id} is archived already (since ${z.archivedAt})`)
  if (z.builtin && z.level === Zone.Public) throw new CliError('public cannot be archived (the ladder keeps public and self always on)')
  const why = z.builtin ? 'ring switched off: what is shared to it moves one ring in' : 'it places nobody now'
  return change(r, now, `zone archive: ${id} (${why})`, { zones: withZone(r, id, (x) => ({ ...x, archivedAt: now.toISOString() })) })
}

export function restoreZone(r: CliRecord, id: string, now: Date): Change {
  if (!findZone(r, id).archivedAt) throw new CliError(`zone ${id} is not archived`)
  return change(r, now, `zone restore: ${id}`, { zones: withZone(r, id, ({ archivedAt: _, ...x }) => x) })
}

export function addMembers(r: CliRecord, id: string, words: readonly string[], now: Date): Change {
  const refs = refsOf(words)
  const z = openZone(r, id)
  for (const m of refs) if (z.members.includes(m.ref)) throw new CliError(`${m.ref} is in ${id} already`)
  const { record, added } = register(r, refs, now)
  const zones = withZone(record, id, (x) => ({ ...x, members: [...x.members, ...refs.map((m) => m.ref)] }))
  return change(record, now, `zone add: ${id} + ${refs.map((m) => m.ref).join(', ')}${newNote(added)}`, { zones })
}

export function removeMembers(r: CliRecord, id: string, words: readonly string[], now: Date): Change {
  const refs = refsOf(words)
  const z = openZone(r, id)
  for (const m of refs) if (!z.members.includes(m.ref)) throw new CliError(`${m.ref} is not in ${id}`)
  const gone = new Set(refs.map((m) => m.ref))
  const zones = withZone(r, id, (x) => ({ ...x, members: x.members.filter((m) => !gone.has(m)) }))
  return change(r, now, `zone remove: ${id} - ${[...gone].join(', ')}`, { zones })
}

export function addPerson(r: CliRecord, id: string, name: string | undefined, now: Date): Change {
  checkId(id, 'person')
  if (r.people.some((p) => p.id === id)) throw new CliError(`person ${id} exists`)
  const n = name === undefined ? undefined : cleanName(name)
  const person = { id, ...(n !== undefined && { name: n }), tags: [], addedAt: now.toISOString() }
  return change(r, now, `person add: ${id}${quoted(n)}`, { people: [...r.people, person] })
}

function tagIds(tags: readonly string[]): string[] {
  if (!tags.length) throw usage('name at least one tag')
  tags.forEach((t) => checkId(t, 'tag'))
  unique(tags, (t) => t)
  return [...tags]
}

export function tagPerson(r: CliRecord, id: string, tags: readonly string[], now: Date): Change {
  const ts = tagIds(tags)
  checkId(id, 'person')
  const held = r.people.find((p) => p.id === id)?.tags ?? []
  for (const t of ts) if (held.includes(t)) throw new CliError(`${id} holds ${t} already`)
  const refs: MemberRef[] = [{ kind: 'person', id, ref: `person:${id}` }, ...ts.map((t) => ({ kind: 'tag' as const, id: t, ref: `tag:${t}` }))]
  const { record, added } = register(r, refs, now)
  const people = record.people.map((p) => (p.id === id ? { ...p, tags: [...p.tags, ...ts] } : p))
  return change(record, now, `person tag: ${id} + ${ts.join(', ')}${newNote(added)}`, { people })
}

export function untagPerson(r: CliRecord, id: string, tags: readonly string[], now: Date): Change {
  const ts = tagIds(tags)
  const person = r.people.find((p) => p.id === id)
  if (!person) throw new CliError(`no person ${id} (see: trustweb person list)`)
  for (const t of ts) if (!person.tags.includes(t)) throw new CliError(`${id} does not hold ${t}`)
  const people = r.people.map((p) => (p.id === id ? { ...p, tags: p.tags.filter((t) => !ts.includes(t)) } : p))
  return change(r, now, `person untag: ${id} - ${ts.join(', ')}`, { people })
}

export function createTag(r: CliRecord, id: string, label: string | undefined, now: Date): Change {
  checkId(id, 'tag')
  if (r.tags.some((t) => t.id === id)) throw new CliError(`tag ${id} exists`)
  const l = label === undefined ? undefined : cleanName(label)
  const tag = { id, ...(l !== undefined && { label: l }), parents: [], createdAt: now.toISOString() }
  return change(r, now, `tag create: ${id}${quoted(l)}`, { tags: [...r.tags, tag] })
}

/** The record's tag nesting as share-sink tuples (tag:child nested_in tag:parent). */
export function nestingTuples(r: CliRecord): Tuple[] {
  return r.tags.flatMap((t) => t.parents.map((p) => ({ subject: `tag:${t.id}`, relation: 'nested_in' as const, object: `tag:${p}`, since: t.createdAt, by: r.device })))
}

export function nestTag(r: CliRecord, child: string, parent: string, now: Date): Change {
  for (const id of [child, parent]) if (!r.tags.some((t) => t.id === id)) throw new CliError(`no tag ${id} (see: trustweb tag list)`)
  if (r.tags.some((t) => t.id === child && t.parents.includes(parent))) throw new CliError(`${child} is under ${parent} already`)
  try {
    nest(nestingTuples(r) as Store, `tag:${child}`, `tag:${parent}`, r.device, now)
  } catch (e) {
    throw new CliError((e as Error).message)
  }
  const tags = r.tags.map((t) => (t.id === child ? { ...t, parents: [...t.parents, parent] } : t))
  return change(r, now, `tag nest: ${child} under ${parent}`, { tags })
}

export function share(r: CliRecord, item: string, zoneId: string, include: readonly string[], exclude: readonly string[], now: Date): Change {
  checkId(item, 'item')
  const z = findZone(r, zoneId)
  if (!z.builtin) throw new CliError(`${zoneId} is a created zone on level ${z.level}: share to ${z.level}, or name its people with --include`)
  const inc = include.map(memberRef)
  const exc = exclude.map(memberRef)
  for (const m of inc) if (exc.some((x) => x.ref === m.ref)) throw usage(`${m.ref} is both included and excluded`)
  const { record, added } = register(r, [...inc, ...exc], now)
  const scope = { zone: z.level, include: inc.map((m) => m.ref), exclude: exc.map((m) => m.ref) }
  const shares = appendShare(record.shares, { id: `item:${item}`, scope, to: `zone:${z.id}`, ts: now.toISOString() })
  const parts = [`share: item:${item} with zone ${z.id}`, ...(inc.length ? [`+ ${scope.include.join(', ')}`] : []), ...(exc.length ? [`- ${scope.exclude.join(', ')}`] : [])]
  const off = z.archivedAt ? ` (${z.id} is archived: it reaches the next ring in that is on)` : ''
  return change(record, now, `${parts.join(' ')}${newNote(added)}${off}`, { shares })
}
