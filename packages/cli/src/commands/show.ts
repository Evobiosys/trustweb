// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb show`: what a zone, tag, person or item can see, and why. Read-only. Every answer is the app's own canAccess on
 * storeOf(record) with the zones that are on, so `show` says exactly what enforcement does. A zone or a tag is not a
 * person, so for them the question is put to a PROBE: a person who exists nowhere, given one tuple (in that zone, or
 * carrying that tag). That answers "a person whose only standing is this zone / this tag", which is what a member or a
 * carrier gets at least; a real person may see more through their other zones, tags and grants.
 */
import type { Command } from '../cli.ts'
import { membersOf, personLabel, zoneLabel, zoneState } from '../domain.ts'
import { itemId, personId, tagId, zoneOf } from '../ids.ts'
import { when } from '../output.ts'
import type { TrustRecord } from '../record.ts'
import {
  Zone, activeZones, canAccess, effectiveZone, heldTags, isLive, latestShares, personIds, personZone, storeOf, toMarkdown, unfoldTagRules,
  type ShareOp, type Store, type Tuple,
} from '../sink.ts'

// ---- shared with share.ts ---------------------------------------------------------------------------------------

/** Not a valid bare id (it starts with `_`), so it can never be a person of the record. */
export const PROBE = 'person:_probe'

export interface WhyLine { subject: string; relation: string; object: string }
export interface Seen { item: string; why: WhyLine[] }

export const whyLines = (why: readonly Tuple[]): WhyLine[] => why.map((t) => ({ subject: t.subject, relation: t.relation, object: t.object }))

/** The items a store speaks of: objects of live may_read / may_write tuples (latest shares and direct grants), sorted. */
export function itemsOf(store: Store, now: Date): string[] {
  const live = store.filter((t) => isLive(t, now) && (t.relation === 'may_read' || t.relation === 'may_write') && /^(item|file):/.test(t.object))
  return [...new Set(live.map((t) => t.object))].sort()
}

/** What `person` can see in `store`, item by item, with canAccess's why. */
export function seenIn(store: Store, person: string, now: Date, active: readonly Zone[]): Seen[] {
  return itemsOf(store, now).flatMap((item) => {
    const a = canAccess(store, person, item, now, active)
    return a.allowed ? [{ item, why: whyLines(a.why) }] : []
  })
}

/**
 * The record's store plus the probe's one tuple. A tag rule (`tag:x in_zone zone:z`) is unfolded for the probe too, with
 * sink.ts's own unfolding, so a tag placed in a zone opens that zone's items to its probe as it does to its carriers.
 */
export function probeStore(r: TrustRecord, relation: 'in_zone' | 'has_tag', object: string, now: Date): Store {
  const probe: Tuple = { subject: PROBE, relation, object, since: now.toISOString(), by: 'probe' }
  return [...storeOf(r, now), probe, ...unfoldTagRules([...r.tuples, probe], [PROBE], now)]
}

/** The persons a "who can see" list names: every person the record knows (sink.personIds), less the removed ones. */
export const listedPersons = (r: TrustRecord): string[] => personIds(r).filter((p) => r.persons[p.slice('person:'.length)]?.removedAt === undefined)

/** `  person:ada  ada (Ada)  via tag:x`, the id column padded across the rows. */
export function personRows(rows: readonly { person: string; label: string; via?: string }[], none = '(nobody)'): string[] {
  if (!rows.length) return [`  ${none}`]
  const w = Math.max(...rows.map((r) => r.person.length))
  return rows.map((r) => `  ${r.person.padEnd(w)}  ${r.label}${r.via ? `  via ${r.via}` : ''}`)
}

/** An item and its why-lines, as export.ts prints them, indented under a heading. */
export const seenLines = (seen: readonly Seen[], none = '(nothing)'): string[] =>
  seen.length ? seen.flatMap((s) => [`  ${s.item}`, ...s.why.map((t) => `    - ${t.subject} ${t.relation} ${t.object}`)]) : [`  ${none}`]

const list = (xs: readonly string[]): string => (xs.length ? xs.join(', ') : '(none)')

