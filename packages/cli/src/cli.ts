// SPDX-License-Identifier: LicenseRef-AMPL-1.0 OR AGPL-3.0-or-later
/**
 * `trustweb`: a small git-like CLI over the TrustWeb share sink. `run` picks the command, parses its flags, runs it against the Io it
 * is given, and returns the exit code: 0 done, 1 refused (one line on stderr), 2 the command line was wrong.
 */
import { parseArgs } from './args'
import { COMMANDS, type Command, GLOBAL_FLAGS, GLOBAL_OPTIONS, table } from './commands'
import { CliError, usage } from './errors'
import type { Io } from './io'

export const VERSION = '0.1.0'
export const DEFAULT_RECORD = 'trustweb-record.json'

const GROUPS: Readonly<Record<string, string>> = {
  zone: 'trust zones: list, create, rename, archive, restore, add, remove, show',
  person: 'people: list, add, tag, untag',
  tag: 'tags: list, create, nest',
}

/** Own keys only: `trustweb constructor` is an unknown command, not Object's. */
const isGroup = (w: string): boolean => Object.hasOwn(GROUPS, w)
const isCommand = (w: string): boolean => Object.hasOwn(COMMANDS, w)

const VALUE_FLAGS = new Set(Object.entries(GLOBAL_FLAGS).filter(([, s]) => s.kind !== 'bool').map(([k]) => `--${k}`))

/** The command words (`zone create`), wherever global flags sit around them, and the argv without them. */
function split(argv: readonly string[]): { path: string[]; rest: string[] } {
  const words: number[] = []
  for (let i = 0; i < argv.length && words.length < 2; i++) {
    const w = argv[i]
    if (w === '--') break
    if (VALUE_FLAGS.has(w)) { i++; continue }
    if (w.startsWith('-')) continue
    if (words.length === 1 && !isGroup(argv[words[0]])) break
    words.push(i)
  }
  return { path: words.map((i) => argv[i]), rest: argv.filter((_, i) => !words.includes(i)) }
}

function topHelp(): string {
  const rows = [
    ...Object.entries(COMMANDS).filter(([k]) => !k.includes(' ')).map(([k, c]) => [`  ${k}`, c.summary]),
    ...Object.entries(GROUPS).map(([k, s]) => [`  ${k} <command>`, s]),
  ].sort((a, b) => a[0].localeCompare(b[0]))
  return [
    'usage: trustweb [--record <path>] [--now <date>] <command> [<args>]',
    '',
    'Trust zones, tags and what they can see, on the TrustWeb share sink. Works on one local record file; never uses the network.',
    '',
    'commands:',
    table(rows).trimEnd(),
    '',
    'global options:',
    table(GLOBAL_OPTIONS.map(([f, d]) => [`  ${f}`, d])).trimEnd(),
    '',
    'See `trustweb help <command>` or `trustweb <command> --help`. Docs: docs/cli.md.',
    '',
  ].join('\n')
}

function groupHelp(group: string): string {
  const subs = Object.entries(COMMANDS).filter(([k]) => k.startsWith(`${group} `))
  return [
    `usage: trustweb ${group} <command> [<args>]`,
    '',
    `${GROUPS[group]}.`,
    '',
    'commands:',
    table(subs.map(([k, c]) => [`  ${k.slice(group.length + 1)}`, c.summary])).trimEnd(),
    '',
    `See \`trustweb ${group} <command> --help\`.`,
    '',
  ].join('\n')
}

export function commandHelp(name: string, c: Command): string {
  const opts = c.options ?? []
  return [
    `usage: trustweb ${name} ${c.usage}`,
    '',
    `${c.summary[0].toUpperCase()}${c.summary.slice(1)}.`,
    '',
    c.details,
    '',
    ...(opts.length ? ['options:', table(opts.map(([f, d]) => [`  ${f}`, d])).trimEnd(), ''] : []),
    'global options:',
    table(GLOBAL_OPTIONS.map(([f, d]) => [`  ${f}`, d])).trimEnd(),
    '',
  ].join('\n')
}

/** The help text for a command path (`[]`, `['zone']`, `['zone', 'add']`), or undefined when there is no such command. */
export function helpFor(path: readonly string[]): string | undefined {
  const name = path.join(' ')
  if (!path.length) return topHelp()
  if (isCommand(name)) return commandHelp(name, COMMANDS[name])
  if (path.length === 1 && isGroup(path[0])) return groupHelp(path[0])
  return undefined
}

function arity(name: string, c: Command, n: number): void {
  const [min, max] = c.arity
  if (n >= min && n <= max) return
  const want = min === max ? `${min} argument${min === 1 ? '' : 's'}` : `at least ${min} arguments`
  throw usage(`${name} takes ${want}, got ${n}`)
}

function dispatch(argv: readonly string[], io: Io): void {
  if (argv.length === 1 && (argv[0] === '--version' || argv[0] === '-v')) return io.out(`trustweb ${VERSION}\n`)
  const { path, rest } = split(argv)
  const name = path.join(' ')
  if (path[0] === 'help') {
    const text = helpFor(rest)
    if (text === undefined) throw usage(`no help for '${rest.join(' ')}': unknown command`)
    return io.out(text)
  }
  if (!isCommand(name)) {
    const onlyHelp = rest.every((w) => w === '--help' || w === '-h')
    if (!path.length) {
      if (onlyHelp) return io.out(topHelp())
      throw usage('name a command')
    }
    if (path.length === 1 && isGroup(path[0])) {
      if (onlyHelp) return io.out(groupHelp(path[0]))
      throw usage(`${path[0]} needs a command (see: trustweb ${path[0]} --help)`)
    }
    throw usage(`unknown command '${name}'`)
  }
  const command = COMMANDS[name]
  const { positionals, flags } = parseArgs(rest, { ...GLOBAL_FLAGS, ...command.flags })
  if (flags.help) return io.out(commandHelp(name, command))
  arity(name, command, positionals.length)
  const nowText = flags.now as string | undefined
  const now = nowText === undefined ? io.now() : new Date(nowText)
  if (Number.isNaN(+now)) throw usage(`--now ${JSON.stringify(nowText)} is not a date`)
  const recordPath = (flags.record as string | undefined) ?? io.env.TRUSTWEB_RECORD ?? DEFAULT_RECORD
  command.run({ io, args: positionals, flags, now, recordPath })
}

/** Runs one command line; never throws. */
export function run(argv: readonly string[], io: Io): number {
  try {
    dispatch(argv, io)
    return 0
  } catch (e) {
    const err = e instanceof CliError ? e : new CliError((e as Error).message)
    io.err(`trustweb: ${err.message}\n${err.exitCode === 2 ? 'see: trustweb --help\n' : ''}`)
    return err.exitCode
  }
}
