// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb person`: who the record may name. A person is an id plus a display name; what they are (zones, tags, grants)
 * lives in tuples. Removing a person keeps the entry (removedAt) and closes every live tuple that names them, so the
 * record still tells what was true before; adding the same id again revives the entry with nothing re-opened.
 */
import { CommandError, type Command } from '../cli.ts'
import { addFact, closeFacts, hasLive, liveTuples, requirePerson, requireTag, zoneOfPersonIn } from '../domain.ts'
import { personId, tagId } from '../ids.ts'
import { count, table, when } from '../output.ts'
import type { TrustRecord } from '../record.ts'
import { heldTags } from '../sink.ts'

/** A name as typed, trimmed; an empty one is refused. */
function nameText(text: string): string {
  const t = text.trim()
  if (!t) throw new CommandError('a name must not be empty')
  return t
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)]
const bareOf = (id: string): string => id.slice(id.indexOf(':') + 1)
const bareList = (ids: readonly string[]): string => ids.map(bareOf).join(', ')

/** The tags a person holds directly (their own live has_tag tuples), sorted. */
const directTags = (r: TrustRecord, p: string, now: Date): string[] =>
  [...new Set(liveTuples(r, now).filter((t) => t.subject === p && t.relation === 'has_tag').map((t) => t.object))].sort()

interface PersonRow { person: string; name: string; state: 'live' | 'removed'; zone: string; tags: string[]; added: string; removed?: string }

const list: Command = {
  name: 'list',
  summary: 'List the persons in this record, by id',
  description: [
    'zone is the zone the person counts as now: the most intimate of their zones that are on, public when none.',
    'tags are the tags they hold directly (not the ones above them through nesting).',
  ].join('\n'),
  options: [{ name: 'all', alias: 'a', kind: 'flag', help: 'Also list removed persons (with a state column)' }],
  examples: ['trustweb person list', 'trustweb person list --all', 'trustweb person list --json'],
  run(ctx) {
    const r = ctx.record()
    const all = ctx.options.all === true
    const rows: PersonRow[] = Object.keys(r.persons).sort()
      .filter((id) => all || r.persons[id].removedAt === undefined)
      .map((id) => {
        const e = r.persons[id]
        const p = `person:${id}`
        return {
          person: p, name: e.name, state: e.removedAt === undefined ? 'live' : 'removed', zone: zoneOfPersonIn(r, p, ctx.now),
          tags: directTags(r, p, ctx.now), added: e.addedAt, ...(e.removedAt !== undefined && { removed: e.removedAt }),
        }
      })
    const header = all ? ['person', 'name', 'state', 'zone', 'tags', 'added'] : ['person', 'name', 'zone', 'tags', 'added']
    const cells = rows.map((x) => (all ? [x.person, x.name, x.state, x.zone, x.tags.join(','), when(x.added)] : [x.person, x.name, x.zone, x.tags.join(','), when(x.added)]))
    ctx.emit(rows, table(cells, header))
  },
}

const add: Command = {
  name: 'add',
  summary: 'Add a person the record may name (or re-add a removed one)',
  description: [
    'The name defaults to the id. Re-adding a removed person revives the same entry; their old zones and tags stay closed.',
  ].join('\n'),
  positionals: [{ name: 'id', help: 'The person id: ada or person:ada (letters, digits, . _ - @)' }],
  options: [{ name: 'name', alias: 'n', kind: 'string', placeholder: '<text>', help: 'The display name (default: the id)' }],
  examples: ['trustweb person add ada', 'trustweb person add bo --name "Bo"'],
  run(ctx) {
    const { id, bare } = personId(ctx.positionals[0])
    const r = ctx.record()
    const given = typeof ctx.options.name === 'string' ? nameText(ctx.options.name) : undefined
    const e = r.persons[bare]
    if (e && e.removedAt === undefined) throw new CommandError(`person ${bare} is already in this record ("${e.name}"): run \`trustweb person rename ${bare} <name>\` to rename them`)
    let result: 'added' | 're-added'
    if (e) {
      delete e.removedAt
      if (given !== undefined) e.name = given
      result = 're-added'
    } else {
      r.persons[bare] = { name: given ?? bare, addedAt: ctx.now.toISOString() }
      result = 'added'
    }
    const name = r.persons[bare].name
    const line = `${result} person ${bare} ("${name}")`
    ctx.commit(r, line)
    ctx.emit({ person: id, name, result }, line)
  },
}

const rename: Command = {
  name: 'rename',
  summary: 'Change a person\'s display name',
  positionals: [{ name: 'id', help: 'A person in this record' }, { name: 'name', help: 'The new name (quote it if it has spaces)' }],
  examples: ['trustweb person rename ada "Ada L."'],
  run(ctx) {
    const { id, bare } = personId(ctx.positionals[0])
    const r = ctx.record()
    const e = requirePerson(r, bare)
    const name = nameText(ctx.positionals[1])
    const previous = e.name
    if (previous === name) {
      ctx.emit({ person: id, name, previous, changed: false }, `person ${bare} is already named "${name}"; nothing changed`)
      return
    }
    e.name = name
    const line = `renamed person ${bare} from "${previous}" to "${name}"`
    ctx.commit(r, line)
    ctx.emit({ person: id, name, previous, changed: true }, line)
  },
}

