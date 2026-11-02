// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb zone`: the TrustZones ladder of this record. A zone is never made up: the eight rungs are fixed (zones.ts LADDER),
 * so "create" switches a rung on here and gives it a label, "archive" switches it off again (reversible: the members and
 * the rules stay, they just stop counting). Members are tuples: `person:<id> in_zone zone:<z>` for one person,
 * `tag:<t> in_zone zone:<z>` for everyone carrying the tag (a rule). Nothing is deleted; ending a membership closes it.
 */
import { CommandError, type Command } from '../cli.ts'
import {
  ZONE_LABELS, addFact, closeFacts, hasLive, isStructural, ladder, liveTuples, membersOf, requirePerson, requireTag,
  requireZone, zoneLabel, zoneOfPersonIn, zoneState, type ZoneState,
} from '../domain.ts'
import { personId, tagId, zoneOf } from '../ids.ts'
import { count, table } from '../output.ts'
import type { TrustRecord } from '../record.ts'
import { activeZones, effectiveZone, heldTags, latestShares, rank, type Zone } from '../sink.ts'

/** A label as typed, trimmed; an empty one is refused (a zone without words is unreadable in every listing). */
function labelText(text: string): string {
  const t = text.trim()
  if (!t) throw new CommandError('a label must not be empty')
  return t
}

/** Distinct persons in the zone right now, through any way in. */
const memberCount = (r: TrustRecord, z: Zone, now: Date): number => new Set(membersOf(r, z, now).map((m) => m.person)).size

const ruleTuples = (r: TrustRecord, z: Zone, now: Date) =>
  liveTuples(r, now).filter((t) => t.relation === 'in_zone' && t.object === `zone:${z}` && t.subject.startsWith('tag:'))

/** The same ids once each, in the order typed: `ada ada` is one person. */
const unique = (ids: readonly string[]): string[] => [...new Set(ids)]

const bareList = (ids: readonly string[]): string => ids.map((i) => i.slice(i.indexOf(':') + 1)).join(', ')

interface ZoneRow { zone: Zone; state: ZoneState; label: string; members: number; tags: number }

const list: Command = {
  name: 'list',
  summary: 'Show the whole ladder, outer to inner: state, label, members, tag rules',
  description: [
    'All eight rungs, always. State: always-on (public, self), on, archived, or not set up.',
    'members counts persons in the zone directly and through tag rules; tags counts the tag rules.',
  ].join('\n'),
  examples: ['trustweb zone list', 'trustweb zone list --json'],
  run(ctx) {
    const r = ctx.record()
    const rows: ZoneRow[] = ladder().map((z) => ({
      zone: z, state: zoneState(r, z), label: zoneLabel(r, z), members: memberCount(r, z, ctx.now), tags: ruleTuples(r, z, ctx.now).length,
    }))
    ctx.emit(rows, table(rows.map((x) => [x.zone, x.state, x.label, String(x.members), String(x.tags)]), ['zone', 'state', 'label', 'members', 'tags']))
  },
}

const create: Command = {
  name: 'create',
  summary: 'Set up a ladder zone here (switch it on, give it a label)',
  description: [
    'The ladder is fixed: public < intending < acquaintance < community < friend < close < closest < self.',
    'Public and self are always on and are never set up. The label defaults to the ladder\'s word for the zone.',
  ].join('\n'),
  positionals: [{ name: 'zone', help: 'A ladder zone: friend or zone:friend' }],
  options: [{ name: 'label', alias: 'l', kind: 'string', placeholder: '<text>', help: 'What this record calls the zone (default: the ladder\'s word)' }],
  examples: ['trustweb zone create friend', 'trustweb zone create close --label "Allies"'],
  run(ctx) {
    const z = zoneOf(ctx.positionals[0])
    const r = ctx.record()
    if (isStructural(z)) throw new CommandError(`zone ${z} is always on; there is nothing to set up`)
    const e = r.zones[z]
    if (e?.archivedAt !== undefined) throw new CommandError(`zone ${z} is set up but archived: run \`trustweb zone unarchive ${z}\``)
    if (e) throw new CommandError(`zone ${z} is already set up ("${e.label}"): run \`trustweb zone rename ${z} <label>\` to relabel it`)
    const label = typeof ctx.options.label === 'string' ? labelText(ctx.options.label) : ZONE_LABELS[z]
    r.zones[z] = { label, createdAt: ctx.now.toISOString() }
    const line = `set up zone ${z} ("${label}")`
    ctx.commit(r, line)
    ctx.emit({ zone: z, label, state: 'on' }, line)
  },
}

