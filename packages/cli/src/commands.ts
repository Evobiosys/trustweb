// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * The command table: one entry per subcommand, each with its usage, its help text, its flags and its handler. `trustweb <cmd> --help`
 * and `trustweb help <cmd>` print the same text from here, so every subcommand has help by construction (and a test checks each).
 */
import { toJsonl } from '../../../apps/trustweb/src/share_sink/export'
import type { FlagSpec } from './args'
import { CliError, usage } from './errors'
import { type Sight, effectiveZoneOf, holdersOf, sees, storeOf, zoneMembers } from './derive'
import type { Io } from './io'
import * as ops from './ops'
import { type CliRecord, LEVELS, emptyRecord, parseRecord, serialize } from './record'

export interface Ctx {
  io: Io
  args: string[]
  flags: Record<string, string | boolean | string[]>
  now: Date
  recordPath: string
}

export interface Command {
  /** Arguments after the command words, as shown in usage. */
  usage: string
  summary: string
  /** The paragraph(s) under the usage line. */
  details: string
  options?: readonly (readonly [string, string])[]
  flags?: FlagSpec
  /** How many arguments it takes: exactly [n, n], or at least [n, Infinity]. */
  arity: readonly [number, number]
  run(ctx: Ctx): void
}

export const GLOBAL_FLAGS: FlagSpec = { record: { kind: 'string' }, now: { kind: 'string' }, help: { kind: 'bool', short: 'h' } }
export const GLOBAL_OPTIONS: readonly (readonly [string, string])[] = [
  ['--record <path>', 'the record file (default: $TRUSTWEB_RECORD, else ./trustweb-record.json)'],
  ['--now <date>', 'the time to act and answer at, ISO 8601 (default: the clock)'],
  ['-h, --help', 'show help for this command'],
]

// ---------------------------------------------------------------------------------------------------------------- record file

function load(ctx: Ctx): CliRecord {
  if (!ctx.io.exists(ctx.recordPath)) throw new CliError(`no record at ${ctx.recordPath}; run: trustweb init`)
  try {
    return parseRecord(ctx.io.readFile(ctx.recordPath))
  } catch (e) {
    throw new CliError(`${ctx.recordPath}: ${(e as Error).message}`)
  }
}

const save = (ctx: Ctx, r: CliRecord): void => ctx.io.writeFile(ctx.recordPath, serialize(r))

/** Load, change, save, say what changed. */
function mutate(ctx: Ctx, fn: (r: CliRecord) => ops.Change): void {
  const { record, message } = fn(load(ctx))
  save(ctx, record)
  ctx.io.out(`${message}\n`)
}

/** Refuse to replace a file unless --force; with --force the old file goes to archive/ first (never deleted). */
function makeRoom(ctx: Ctx, path: string, what: string): void {
  if (!ctx.io.exists(path)) return
  if (!ctx.flags.force) throw new CliError(`${what} exists at ${path} (use --force to move it to archive/ and replace it)`)
  ctx.io.out(`moved the old ${what} to ${ctx.io.moveToArchive(path)}\n`)
}

// ---------------------------------------------------------------------------------------------------------------- output

const str = (f: Ctx['flags'], k: string): string | undefined => f[k] as string | undefined
const strs = (f: Ctx['flags'], k: string): string[] => (f[k] as string[] | undefined) ?? []
const json = (ctx: Ctx, value: unknown): void => ctx.io.out(`${JSON.stringify(value, null, 2)}\n`)

/** Columns padded to the widest cell; no trailing spaces. */
export function table(rows: readonly (readonly string[])[]): string {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)))
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd()).join('\n') + '\n'
}

const placed = (r: CliRecord, id: string): string[] => {
  const m = zoneMembers(r, id)
  return [...new Set([...m.people, ...m.viaTags.map((v) => v.person)])].sort()
}

function sightText(s: Sight): string {
  const head = s.items.length ? `${s.target} can see ${s.items.length} item${s.items.length === 1 ? '' : 's'}` : `${s.target} can see nothing`
  const notes = s.notes.map((n) => `note: ${n}`)
  const items = s.items.flatMap((i) => [i.item, ...i.why.map((w) => `  because ${w}`)])
  return [head, ...notes, ...items].join('\n') + '\n'
}