/** The scope of a share line, as `share list` and `show item` print it. */
export const scopeOf = (l: ShareOp): { zone: Zone; also: string[]; except: string[]; since: string; seq: number } =>
  ({ zone: l.scope.zone, also: [...l.scope.include], except: [...l.scope.exclude], since: l.ts, seq: l.seq })

// ---- show zone --------------------------------------------------------------------------------------------------

const zone: Command = {
  name: 'zone',
  summary: 'What a member of a zone can see, and who the members are',
  description: [
    'Prints the zone\'s state and label, its members (directly, or through a tag rule: `via tag:x`), and every item a member',
    'can see with the tuples that allow it. "Can see" is asked of a probe person (person:_probe) whose only standing is',
    '`person:_probe in_zone zone:<zone>`: what membership alone gives. A member may see more through their own tags and grants.',
    'An archived or not set up zone does not count: its probe counts as public, and items shared to it move one ring in.',
    '--json: {zone, state, label, members: [{person, via?}], items: [{item, why: [{subject, relation, object}]}]}',
  ].join('\n'),
  positionals: [{ name: 'zone', help: 'A ladder zone: public, intending, acquaintance, community, friend, close, closest, self' }],
  examples: ['trustweb show zone friend', 'trustweb show zone close --json', 'trustweb show zone public'],
  run(ctx) {
    const z = zoneOf(ctx.positionals[0])
    const r = ctx.record()
    const active = activeZones(r)
    const state = zoneState(r, z)
    const members = membersOf(r, z, ctx.now)
    const items = seenIn(probeStore(r, 'in_zone', `zone:${z}`, ctx.now), PROBE, ctx.now, active)
    const label = zoneLabel(r, z)
    const lines = [`zone ${z}`, `state: ${state}`, `label: ${label}`]
    if (state === 'archived' || state === 'not set up') {
      lines.push(`zone ${z} is ${state}: a member counts as public unless another zone of theirs is on; items shared to ${z} move in to ${effectiveZone(z, active)}`)
    }
    lines.push('Members:', ...personRows(members.map((m) => ({ person: m.person, label: personLabel(r, m.person), via: m.via }))))
    lines.push('Can see:', ...seenLines(items))
    ctx.emit({ zone: z, state, label, members, items }, lines)
  },
}

// ---- show tag ---------------------------------------------------------------------------------------------------

const tag: Command = {
  name: 'tag',
  summary: 'What a tag opens, who carries it, and where it sits',
  description: [
    'Prints the tag\'s label, its parents and children (nested_in), the zones it is placed in (tag rules), its carriers',
    '(directly, and separately those who carry a tag nested under it), and every item it opens with the tuples that allow it.',
    '"Opens" is asked of a probe person (person:_probe) whose only standing is `person:_probe has_tag tag:<tag>`, tag rules',
    'included: what carrying the tag alone gives.',
    '--markdown prints the share sink\'s own page for the tag (export.ts toMarkdown) instead.',
    '--json: {tag, label, state: known|removed|unknown, parents: [tag], children: [tag], zones: [zone],',
    '         carriers: {direct: [person], nested: [{person, via: tag}]}, items: [{item, why: [{subject, relation, object}]}]}',
  ].join('\n'),
  positionals: [{ name: 'tag', help: 'A tag id: garden or tag:garden' }],
  options: [{ name: 'markdown', kind: 'flag', help: 'Print the share sink\'s Markdown page for the tag' }],
  examples: ['trustweb show tag garden', 'trustweb show tag tag:roses --json', 'trustweb show tag garden --markdown > garden.md'],
  run(ctx) {
    const t = tagId(ctx.positionals[0])
    const r = ctx.record()
    const active = activeZones(r)
    const store = storeOf(r, ctx.now)
    if (ctx.options.markdown === true) return void ctx.io.stdout(toMarkdown(store, t.id, ctx.now, active))
    const entry = r.tags[t.bare]
    const state = entry === undefined ? 'unknown' : entry.removedAt === undefined ? 'known' : 'removed'
    if (state === 'unknown') ctx.warn(`the record does not know ${t.id}`)
    const live = store.filter((x) => isLive(x, ctx.now))
    const parents = live.filter((x) => x.relation === 'nested_in' && x.subject === t.id).map((x) => x.object).sort()
    const children = live.filter((x) => x.relation === 'nested_in' && x.object === t.id).map((x) => x.subject).sort()
    const zones = live.filter((x) => x.relation === 'in_zone' && x.subject === t.id).map((x) => x.object).sort()
    const direct: string[] = []
    const nested: { person: string; via: string }[] = []
    for (const p of personIds(r)) {
      const path = heldTags(live, p).get(t.id)
      if (!path) continue
      if (path.length === 1) direct.push(p)
      else nested.push({ person: p, via: path[0].object })
    }
    const items = seenIn(probeStore(r, 'has_tag', t.id, ctx.now), PROBE, ctx.now, active)
    const label = entry?.label ?? t.bare
    const lines = [`tag ${t.bare}`, `label: ${label}`]
    if (entry?.removedAt) lines.push(`removed: ${when(entry.removedAt)}`)
    lines.push(`parents: ${list(parents)}`, `children: ${list(children)}`, `zones: ${list(zones)}`)
    lines.push('Carried by:', ...personRows(direct.map((p) => ({ person: p, label: personLabel(r, p) }))))
    if (nested.length) lines.push('Through nested tags:', ...personRows(nested.map((n) => ({ person: n.person, label: personLabel(r, n.person), via: n.via }))))
    lines.push('Opens:', ...seenLines(items))
    ctx.emit({ tag: t.id, label, state, parents, children, zones, carriers: { direct, nested }, items }, lines)
  },
}