const rename: Command = {
  name: 'rename',
  summary: 'Give a set-up zone a new label (archived zones too)',
  positionals: [{ name: 'zone', help: 'A set-up ladder zone' }, { name: 'label', help: 'The new label (quote it if it has spaces)' }],
  examples: ['trustweb zone rename friend "Good friends"', 'trustweb zone rename zone:close Allies'],
  run(ctx) {
    const z = zoneOf(ctx.positionals[0])
    const r = ctx.record()
    const e = requireZone(r, z, 'set-up')
    const label = labelText(ctx.positionals[1])
    const previous = e.label
    if (previous === label) {
      ctx.emit({ zone: z, label, previous, changed: false }, `zone ${z} is already labelled "${label}"; nothing changed`)
      return
    }
    e.label = label
    const line = `renamed zone ${z} from "${previous}" to "${label}"`
    ctx.commit(r, line)
    ctx.emit({ zone: z, label, previous, changed: true }, line)
  },
}

const archive: Command = {
  name: 'archive',
  summary: 'Switch a zone off (reversible): its members count as the next zone out, its shares move one ring in',
  description: [
    'Nothing is deleted: memberships and tag rules stay and count again after `trustweb zone unarchive`.',
    'While archived, a person whose most intimate zone this was counts as their next zone that is on (public at worst),',
    'and an item shared to this zone opens only to the next zone in that is on (never further out).',
    'The consequences are counted and printed as warnings.',
  ].join('\n'),
  positionals: [{ name: 'zone', help: 'A zone that is on' }],
  examples: ['trustweb zone archive community', 'trustweb zone archive friend --json'],
  run(ctx) {
    const z = zoneOf(ctx.positionals[0])
    const r = ctx.record()
    const e = requireZone(r, z, 'set-up')
    if (e.archivedAt !== undefined) throw new CommandError(`zone ${z} is already archived (since ${e.archivedAt})`)
    const at = ctx.now.toISOString()
    // The consequences are measured on a copy, before and after, with the same check the app runs.
    const after: TrustRecord = structuredClone(r)
    after.zones[z] = { ...e, archivedAt: at }
    const members = [...new Set(membersOf(r, z, ctx.now).map((m) => m.person))]
    const lessIntimate = members.filter((p) => rank(zoneOfPersonIn(after, p, ctx.now)) < rank(zoneOfPersonIn(r, p, ctx.now))).length
    const shares = latestShares(r.shares).filter((s) => s.scope.zone === z).length
    const movedTo = effectiveZone(z, activeZones(after))
    e.archivedAt = at
    const line = `archived zone ${z} (${count(lessIntimate, 'person')} now less intimate, ${count(shares, 'share')} moved one ring in)`
    ctx.commit(r, line)
    if (lessIntimate) ctx.warn(`${count(lessIntimate, 'person')} in ${z} now ${lessIntimate === 1 ? 'counts' : 'count'} as a less intimate zone`)
    if (shares) ctx.warn(`${count(shares, 'item')} shared to ${z} now ${shares === 1 ? 'opens' : 'open'} only to ${movedTo} and closer (one ring in)`)
    ctx.emit({ zone: z, state: 'archived', archivedAt: at, membersLessIntimate: lessIntimate, sharesMoved: shares, movedTo }, line)
  },
}

