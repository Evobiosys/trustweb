// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb share`: share lines, the same ones the app's Share page appends (share_sink/share_lines.ts). A share is one
 * appended line: zone, then Also and Except (persons or tags); the latest line per item wins and a revoke line ends it.
 * Nothing is ever removed. The preview runs the app's canAccess on the same store enforcement uses (T12), so "n people
 * would see it" is exactly who will.
 */
import { UsageError, type Option } from '../args.ts'
import { CommandError, type Command, type Ctx } from '../cli.ts'
import { personLabel, requirePerson, requireTag, requireZone } from '../domain.ts'
import { itemId, parseId, zoneOf } from '../ids.ts'
import { count, table, when } from '../output.ts'
import type { TrustRecord } from '../record.ts'
import { Zone, activeZones, appendShare, latestShares, previewShare, storeOf, type Scope, type ShareLine } from '../sink.ts'
import { listedPersons, scopeOf, shareState } from './show.ts'

const SCOPE_OPTIONS: readonly Option[] = [
  { name: 'zone', kind: 'string', placeholder: '<zone>', help: 'The zone it is open to (and every zone inside it): public, intending, ..., closest' },
  { name: 'also', kind: 'list', placeholder: '<id>', help: 'Also open to this person or tag (ada, person:ada, tag:garden); repeatable' },
  { name: 'except', kind: 'list', placeholder: '<id>', help: 'Never open to this person or tag, whatever else allows it; repeatable' },
]

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** Reads item, --zone, --also, --except and checks each against the record. Refusals write nothing. */
function readScope(ctx: Ctx, r: TrustRecord): { item: string; scope: Scope } {
  const item = itemId(ctx.positionals[0]).id
  if (typeof ctx.options.zone !== 'string') throw new UsageError('--zone <zone> is needed: who is the item open to?')
  const z = zoneOf(ctx.options.zone)
  if (z === Zone.Self) throw new CommandError('zone self is not a share: an item is yours already; pick the zone to open it to, e.g. --zone friend')
  if (z !== Zone.Public) requireZone(r, z, 'on')
  const ids = (opt: 'also' | 'except'): string[] => [...new Set(listOf(ctx.options[opt]).map((t) => parseId(t, 'person', ['person', 'tag']).id))]
  const include = ids('also')
  const exclude = ids('except')
  const both = include.find((id) => exclude.includes(id))
  if (both) throw new UsageError(`${both} is in both --also and --except; an id sits in one list only`)
  for (const id of [...include, ...exclude]) {
    const bare = id.slice(id.indexOf(':') + 1)
    if (id.startsWith('person:')) requirePerson(r, bare)
    else requireTag(r, bare)
  }
  return { item, scope: { zone: z, include, exclude } }
}

/**
 * Who would see `item` under `scope`: the app's previewShare (T12: the same canAccess as enforcement) on the record's
 * store without this item's earlier lines (as share_page.ts previewOf), with the zones that are on, so a person whose
 * only zone is archived is not named here and then refused by `show item`.
 */
function previewOf(r: TrustRecord, item: string, scope: Scope, now: Date): { count: number; people: string[]; names: string[] } {
  const store = storeOf({ ...r, shares: r.shares.filter((l) => l.id !== item) }, now)
  const people = previewShare(store, scope, listedPersons(r), item, now, activeZones(r)).names
  return { count: people.length, people, names: people.map((p) => personLabel(r, p)) }
}

const previewLine = (item: string, p: { count: number; names: string[] }): string =>
  `${count(p.count, 'person', 'people')} would see ${item}${p.count ? `: ${p.names.join(', ')}` : ''}`

const scopeText = (s: Scope): string =>
  `zone ${s.zone}${s.include.length ? `, also ${s.include.join(', ')}` : ''}${s.exclude.length ? `, except ${s.exclude.join(', ')}` : ''}`

const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x) => b.includes(x))