const remove: Command = {
  name: 'remove',
  summary: 'Remove persons: mark them removed and close every tuple that names them',
  description: [
    'Their zones, tags and grants end now; the entry and the closed tuples stay as history.',
    'Every person must be in the record and not removed yet; if one is not, nothing is changed.',
    'Share lines are not changed: an item that names the person in its scope keeps naming them.',
  ].join('\n'),
  positionals: [{ name: 'id', help: 'Persons in this record', variadic: true }],
  examples: ['trustweb person remove ada', 'trustweb person remove bo cy --json'],
  run(ctx) {
    const r = ctx.record()
    const ids = unique(ctx.positionals.map((p) => personId(p).id))
    for (const p of ids) {
      const e = r.persons[bareOf(p)]
      if (e?.removedAt !== undefined) throw new CommandError(`person ${bareOf(p)} was already removed (${e.removedAt}): run \`trustweb person add ${bareOf(p)}\` to re-add them`)
      requirePerson(r, bareOf(p))
    }
    const at = ctx.now.toISOString()
    for (const p of ids) r.persons[bareOf(p)].removedAt = at
    const set = new Set(ids)
    const closed = closeFacts(r, (t) => set.has(t.subject) || set.has(t.object), ctx.now)
    const line = `removed ${ids.length === 1 ? 'person' : 'persons'} ${bareList(ids)} (${count(closed, 'tuple')} closed)`
    ctx.commit(r, line)
    ctx.emit({ persons: ids, closed }, line)
  },
}

const tag: Command = {
  name: 'tag',
  summary: 'Give a person tags (each opens the items that carry it, and places them by tag rules)',
  positionals: [{ name: 'id', help: 'A person in this record' }, { name: 'tag', help: 'Tags in this record (garden or tag:garden)', variadic: true }],
  examples: ['trustweb person tag bo garden', 'trustweb person tag cy roses choir'],
  run(ctx) {
    const { id, bare } = personId(ctx.positionals[0])
    const r = ctx.record()
    requirePerson(r, bare)
    const tags = unique(ctx.positionals.slice(1).map((t) => tagId(t).id))
    for (const t of tags) requireTag(r, bareOf(t))
    const rows = tags.map((t) => ({ tag: t, result: addFact(r, { subject: id, relation: 'has_tag', object: t }, ctx.now) ? 'added' : 'already' }))
    const added = rows.filter((x) => x.result === 'added').map((x) => x.tag)
    const line = `tagged ${bare} with ${bareList(added)}`
    if (added.length) ctx.commit(r, line)
    ctx.emit({ person: id, tags: rows }, [...table(rows.map((x) => [x.tag, x.result])), ...(added.length ? [line] : [])])
  },
}

/** Why a person cannot be untagged: they hold the tag only through a nested one, or not at all. */
function notHeld(r: TrustRecord, p: string, t: string, now: Date): string {
  const name = bareOf(p)
  const path = heldTags(liveTuples(r, now), p).get(t)
  if (!path) return `${name} does not hold ${t}`
  const own = path[0].object
  const via = path.find((x) => x.relation === 'nested_in')
  return `${name} holds ${t} only through ${own} (nested under it): run \`trustweb person untag ${name} ${bareOf(own)}\` or \`trustweb tag unnest ${bareOf(via?.subject ?? own)} ${bareOf(via?.object ?? t)}\``
}

const untag: Command = {
  name: 'untag',
  summary: 'Take tags off a person (the has_tag tuples end; history stays)',
  description: 'Every tag must be held directly; a tag held only through nesting is ended at the nested tag. If one is not held, nothing is changed.',
  positionals: [{ name: 'id', help: 'A person in this record' }, { name: 'tag', help: 'Tags the person holds directly', variadic: true }],
  examples: ['trustweb person untag bo garden'],
  run(ctx) {
    const { id, bare } = personId(ctx.positionals[0])
    const r = ctx.record()
    requirePerson(r, bare)
    const tags = unique(ctx.positionals.slice(1).map((t) => tagId(t).id))
    for (const t of tags) if (!hasLive(r, { subject: id, relation: 'has_tag', object: t }, ctx.now)) throw new CommandError(notHeld(r, id, t, ctx.now))
    const set = new Set(tags)
    const closed = closeFacts(r, (t) => t.subject === id && t.relation === 'has_tag' && set.has(t.object), ctx.now)
    const line = `untagged ${bare}: ${bareList(tags)}`
    ctx.commit(r, line)
    ctx.emit({ person: id, tags, closed }, line)
  },
}

export const person: Command = {
  name: 'person',
  summary: 'Persons the record may name',
  description: [
    'A person is an id (ada, or person:ada) with a display name. Zones and tags are given with',
    '`trustweb zone add-person` and `trustweb person tag`; removing a person ends all of them at once.',
  ].join('\n'),
  subcommands: [list, add, rename, remove, tag, untag],
  examples: ['trustweb person add ada --name "Ada"', 'trustweb person tag ada garden', 'trustweb person list', 'trustweb person remove ada'],
}