// ---- show person ------------------------------------------------------------------------------------------------

const person: Command = {
  name: 'person',
  summary: 'What a person can see, and why: their zone, their tags, the items',
  description: [
    'Prints the person\'s zone (the most intimate zone of theirs that is on, with the tuple that puts them there; a tag rule',
    'names its tag), the tags they hold (with the nesting path when held through a child tag), and every item they can see',
    'with the tuples that allow it: the app\'s canAccess on this record. A person the record does not know still gets an',
    'answer (public, and what public sees), with a warning.',
    '--markdown prints the share sink\'s own page for the person (export.ts toMarkdown) instead.',
    '--json: {person, name, state: known|removed|unknown, zone, zoneWhy: {subject, relation, object, tag?} | null,',
    '         tags: [{tag, via: [tag]}], items: [{item, why: [{subject, relation, object}]}]}',
  ].join('\n'),
  positionals: [{ name: 'person', help: 'A person id: ada or person:ada' }],
  options: [{ name: 'markdown', kind: 'flag', help: 'Print the share sink\'s Markdown page for the person' }],
  examples: ['trustweb show person ada', 'trustweb show person person:cy --json', 'trustweb show person ada --markdown > ada.md'],
  run(ctx) {
    const p = personId(ctx.positionals[0])
    const r = ctx.record()
    const active = activeZones(r)
    const store = storeOf(r, ctx.now)
    if (ctx.options.markdown === true) return void ctx.io.stdout(toMarkdown(store, p.id, ctx.now, active))
    const entry = r.persons[p.bare]
    const state = entry === undefined && !personIds(r).includes(p.id) ? 'unknown' : entry?.removedAt !== undefined ? 'removed' : 'known'
    if (state === 'unknown') ctx.warn(`the record does not know ${p.id}`)
    const z = personZone(store, p.id, ctx.now, active)
    const zoneWhy = z.tuple ? { subject: z.tuple.subject, relation: z.tuple.relation, object: z.tuple.object, ...(z.tuple.tag && { tag: z.tuple.tag }) } : null
    const live = store.filter((x) => isLive(x, ctx.now))
    const tags = [...heldTags(live, p.id)].map(([t, path]) => ({ tag: t, via: path.filter((x) => x.relation === 'nested_in').map((x) => x.subject) }))
    const items = seenIn(store, p.id, ctx.now, active)
    const name = entry?.name ?? p.bare
    const lines = [`person ${p.bare}`, `name: ${name}`]
    if (entry?.removedAt) lines.push(`removed: ${when(entry.removedAt)}`)
    const because = zoneWhy ? `${zoneWhy.subject} ${zoneWhy.relation} ${zoneWhy.object}${zoneWhy.tag ? `, through ${zoneWhy.tag}` : ''}` : 'no zone'
    lines.push(`zone: ${z.zone} (${because})`)
    lines.push(`tags: ${list(tags.map((t) => (t.via.length ? `${t.tag} (via ${t.via.join(', ')})` : t.tag)))}`)
    lines.push('Can see:', ...seenLines(items))
    ctx.emit({ person: p.id, name, state, zone: z.zone, zoneWhy, tags, items }, lines)
  },
}