function sightMarkdown(s: Sight): string {
  const notes = s.notes.length ? `${s.notes.map((n) => `> ${n}`).join('\n')}\n\n` : ''
  const items = s.items.length ? s.items.map((i) => `- ${i.item}\n${i.why.map((w) => `  - ${w}`).join('\n')}`).join('\n') : '- nothing'
  return `# ${s.target}\n\n${notes}## Can see\n\n${items}\n`
}

// ---------------------------------------------------------------------------------------------------------------- commands

export const COMMANDS: Readonly<Record<string, Command>> = {
  init: {
    usage: '[--device <id>] [--force]',
    summary: 'create an empty record with the seven built-in zones',
    details: 'Creates the record file with one built-in zone per level of the TrustZones ladder (public, intending, acquaintance,\n' +
      'community, friend, close, closest). Self is the owner alone and is not a zone anyone is put in.',
    options: [['--device <id>', 'the device named as the writer of every tuple (default: cli)'], ['--force', 'move an existing record to archive/ first']],
    flags: { device: { kind: 'string' }, force: { kind: 'bool' } },
    arity: [0, 0],
    run(ctx) {
      const device = ops.checkId(str(ctx.flags, 'device') ?? 'cli', 'device')
      makeRoom(ctx, ctx.recordPath, 'record')
      save(ctx, emptyRecord(ctx.now, `device:${device}`))
      ctx.io.out(`created ${ctx.recordPath} with ${LEVELS.length} built-in zones\n`)
    },
  },

  'zone list': {
    usage: '[--all] [--json]',
    summary: 'list the trust zones',
    details: 'Lists the zones, built-in ones first, then in the order they were created: id, level, kind, how many people they place, and name.\n' +
      'Archived zones are left out unless --all is given.',
    options: [['--all', 'include archived zones'], ['--json', 'print JSON (each zone with the people it places)']],
    flags: { all: { kind: 'bool' }, json: { kind: 'bool' } },
    arity: [0, 0],
    run(ctx) {
      const r = load(ctx)
      const zones = r.zones.filter((z) => ctx.flags.all || !z.archivedAt)
      if (ctx.flags.json) return json(ctx, zones.map((z) => ({ ...z, placed: placed(r, z.id) })))
      ctx.io.out(table([['ID', 'LEVEL', 'KIND', 'PEOPLE', 'NAME'], ...zones.map((z) => [
        z.id, z.level, z.builtin ? 'built-in' : 'created', String(placed(r, z.id).length), `${z.name}${z.archivedAt ? ' (archived)' : ''}`,
      ])]))
    },
  },

  'zone create': {
    usage: '<id> --level <level> [--name <name>]',
    summary: 'create a named trust zone on a level',
    details: 'Creates a zone that places its members on a level of the ladder. A created zone never opens more than its level:\n' +
      'whatever is shared to that level, its members see. Levels: ' + LEVELS.join(', ') + '.',
    options: [['--level <level>', 'the ladder level the zone sits on (required)'], ['--name <name>', 'a display name (default: the id)']],
    flags: { level: { kind: 'string' }, name: { kind: 'string' } },
    arity: [1, 1],
    run(ctx) {
      const level = str(ctx.flags, 'level')
      if (level === undefined) throw usage('zone create needs --level <level>')
      mutate(ctx, (r) => ops.createZone(r, ctx.args[0], level, str(ctx.flags, 'name'), ctx.now))
    },
  },

  'zone rename': {
    usage: '<id> <name...>',
    summary: 'give a zone a new display name',
    details: 'Changes the name only; the id, the level and the members stay. Built-in zones can be renamed too.\n' +
      'The words after the id are joined with spaces, so quoting is optional.',
    arity: [2, Infinity],
    run(ctx) {
      mutate(ctx, (r) => ops.renameZone(r, ctx.args[0], ctx.args.slice(1).join(' '), ctx.now))
    },
  },

  'zone archive': {
    usage: '<id>',
    summary: 'archive a zone (nothing is deleted)',
    details: 'A created zone stops placing anyone. A built-in zone is a ring switched off: someone only in it counts as the\n' +
      'next ring out, and what was shared to it reaches the next ring in that is on (never further out). Public cannot be\n' +
      'archived. Undo with: trustweb zone restore <id>.',
    arity: [1, 1],
    run(ctx) {
      mutate(ctx, (r) => ops.archiveZone(r, ctx.args[0], ctx.now))
    },
  },

  'zone restore': {
    usage: '<id>',
    summary: 'bring an archived zone back',
    details: 'Clears the archive stamp: the zone places its members again (a built-in zone: its ring is on again).',
    arity: [1, 1],
    run(ctx) {
      mutate(ctx, (r) => ops.restoreZone(r, ctx.args[0], ctx.now))
    },
  },

  'zone add': {
    usage: '<id> <person:<id>|tag:<id>>...',
    summary: 'add people or tags to a zone',
    details: 'A person member sits on the zone\'s level. A tag member places everyone who holds the tag, nested tags included.\n' +
      'People and tags the record does not know yet are added to it. All or nothing: one bad member refuses the lot.',
    arity: [2, Infinity],
    run(ctx) {
      mutate(ctx, (r) => ops.addMembers(r, ctx.args[0], ctx.args.slice(1), ctx.now))
    },
  },

  'zone remove': {
    usage: '<id> <person:<id>|tag:<id>>...',
    summary: 'take people or tags out of a zone',
    details: 'Takes the members out of this zone only; the people and tags stay in the record.',
    arity: [2, Infinity],
    run(ctx) {
      mutate(ctx, (r) => ops.removeMembers(r, ctx.args[0], ctx.args.slice(1), ctx.now))
    },
  },

  'zone show': {
    usage: '<id> [--json]',
    summary: 'show one zone: level, state, members and the people it places',
    details: 'Shows a zone\'s name, level, kind, dates, its members, and every person it places (through tags too).',
    options: [['--json', 'print JSON']],
    flags: { json: { kind: 'bool' } },
    arity: [1, 1],
    run(ctx) {
      const r = load(ctx)
      const z = ops.findZone(r, ctx.args[0])
      const m = zoneMembers(r, z.id)
      if (ctx.flags.json) return json(ctx, { ...z, placed: placed(r, z.id), viaTags: m.viaTags })
      const via = (tag: string): string => m.viaTags.filter((v) => `tag:${v.tag}` === tag).map((v) => v.person).join(', ') || 'nobody yet'
      ctx.io.out([
        `zone ${z.id} "${z.name}"`,
        `level:    ${z.level} (${z.builtin ? 'built-in' : 'created'})`,
        `created:  ${z.createdAt}`,
        `archived: ${z.archivedAt ?? 'no'}`,
        'members:',
        ...(z.members.length ? z.members.map((x) => (x.startsWith('tag:') ? `  ${x} (holders: ${via(x)})` : `  ${x}`)) : ['  none']),
        `places:   ${placed(r, z.id).join(', ') || 'nobody'}`,
      ].join('\n') + '\n')
    },
  },

  'person list': {
    usage: '[--json]',
    summary: 'list the people, each with the zone they count in and their tags',
    details: 'The zone is the most intimate ring that is on among the zones that place the person (public when none does).',
    options: [['--json', 'print JSON']],
    flags: { json: { kind: 'bool' } },
    arity: [0, 0],
    run(ctx) {
      const r = load(ctx)
      const rows = r.people.map((p) => ({ id: p.id, name: p.name, zone: effectiveZoneOf(r, p.id, ctx.now), tags: p.tags }))
      if (ctx.flags.json) return json(ctx, rows)
      if (!rows.length) return ctx.io.out('no people yet (add one: trustweb person add <id>)\n')
      ctx.io.out(table([['ID', 'ZONE', 'TAGS', 'NAME'], ...rows.map((p) => [p.id, p.zone, p.tags.join(',') || '-', p.name ?? ''])]))
    },
  },

  'person add': {
    usage: '<id> [--name <name>]',
    summary: 'add a person to the record',
    details: 'Adds a person with no zone and no tags. Use made-up or local ids: the record never leaves this device.',
    options: [['--name <name>', 'a display name']],
    flags: { name: { kind: 'string' } },
    arity: [1, 1],
    run(ctx) {
      mutate(ctx, (r) => ops.addPerson(r, ctx.args[0], str(ctx.flags, 'name'), ctx.now))
    },
  },

  'person tag': {
    usage: '<id> <tag>...',
    summary: 'give a person tags',
    details: 'The person holds the tags from now on (and every tag above them). Unknown people and tags are added.',
    arity: [2, Infinity],
    run(ctx) {
      mutate(ctx, (r) => ops.tagPerson(r, ctx.args[0], ctx.args.slice(1), ctx.now))
    },
  },

  'person untag': {
    usage: '<id> <tag>...',
    summary: 'take tags from a person',
    details: 'The tags stay in the record; only this person stops holding them.',
    arity: [2, Infinity],
    run(ctx) {
      mutate(ctx, (r) => ops.untagPerson(r, ctx.args[0], ctx.args.slice(1), ctx.now))
    },
  },

  'tag list': {
    usage: '[--json]',
    summary: 'list the tags, their parents and how many people hold them',
    details: 'Holders count nesting: a person holding a child tag also holds its parents.',
    options: [['--json', 'print JSON']],
    flags: { json: { kind: 'bool' } },
    arity: [0, 0],
    run(ctx) {
      const r = load(ctx)
      const rows = r.tags.map((t) => ({ id: t.id, label: t.label, parents: t.parents, holders: holdersOf(r, t.id) }))
      if (ctx.flags.json) return json(ctx, rows)
      if (!rows.length) return ctx.io.out('no tags yet (create one: trustweb tag create <id>)\n')
      ctx.io.out(table([['ID', 'PARENTS', 'HOLDERS', 'LABEL'], ...rows.map((t) => [t.id, t.parents.join(',') || '-', String(t.holders.length), t.label ?? ''])]))
    },
  },

  'tag create': {
    usage: '<id> [--label <label>]',
    summary: 'create a tag',
    details: 'Creates a tag no one holds yet.',
    options: [['--label <label>', 'a display label']],
    flags: { label: { kind: 'string' } },
    arity: [1, 1],
    run(ctx) {
      mutate(ctx, (r) => ops.createTag(r, ctx.args[0], str(ctx.flags, 'label'), ctx.now))
    },
  },

  'tag nest': {
    usage: '<child> <parent>',
    summary: 'put a tag under another tag',
    details: 'Whoever holds the child tag holds the parent too. The share sink refuses a cycle and nesting deeper than four levels.',
    arity: [2, 2],
    run(ctx) {
      mutate(ctx, (r) => ops.nestTag(r, ctx.args[0], ctx.args[1], ctx.now))
    },
  },

  share: {
    usage: '<item> --zone <level> [--include <member>]... [--exclude <member>]...',
    summary: 'share an item with a level of the ladder, plus or minus people and tags',
    details: 'Appends one share line (the share sink\'s appendShare); the latest line per item counts. Its tuples last a year.\n' +
      'The zone must be a built-in zone (a level). To reach only a created zone\'s people, name them with --include.\n' +
      'An exclusion beats every grant. Members are person:<id> or tag:<id>.',
    options: [
      ['--zone <level>', 'the level that may read the item, and every level more intimate (required)'],
      ['--include <member>', 'also let this person or tag read it (repeatable)'],
      ['--exclude <member>', 'never let this person or tag read it (repeatable)'],
    ],
    flags: { zone: { kind: 'string' }, include: { kind: 'list' }, exclude: { kind: 'list' } },
    arity: [1, 1],
    run(ctx) {
      const zone = str(ctx.flags, 'zone')
      if (zone === undefined) throw usage('share needs --zone <level>')
      mutate(ctx, (r) => ops.share(r, ctx.args[0], zone, strs(ctx.flags, 'include'), strs(ctx.flags, 'exclude'), ctx.now))
    },
  },

  sees: {
    usage: '<zone-id|tag:<id>|person:<id>> [--json|--md]',
    summary: 'show what a zone, tag or person can see, and why',
    details: 'Runs the share sink\'s canAccess over every shared item. A zone: someone who sits only in that zone. A tag: someone\n' +
      'who holds only that tag and sits in no zone. A person: exactly that person, exclusions included. Each item lists the\n' +
      'tuples that open it.',
    options: [['--json', 'print JSON'], ['--md', 'print a Markdown page']],
    flags: { json: { kind: 'bool' }, md: { kind: 'bool' } },
    arity: [1, 1],
    run(ctx) {
      if (ctx.flags.json && ctx.flags.md) throw usage('choose one of --json and --md')
      const s = sees(load(ctx), ctx.args[0], ctx.now)
      if (ctx.flags.json) return json(ctx, s)
      ctx.io.out(ctx.flags.md ? sightMarkdown(s) : sightText(s))
    },
  },

  export: {
    usage: '[--format json|jsonl] [--out <file>] [--force]',
    summary: 'print or write the record (json) or its relation store (jsonl)',
    details: 'json: the whole record, the format import reads. jsonl: the share sink\'s relation store, one tuple per line\n' +
      '(the share sink\'s toJsonl; same record, same bytes). Without --out it prints to stdout.',
    options: [['--format <f>', 'json (default) or jsonl'], ['--out <file>', 'write to this file instead of stdout'], ['--force', 'move an existing --out file to archive/ first']],
    flags: { format: { kind: 'string' }, out: { kind: 'string' }, force: { kind: 'bool' } },
    arity: [0, 0],
    run(ctx) {
      const format = str(ctx.flags, 'format') ?? 'json'
      if (format !== 'json' && format !== 'jsonl') throw usage('--format must be json or jsonl')
      const r = load(ctx)
      const text = format === 'json' ? serialize(r) : toJsonl(storeOf(r))
      const out = str(ctx.flags, 'out')
      if (out === undefined) return ctx.io.out(text)
      makeRoom(ctx, out, 'file')
      ctx.io.writeFile(out, text)
      ctx.io.out(`wrote ${out} (${format})\n`)
    },
  },

  import: {
    usage: '<file|-> [--force]',
    summary: 'replace the record with one exported earlier',
    details: 'Reads a record exported as JSON (`-` reads stdin), checks all of it, and writes it as the record. An existing\n' +
      'record is only replaced with --force, and then it is moved to archive/ first. The import is logged in the record.',
    options: [['--force', 'move the existing record to archive/ and replace it']],
    flags: { force: { kind: 'bool' } },
    arity: [1, 1],
    run(ctx) {
      const src = ctx.args[0]
      const text = src === '-' ? ctx.io.readStdin() : readOrFail(ctx, src)
      let r: CliRecord
      try {
        r = parseRecord(text)
      } catch (e) {
        throw new CliError(`${src === '-' ? 'stdin' : src}: ${(e as Error).message}`)
      }
      makeRoom(ctx, ctx.recordPath, 'record')
      const line = `import: ${r.zones.length} zones, ${r.people.length} people, ${r.tags.length} tags, ${r.shares.length} share lines from ${src === '-' ? 'stdin' : src}`
      save(ctx, { ...r, log: [...r.log, `${ctx.now.toISOString()} ${line}`] })
      ctx.io.out(`${line}\n`)
    },
  },

  log: {
    usage: '[-n <count>]',
    summary: 'show the record\'s change log',
    details: 'Every change is one dated, human-readable line, oldest first.',
    options: [['-n <count>', 'only the last <count> lines']],
    flags: { n: { kind: 'string', short: 'n' } },
    arity: [0, 0],
    run(ctx) {
      const n = str(ctx.flags, 'n')
      if (n !== undefined && !/^[1-9][0-9]*$/.test(n)) throw usage('-n takes a positive whole number')
      const log = load(ctx).log
      ctx.io.out(log.slice(n === undefined ? 0 : -Number(n)).map((l) => `${l}\n`).join(''))
    },
  },
}

function readOrFail(ctx: Ctx, path: string): string {
  if (!ctx.io.exists(path)) throw new CliError(`no file at ${path}`)
  return ctx.io.readFile(path)
}