const add: Command = {
  name: 'add',
  summary: 'Share an item with a zone, plus or minus persons and tags',
  description: [
    'Appends one share line. The item is open to everyone in the zone and in every zone inside it, plus --also, minus --except',
    '(an exception beats everything). The zone must be on (public always is); self is not a share. --also/--except ids must be',
    'in the record. Sharing an item again appends a new line that replaces the earlier one; the same scope again writes nothing.',
    'Then prints who would see it, by the same check enforcement runs. Names are printed: the CLI runs on the owner\'s',
    'device, for the owner (I2 hides them from askers, not from the owner).',
    '--json: {item, line, replaces: <iso> | null, count, people: [person], names: [label]} (plus already: true when nothing was written)',
  ].join('\n'),
  positionals: [{ name: 'item', help: 'An item id: bike or item:bike' }],
  options: SCOPE_OPTIONS,
  examples: [
    'trustweb share add bike --zone friend',
    'trustweb share add ladder --zone close --also bo --except tag:roses',
    'trustweb share add seeds --zone public --json',
  ],
  run(ctx) {
    const r = ctx.record()
    const { item, scope } = readScope(ctx, r)
    const p = previewOf(r, item, scope, ctx.now)
    const { live } = shareState(r, item)
    if (live && live.scope.zone === scope.zone && sameSet(live.scope.include, scope.include) && sameSet(live.scope.exclude, scope.exclude)) {
      ctx.emit({ item, already: true, line: live, replaces: null, ...p }, [`${item} is already shared with this scope (${scopeText(scope)}, since ${when(live.ts)}); nothing written.`, previewLine(item, p)])
      return
    }
    r.shares = appendShare(r.shares, { id: item, scope, to: `zone:${scope.zone}`, ts: ctx.now.toISOString() })
    const line = r.shares[r.shares.length - 1]
    const replaces = live ? live.ts : null
    const lines = [`Shared ${item} to ${scopeText(scope)}.`]
    if (replaces) lines.push(`replaces the share from ${when(replaces)} (${scopeText(live!.scope)})`)
    lines.push(previewLine(item, p))
    ctx.commit(r, `shared ${item} to ${scopeText(scope)}${replaces ? `, replacing the share from ${when(replaces)}` : ''}: ${count(p.count, 'person', 'people')} would see it`)
    ctx.emit({ item, line, replaces, ...p }, lines)
  },
}

const preview: Command = {
  name: 'preview',
  summary: 'Who would see an item under a scope; writes nothing',
  description: [
    'Takes what `share add` takes and checks it the same way, but writes nothing: the answer `share add` would print.',
    'The item\'s current share is left out, so this is who would see it if this scope replaced it.',
    '--json: {item, zone, count, people: [person], names: [label]}',
  ].join('\n'),
  positionals: [{ name: 'item', help: 'An item id: bike or item:bike' }],
  options: SCOPE_OPTIONS,
  examples: ['trustweb share preview bike --zone friend', 'trustweb share preview bike --zone close --also tag:garden --json'],
  run(ctx) {
    const r = ctx.record()
    const { item, scope } = readScope(ctx, r)
    const p = previewOf(r, item, scope, ctx.now)
    ctx.emit({ item, zone: scope.zone, ...p }, previewLine(item, p))
  },
}

const dash = (xs: readonly string[]): string => (xs.length ? xs.join(',') : '-')

/** The item a line is about: a share's id, a revoke's or retract's target, an agreement's id. */
const subjectOf = (l: ShareLine): string => (l.op === 'share' ? l.id : l.op === 'agree' ? l.agreement : l.target)

/** One row of `share list --all`: the scope columns exist for share lines only. */
interface AllRow { seq: number; op: ShareLine['op']; item: string; zone?: string; also?: string[]; except?: string[]; when: string; live: boolean | null }

