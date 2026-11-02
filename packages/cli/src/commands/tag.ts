// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb tag`: labels that open items (an item carrying a tag opens to every carrier) and, through a zone rule, place
 * their carriers in a zone. Tags nest (`tag:child nested_in tag:parent`): a carrier of the child holds the parent too.
 * Nesting goes only through the share sink's `nest`, so a cycle or a chain deeper than MAX_DEPTH is refused with the
 * app's own words. Removing a tag keeps the entry and closes every live tuple that names it.
 */
import { CommandError, type Command } from '../cli.ts'
import { closeFacts, hasLive, liveTuples, requireTag } from '../domain.ts'
import { tagId } from '../ids.ts'
import { count, table, when } from '../output.ts'
import type { TrustRecord } from '../record.ts'
import { latestShares, nest, type Store } from '../sink.ts'

function labelText(text: string): string {
  const t = text.trim()
  if (!t) throw new CommandError('a label must not be empty')
  return t
}

const unique = (ids: readonly string[]): string[] => [...new Set(ids)]
const bareOf = (id: string): string => id.slice(id.indexOf(':') + 1)
const bareList = (ids: readonly string[]): string => ids.map(bareOf).join(', ')
const sortedSet = (xs: readonly string[]): string[] => [...new Set(xs)].sort()

interface TagRow { tag: string; label: string; state: 'live' | 'removed'; carriers: number; nestedIn: string[]; zones: string[]; added: string; removed?: string }

function rowOf(r: TrustRecord, bare: string, now: Date): TagRow {
  const e = r.tags[bare]
  const t = `tag:${bare}`
  const live = liveTuples(r, now)
  return {
    tag: t, label: e.label, state: e.removedAt === undefined ? 'live' : 'removed',
    carriers: new Set(live.filter((x) => x.relation === 'has_tag' && x.object === t && x.subject.startsWith('person:')).map((x) => x.subject)).size,
    nestedIn: sortedSet(live.filter((x) => x.relation === 'nested_in' && x.subject === t).map((x) => x.object)),
    zones: sortedSet(live.filter((x) => x.relation === 'in_zone' && x.subject === t).map((x) => bareOf(x.object))),
    added: e.addedAt, ...(e.removedAt !== undefined && { removed: e.removedAt }),
  }
}

const list: Command = {
  name: 'list',
  summary: 'List the tags in this record, by id',
  description: [
    'carriers counts the persons holding the tag directly; nested-in lists its parents;',
    'zones lists the zones its rules place carriers in (`trustweb zone add-tag`).',
  ].join('\n'),
  options: [{ name: 'all', alias: 'a', kind: 'flag', help: 'Also list removed tags (with a state column)' }],
  examples: ['trustweb tag list', 'trustweb tag list --all', 'trustweb tag list --json'],
  run(ctx) {
    const r = ctx.record()
    const all = ctx.options.all === true
    const rows = Object.keys(r.tags).sort().filter((id) => all || r.tags[id].removedAt === undefined).map((id) => rowOf(r, id, ctx.now))
    const cells = rows.map((x) => {
      const rest = [String(x.carriers), x.nestedIn.join(','), x.zones.join(','), when(x.added)]
      return all ? [x.tag, x.label, x.state, ...rest] : [x.tag, x.label, ...rest]
    })
    const header = all ? ['tag', 'label', 'state', 'carriers', 'nested-in', 'zones', 'added'] : ['tag', 'label', 'carriers', 'nested-in', 'zones', 'added']
    ctx.emit(rows, table(cells, header))
  },
}

const add: Command = {
  name: 'add',
  summary: 'Add a tag (or re-add a removed one)',
  description: 'The label defaults to the id. Re-adding a removed tag revives the same entry; its old carriers, nesting and rules stay closed.',
  positionals: [{ name: 'id', help: 'The tag id: garden or tag:garden (letters, digits, . _ - @)' }],
  options: [{ name: 'label', alias: 'l', kind: 'string', placeholder: '<text>', help: 'The display label (default: the id)' }],
  examples: ['trustweb tag add garden', 'trustweb tag add choir --label "Choir"'],
  run(ctx) {
    const { id, bare } = tagId(ctx.positionals[0])
    const r = ctx.record()
    const given = typeof ctx.options.label === 'string' ? labelText(ctx.options.label) : undefined
    const e = r.tags[bare]
    if (e && e.removedAt === undefined) throw new CommandError(`tag ${bare} is already in this record ("${e.label}"): run \`trustweb tag rename ${bare} <label>\` to relabel it`)
    let result: 'added' | 're-added'
    if (e) {
      delete e.removedAt
      if (given !== undefined) e.label = given
      result = 're-added'
    } else {
      r.tags[bare] = { label: given ?? bare, addedAt: ctx.now.toISOString() }
      result = 'added'
    }
    const label = r.tags[bare].label
    const line = `${result} tag ${bare} ("${label}")`
    ctx.commit(r, line)
    ctx.emit({ tag: id, label, result }, line)
  },
}

const rename: Command = {
  name: 'rename',
  summary: 'Change a tag\'s display label',
  positionals: [{ name: 'id', help: 'A tag in this record' }, { name: 'label', help: 'The new label (quote it if it has spaces)' }],
  examples: ['trustweb tag rename garden "Garden club"'],
  run(ctx) {
    const { id, bare } = tagId(ctx.positionals[0])
    const r = ctx.record()
    const e = requireTag(r, bare)
    const label = labelText(ctx.positionals[1])
    const previous = e.label
    if (previous === label) {
      ctx.emit({ tag: id, label, previous, changed: false }, `tag ${bare} is already labelled "${label}"; nothing changed`)
      return
    }
    e.label = label
    const line = `renamed tag ${bare} from "${previous}" to "${label}"`
    ctx.commit(r, line)
    ctx.emit({ tag: id, label, previous, changed: true }, line)
  },
}