// ---- show item --------------------------------------------------------------------------------------------------

/** The latest live share of an item, and the latest line about it at all (to tell "never shared" from "revoked"). */
export function shareState(r: TrustRecord, item: string): { live?: ShareOp; revokedAt?: string } {
  const live = latestShares(r.shares).find((l) => l.id === item)
  if (live) return { live }
  const last = [...r.shares].reverse().find((l) => (l.op === 'share' ? l.id : l.op === 'agree' ? '' : l.target) === item)
  return last && last.op === 'revoke' ? { revokedAt: last.ts } : {}
}

const item: Command = {
  name: 'item',
  summary: 'Who can see an item now, and why; its share scope',
  description: [
    'Prints the latest share line of the item (zone, also, except, since, seq) or "not shared", then every person the record',
    'knows (removed persons left out) who can see it now, each with the tuples that allow it: the app\'s canAccess.',
    'A direct grant tuple counts even when the item is not shared. Names are shown: this runs on the owner\'s device.',
    '--json: {item, share: {zone, also: [id], except: [id], since, seq} | null, people: [{person, label, why: [{subject, relation, object}]}]}',
  ].join('\n'),
  positionals: [{ name: 'item', help: 'An item id: bike or item:bike' }],
  examples: ['trustweb show item bike', 'trustweb show item item:bike --json'],
  run(ctx) {
    const i = itemId(ctx.positionals[0])
    const r = ctx.record()
    const active = activeZones(r)
    const store = storeOf(r, ctx.now)
    const { live, revokedAt } = shareState(r, i.id)
    const people = listedPersons(r).flatMap((p) => {
      const a = canAccess(store, p, i.id, ctx.now, active)
      return a.allowed ? [{ person: p, label: personLabel(r, p), why: whyLines(a.why) }] : []
    })
    const lines = [`item ${i.bare}`]
    if (live) {
      const s = scopeOf(live)
      const moved = effectiveZone(s.zone, active)
      lines.push(`zone: ${s.zone}${moved !== s.zone ? ` (${zoneState(r, s.zone)}: counts as ${moved})` : ''}`)
      lines.push(`also: ${list(s.also)}`, `except: ${list(s.except)}`, `since: ${when(s.since)} (seq ${s.seq})`)
    } else {
      lines.push(revokedAt ? `not shared (revoked ${when(revokedAt)})` : 'not shared')
    }
    lines.push('Who can see it now:')
    if (!people.length) lines.push('  (nobody)')
    const w = Math.max(0, ...people.map((p) => p.person.length))
    for (const p of people) lines.push(`  ${p.person.padEnd(w)}  ${p.label}`, ...p.why.map((t) => `    - ${t.subject} ${t.relation} ${t.object}`))
    ctx.emit({ item: i.id, share: live ? scopeOf(live) : null, people }, lines)
  },
}

export const show: Command = {
  name: 'show',
  summary: 'What a zone, tag, person or item can see, and why',
  description: [
    'Read-only. Every answer is the app\'s own check (share_sink canAccess) on this record, with archived zones switched off,',
    'and lists the tuples that allow each item. Nothing here writes to the record.',
  ].join('\n'),
  subcommands: [zone, tag, person, item],
  examples: ['trustweb show zone friend', 'trustweb show tag garden', 'trustweb show person ada', 'trustweb show item bike --json'],
}