const unarchive: Command = {
  name: 'unarchive',
  summary: 'Switch an archived zone back on',
  positionals: [{ name: 'zone', help: 'An archived zone' }],
  examples: ['trustweb zone unarchive community'],
  run(ctx) {
    const z = zoneOf(ctx.positionals[0])
    const r = ctx.record()
    const e = requireZone(r, z, 'set-up')
    if (e.archivedAt === undefined) throw new CommandError(`zone ${z} is not archived; it is on`)
    delete e.archivedAt
    const line = `unarchived zone ${z}`
    ctx.commit(r, line)
    ctx.emit({ zone: z, state: 'on' }, line)
  },
}

/** `id  result` lines for a per-id answer. */
const results = (rows: readonly { id: string; result: string }[]): string[] => table(rows.map((x) => [x.id, x.result]))

const addPerson: Command = {
  name: 'add-person',
  summary: 'Put persons in a zone directly',
  description: 'The zone must be on. A person already in the zone is reported as such; nothing is written for them.',
  positionals: [{ name: 'zone', help: 'A zone that is on' }, { name: 'person', help: 'Persons in this record (ada or person:ada)', variadic: true }],
  examples: ['trustweb zone add-person friend ada', 'trustweb zone add-person close bo cy --json'],
  run(ctx) {
    const z = zoneOf(ctx.positionals[0])
    const r = ctx.record()
    requireZone(r, z, 'on')
    const persons = unique(ctx.positionals.slice(1).map((p) => personId(p).id))
    for (const p of persons) requirePerson(r, p.slice('person:'.length))
    const rows = persons.map((p) => ({ person: p, result: addFact(r, { subject: p, relation: 'in_zone', object: `zone:${z}` }, ctx.now) ? 'added' : 'already in zone' }))
    const added = rows.filter((x) => x.result === 'added').map((x) => x.person)
    const line = `added ${bareList(added)} to zone ${z}`
    if (added.length) ctx.commit(r, line)
    ctx.emit({ zone: z, persons: rows }, [...results(rows.map((x) => ({ id: x.person, result: x.result }))), ...(added.length ? [line] : [])])
  },
}

/** Why a person is not a direct member, in words that say what to run instead. */
function notDirect(r: TrustRecord, z: Zone, p: string, now: Date): string {
  const name = p.slice('person:'.length)
  const via = membersOf(r, z, now).find((m) => m.person === p && m.via)?.via
  if (!via) return `${name} is not a member of zone ${z}`
  // The tag the person holds themselves (the first step of the path up to the rule's tag).
  const held = heldTags(liveTuples(r, now), p).get(via)?.[0]?.object ?? via
  return `${name} is in zone ${z} only through ${via}: run \`trustweb zone remove-tag ${z} ${via.slice('tag:'.length)}\` or \`trustweb person untag ${name} ${held.slice('tag:'.length)}\``
}

const removePerson: Command = {
  name: 'remove-person',
  summary: 'Take persons out of a zone (their direct membership ends; history stays)',
  description: [
    'Works on archived zones too, so people can be moved out before a zone is switched back on.',
    'Every person must be a direct member; if one is not, nothing is changed.',
    'A person in the zone only through a tag rule is left by `trustweb zone remove-tag` or `trustweb person untag`.',
  ].join('\n'),
  positionals: [{ name: 'zone', help: 'A set-up zone' }, { name: 'person', help: 'Direct members of the zone', variadic: true }],
  examples: ['trustweb zone remove-person friend ada', 'trustweb zone remove-person community bo cy'],
  run(ctx) {
    const z = zoneOf(ctx.positionals[0])
    const r = ctx.record()
    requireZone(r, z, 'set-up')
    const persons = unique(ctx.positionals.slice(1).map((p) => personId(p).id))
    for (const p of persons) {
      requirePerson(r, p.slice('person:'.length))
      if (!hasLive(r, { subject: p, relation: 'in_zone', object: `zone:${z}` }, ctx.now)) throw new CommandError(notDirect(r, z, p, ctx.now))
    }
    const set = new Set(persons)
    const closed = closeFacts(r, (t) => set.has(t.subject) && t.relation === 'in_zone' && t.object === `zone:${z}`, ctx.now)
    const line = `removed ${bareList(persons)} from zone ${z}`
    ctx.commit(r, line)
    ctx.emit({ zone: z, persons, closed }, line)
  },
}