const remove: Command = {
  name: 'remove',
  summary: 'Remove tags: mark them removed and close every tuple that names them',
  description: [
    'Carriers lose the tag, nesting ends both ways, its zone rules and grants end; the entry and the tuples stay as history.',
    'Every tag must be in the record and not removed yet; if one is not, nothing is changed.',
    'Share lines are not changed. A current share that names the tag in its scope is warned about: an exclusion',
    'through the tag no longer reaches the former carriers, who may then see the item through their zone.',
  ].join('\n'),
  positionals: [{ name: 'id', help: 'Tags in this record', variadic: true }],
  examples: ['trustweb tag remove choir', 'trustweb tag remove garden roses --json'],
  run(ctx) {
    const r = ctx.record()
    const ids = unique(ctx.positionals.map((t) => tagId(t).id))
    for (const t of ids) {
      const e = r.tags[bareOf(t)]
      if (e?.removedAt !== undefined) throw new CommandError(`tag ${bareOf(t)} was already removed (${e.removedAt}): run \`trustweb tag add ${bareOf(t)}\` to re-add it`)
      requireTag(r, bareOf(t))
    }
    const set = new Set(ids)
    const naming = (s: string): boolean => set.has(s)
    const byRelation: Record<string, number> = {}
    for (const t of liveTuples(r, ctx.now)) if (naming(t.subject) || naming(t.object)) byRelation[t.relation] = (byRelation[t.relation] ?? 0) + 1
    const at = ctx.now.toISOString()
    for (const t of ids) r.tags[bareOf(t)].removedAt = at
    const closed = closeFacts(r, (t) => naming(t.subject) || naming(t.object), ctx.now)
    const sorted = Object.fromEntries(Object.keys(byRelation).sort().map((k) => [k, byRelation[k]]))
    const detail = Object.entries(sorted).map(([k, n]) => `${n} ${k}`).join(', ')
    const line = `removed ${ids.length === 1 ? 'tag' : 'tags'} ${bareList(ids)} (${count(closed, 'tuple')} closed${detail ? `: ${detail}` : ''})`
    ctx.commit(r, line)
    for (const s of latestShares(r.shares)) {
      const named = ids.filter((t) => s.scope.include.includes(t) || s.scope.exclude.includes(t))
      for (const t of named) ctx.warn(`${t} is still named in the scope of ${s.id}; it no longer reaches anyone, so an exclusion through it stops applying`)
    }
    ctx.emit({ tags: ids, closed, byRelation: sorted }, line)
  },
}

const nestCmd: Command = {
  name: 'nest',
  summary: 'Nest a tag under another: every carrier of the child holds the parent too',
  description: 'A cycle, or a chain deeper than the share sink allows, is refused. Nesting that already stands is reported, not written again.',
  positionals: [{ name: 'child', help: 'The tag to nest' }, { name: 'parent', help: 'The tag above it' }],
  examples: ['trustweb tag nest roses garden'],
  run(ctx) {
    const child = tagId(ctx.positionals[0])
    const parent = tagId(ctx.positionals[1])
    const r = ctx.record()
    requireTag(r, child.bare)
    requireTag(r, parent.bare)
    if (hasLive(r, { subject: child.id, relation: 'nested_in', object: parent.id }, ctx.now)) {
      ctx.emit({ child: child.id, parent: parent.id, result: 'already' }, `${child.id} is already nested in ${parent.id}; nothing changed`)
      return
    }
    // The checks run on every nesting not yet ended at now, future-dated ones included: a nesting that was ended must not
    // block a new one, and one that begins later must not be cycled around.
    let next: Store
    try {
      next = nest(r.tuples.filter((t) => t.until === undefined || Date.parse(t.until) > +ctx.now), child.id, parent.id, r.device, ctx.now)
    } catch (e) {
      throw new CommandError((e as Error).message)
    }
    r.tuples.push(next[next.length - 1])
    const line = `nested tag ${child.bare} in ${parent.bare}`
    ctx.commit(r, line)
    ctx.emit({ child: child.id, parent: parent.id, result: 'nested' }, line)
  },
}

const unnest: Command = {
  name: 'unnest',
  summary: 'End a nesting: carriers of the child no longer hold the parent through it',
  positionals: [{ name: 'child', help: 'The nested tag' }, { name: 'parent', help: 'The tag it is nested in' }],
  examples: ['trustweb tag unnest roses garden'],
  run(ctx) {
    const child = tagId(ctx.positionals[0])
    const parent = tagId(ctx.positionals[1])
    const r = ctx.record()
    if (!hasLive(r, { subject: child.id, relation: 'nested_in', object: parent.id }, ctx.now)) throw new CommandError(`${child.id} is not nested in ${parent.id}; nothing to unnest (see \`trustweb tag list\`)`)
    const closed = closeFacts(r, (t) => t.subject === child.id && t.relation === 'nested_in' && t.object === parent.id, ctx.now)
    const line = `unnested tag ${child.bare} from ${parent.bare}`
    ctx.commit(r, line)
    ctx.emit({ child: child.id, parent: parent.id, closed }, line)
  },
}

export const tag: Command = {
  name: 'tag',
  summary: 'Tags: labels that open items and place carriers in zones',
  description: [
    'A tag is an id (garden, or tag:garden) with a label. Give it to persons with `trustweb person tag`,',
    'put its carriers in a zone with `trustweb zone add-tag`, and nest it under another with `trustweb tag nest`.',
  ].join('\n'),
  subcommands: [list, add, rename, remove, nestCmd, unnest],
  examples: ['trustweb tag add garden', 'trustweb tag nest roses garden', 'trustweb tag list', 'trustweb tag remove choir'],
}