const list: Command = {
  name: 'list',
  summary: 'The live share of each item (--all: every line ever appended)',
  description: [
    'One row per shared item: its latest share line, unless a revoke ended it. --all lists every line in the order appended,',
    'superseded shares and revokes included, with `live` saying which share line counts now.',
    '--json: [{item, zone, also: [id], except: [id], since, seq}]',
    '--all --json: [{seq, op, item, zone?, also?, except?, when, live: true|false (share lines) | null (other lines)}]',
  ].join('\n'),
  options: [{ name: 'all', kind: 'flag', help: 'Every line, superseded and revoked ones included' }],
  examples: ['trustweb share list', 'trustweb share list --all', 'trustweb share list --json'],
  run(ctx) {
    const r = ctx.record()
    const latest = latestShares(r.shares)
    const empty = 'no shares yet: trustweb share add <item> --zone <zone>'
    if (ctx.options.all === true) {
      const rows = r.shares.map((l): AllRow => {
        const base = { seq: l.seq, op: l.op, item: subjectOf(l) }
        if (l.op !== 'share') return { ...base, when: l.ts, live: null }
        return { ...base, zone: l.scope.zone, also: [...l.scope.include], except: [...l.scope.exclude], when: l.ts, live: latest.includes(l) }
      })
      const text = rows.map((x) => [String(x.seq), x.op, x.item, x.zone ?? '-', x.also ? dash(x.also) : '-', x.except ? dash(x.except) : '-', when(x.when), x.live === null ? '-' : x.live ? 'yes' : 'no'])
      ctx.emit(rows, table(text, ['seq', 'op', 'item', 'zone', 'also', 'except', 'when', 'live'], empty))
      return
    }
    const rows = latest.map((l) => ({ item: l.id, ...scopeOf(l) }))
    ctx.emit(rows, table(rows.map((x) => [x.item, x.zone, dash(x.also), dash(x.except), when(x.since), String(x.seq)]), ['item', 'zone', 'also', 'except', 'since', 'seq'], empty))
  },
}

const revoke: Command = {
  name: 'revoke',
  summary: 'End an item\'s share (appends a revoke line)',
  description: [
    'Appends a revoke line for the item\'s live share; from then on no share opens it (a direct grant tuple still would).',
    'The earlier lines stay in the record. An item with no live share is refused. `share add` shares it again.',
    '--json: {item, line, was: {zone, also, except, since, seq}}',
  ].join('\n'),
  positionals: [{ name: 'item', help: 'An item id: bike or item:bike' }],
  examples: ['trustweb share revoke bike', 'trustweb share revoke item:bike --json'],
  run(ctx) {
    const item = itemId(ctx.positionals[0]).id
    const r = ctx.record()
    const { live } = shareState(r, item)
    if (!live) throw new CommandError(`${item} has no live share: nothing to revoke (see \`trustweb share list\`)`)
    // seq as appendShare counts it: the line's place in the record, so `at` names the head after this line.
    const seq = r.shares.length + 1
    const line: ShareLine = { op: 'revoke', id: `rev:${seq}`, seq, target: item, at: seq, ts: ctx.now.toISOString() }
    r.shares = [...r.shares, line]
    const was = scopeOf(live)
    ctx.commit(r, `revoked the share of ${item} (was ${scopeText(live.scope)}, since ${when(live.ts)})`)
    ctx.emit({ item, line, was }, `Revoked the share of ${item} (was ${scopeText(live.scope)}, since ${when(live.ts)}).`)
  },
}

export const share: Command = {
  name: 'share',
  summary: 'Share lines: what an item is open to',
  description: [
    'A share opens an item to a zone (and the zones inside it), plus persons or tags (--also), minus persons or tags',
    '(--except). Each change appends a line; the latest line per item counts. `trustweb show item <item>` says who sees it.',
  ].join('\n'),
  subcommands: [add, list, preview, revoke],
  examples: ['trustweb share add bike --zone friend --also bo', 'trustweb share preview bike --zone close', 'trustweb share list', 'trustweb share revoke bike'],
}