const addTag: Command = {
  name: 'add-tag',
  summary: 'Add a tag rule: every carrier of the tag (and of tags nested under it) counts as in the zone',
  description: 'The zone must be on. The answer says how many persons the rules place in the zone that were not in it before.',
  positionals: [{ name: 'zone', help: 'A zone that is on' }, { name: 'tag', help: 'Tags in this record (garden or tag:garden)', variadic: true }],
  examples: ['trustweb zone add-tag friend garden', 'trustweb zone add-tag community choir roses --json'],
  run(ctx) {
    const z = zoneOf(ctx.positionals[0])
    const r = ctx.record()
    requireZone(r, z, 'on')
    const tags = unique(ctx.positionals.slice(1).map((t) => tagId(t).id))
    for (const t of tags) requireTag(r, t.slice('tag:'.length))
    const before = memberCount(r, z, ctx.now)
    const rows = tags.map((t) => ({ tag: t, result: addFact(r, { subject: t, relation: 'in_zone', object: `zone:${z}` }, ctx.now) ? 'added' : 'already in zone' }))
    const placed = memberCount(r, z, ctx.now) - before
    const added = rows.filter((x) => x.result === 'added').map((x) => x.tag)
    const line = `added ${added.length === 1 ? 'tag' : 'tags'} ${bareList(added)} to zone ${z} (places ${count(placed, 'more person', 'more persons')})`
    if (added.length) ctx.commit(r, line)
    ctx.emit({ zone: z, tags: rows, placed }, [...results(rows.map((x) => ({ id: x.tag, result: x.result }))), ...(added.length ? [line] : [])])
  },
}

const removeTag: Command = {
  name: 'remove-tag',
  summary: 'End tag rules in a zone (the carriers stay tagged; they stop counting as in the zone through it)',
  positionals: [{ name: 'zone', help: 'A set-up zone' }, { name: 'tag', help: 'Tags with a rule in the zone', variadic: true }],
  examples: ['trustweb zone remove-tag friend garden'],
  run(ctx) {
    const z = zoneOf(ctx.positionals[0])
    const r = ctx.record()
    requireZone(r, z, 'set-up')
    const tags = unique(ctx.positionals.slice(1).map((t) => tagId(t).id))
    for (const t of tags) {
      if (!hasLive(r, { subject: t, relation: 'in_zone', object: `zone:${z}` }, ctx.now)) throw new CommandError(`${t} has no rule in zone ${z}; nothing to remove (see \`trustweb zone list\`)`)
    }
    const before = memberCount(r, z, ctx.now)
    const set = new Set(tags)
    const closed = closeFacts(r, (t) => set.has(t.subject) && t.relation === 'in_zone' && t.object === `zone:${z}`, ctx.now)
    const left = before - memberCount(r, z, ctx.now)
    const line = `removed ${tags.length === 1 ? 'tag' : 'tags'} ${bareList(tags)} from zone ${z} (${count(left, 'person leaves', 'persons leave')})`
    ctx.commit(r, line)
    ctx.emit({ zone: z, tags, closed, left }, line)
  },
}

export const zone: Command = {
  name: 'zone',
  summary: 'Trust zones: the ladder, set up, rename, archive, members',
  description: [
    'The ladder is fixed, outer to inner: public < intending < acquaintance < community < friend < close < closest < self.',
    'Public and self are always on. The others are switched on here with `zone create` and off with `zone archive`.',
    'A person counts as the most intimate zone they are in among the zones on; public when none.',
    'To see who is in one zone and why, use `trustweb show zone <zone>`.',
  ].join('\n'),
  subcommands: [list, create, rename, archive, unarchive, addPerson, removePerson, addTag, removeTag],
  examples: [
    'trustweb zone list',
    'trustweb zone create friend --label "Friends"',
    'trustweb zone add-person friend ada bo',
    'trustweb zone add-tag friend garden',
    'trustweb zone archive friend',
  ],
}
